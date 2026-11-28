/** One voice note → transcript reply. Runs inside a Cloudflare Workflow; each `step.do` is retried and checkpointed. */
import { agreement } from "./agreement";
import { buildReplies, formatDuration, hasArabic } from "./formatting";
import { oggOpusDurationSeconds } from "./ogg";
import type { Settings } from "./config";
import type { Delivery } from "./outbox";
import type { Sealer } from "./seal";
import type { Transcriber } from "./transcribe";
import type { WhatsAppApi } from "./whatsapp";

export const HELP = "Forward me a voice note and I'll transcribe it.\nحوّلّي رسالة صوتية وبكتبلك ياها.";
export const UNCLEAR = "⚠️ الصوت مش واضح، اسمع الرسالة - unclear audio, please listen to the note.";
export const FAILED = "Sorry, I couldn't transcribe that one. Try forwarding it again.";

export interface Job { from: string; messageId: string; type: string; mediaId?: string; /** position in the sender's reply order */ seq: number }
export interface Step { do<T>(name: string, fn: () => Promise<T>): Promise<T> }
export interface Deps {
  wa: WhatsAppApi;
  stt: Transcriber;
  crosscheck?: Transcriber;
  summarizer: { tldr(transcript: string): Promise<string | null> };
  settings: Settings;
  /** Encrypts step outputs that contain transcript content (they are persisted by the Workflow). */
  sealer: Sealer;
  /** Releases each sender's replies in the order their messages arrived. */
  outbox: { deliver(seq: number, sealedDelivery: string): Promise<void> };
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

interface Result { tooLong: boolean; seconds: number | null; text: string; language: string; unclear: boolean }

export async function processMessage(job: Job, d: Deps, step: Step): Promise<void> {
  const log = d.log ?? (() => {});
  const { from, messageId } = job;
  // ⏳ runs alongside transcription and never holds up the reply. WhatsApp keeps one reaction per
  // message, so if the ⏳ lands after the final ✅/❌, the final reaction is sent again once it has.
  let pending: Promise<unknown> = Promise.resolve();
  let reactSettled = true;
  const deliver = async (replies: string[], reaction: string) => {
    const reactStillRunning = !reactSettled;
    await step.do("deliver", async () => {
      const delivery: Delivery = { to: from, messageId, replies, reaction };
      await d.outbox.deliver(job.seq, await d.sealer.seal(delivery));
    });
    if (reactStillRunning && reaction) {
      await pending;
      await step.do("react-final", () => d.wa.react(from, messageId, reaction));
    }
  };

  if (job.type !== "audio" || !job.mediaId) return deliver([HELP], "");

  reactSettled = false;
  pending = step.do("react-pending", () => d.wa.react(from, messageId, "⏳"))
    .catch((e) => log("⏳ reaction failed", { error: String(e) }))
    .finally(() => { reactSettled = true; });
  try {
    const r = await d.sealer.open<Result>(
      await step.do("transcribe", async () => d.sealer.seal(await transcribe(job.mediaId!, d, log))));
    if (r.tooLong) {
      return deliver([`That note is ${formatDuration(r.seconds!)} long - the limit is ${formatDuration(d.settings.maxAudioSeconds)}.`], "❌");
    }
    if (!r.text) return deliver(["🤷 No speech detected."], "✅");

    let tldr: string | null = null;
    if (r.seconds !== null && r.seconds > d.settings.tldrMinSeconds) {
      tldr = await d.sealer.open<string | null>(await step.do("tldr", async () => {
        try { return await d.sealer.seal(await d.summarizer.tldr(r.text)); }
        catch (e) { log("tldr failed; sending transcript only", { error: String(e) }); return d.sealer.seal(null); }
      }));
    }
    const replies = buildReplies(r.text, tldr, hasArabic(r.text));
    if (r.unclear) replies[0] = `${UNCLEAR}\n\n${replies[0]}`;
    await deliver(replies, "✅");
    log("transcribed", { seq: job.seq, seconds: r.seconds, language: r.language, chars: r.text.length, tldr: !!tldr, unclear: r.unclear });
  } catch (e) {
    log("failed", { error: String(e) });
    await deliver([FAILED], "❌");
  }
}

async function transcribe(mediaId: string, d: Deps, log: NonNullable<Deps["log"]>): Promise<Result> {
  // Audio only ever exists in memory inside this step.
  const { data, mime } = await d.wa.downloadMedia(mediaId);
  const seconds = oggOpusDurationSeconds(data);
  if (seconds !== null && seconds > d.settings.maxAudioSeconds) {
    return { tooLong: true, seconds, text: "", language: "", unclear: false };
  }
  if (d.crosscheck && seconds !== null && seconds < d.settings.crosscheckMaxSeconds) {
    const [main, second] = await Promise.allSettled([d.stt.transcribe(data, mime), d.crosscheck.transcribe(data, mime)]);
    if (main.status === "rejected") throw main.reason;
    let unclear = false;
    if (second.status === "rejected") {
      log("cross-check failed", { error: String(second.reason) });
    } else {
      const score = agreement(main.value.text, second.value.text);
      unclear = score < d.settings.crosscheckMinAgreement;
      log("cross-check", { agreement: Number(score.toFixed(2)), unclear });
    }
    return { tooLong: false, seconds, text: main.value.text, language: main.value.language, unclear };
  }
  const t = await d.stt.transcribe(data, mime);
  return { tooLong: false, seconds, text: t.text, language: t.language, unclear: false };
}
