/** One voice note → transcript reply. Runs inside a Cloudflare Workflow; each `step.do` is retried and checkpointed. */
import { agreement } from "./agreement";
import { buildReplies, formatDuration, hasArabic } from "./formatting";
import { oggOpusDurationSeconds } from "./ogg";
import type { Settings } from "./config";
import type { Sealer } from "./seal";
import type { Transcriber } from "./transcribe";
import type { WhatsAppApi } from "./whatsapp";

export const HELP = "Forward me a voice note and I'll transcribe it.\nحوّلّي رسالة صوتية وبكتبلك ياها.";
export const UNCLEAR = "⚠️ الصوت مش واضح، اسمع الرسالة - unclear audio, please listen to the note.";
export const FAILED = "Sorry, I couldn't transcribe that one. Try forwarding it again.";

export interface Job { from: string; messageId: string; type: string; mediaId?: string }
export interface Step { do<T>(name: string, fn: () => Promise<T>): Promise<T> }
export interface Deps {
  wa: WhatsAppApi;
  stt: Transcriber;
  crosscheck?: Transcriber;
  summarizer: { tldr(transcript: string): Promise<string | null> };
  settings: Settings;
  /** Encrypts step outputs that contain transcript content (they are persisted by the Workflow). */
  sealer: Sealer;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

interface Result { tooLong: boolean; seconds: number | null; text: string; language: string; unclear: boolean }

export async function processMessage(job: Job, d: Deps, step: Step): Promise<void> {
  const log = d.log ?? (() => {});
  const { from, messageId } = job;
  if (job.type !== "audio" || !job.mediaId) {
    await step.do("help", () => d.wa.replyText(from, HELP, messageId));
    return;
  }
  await step.do("react-pending", () => d.wa.react(from, messageId, "⏳"));
  try {
    const r = await d.sealer.open<Result>(
      await step.do("transcribe", async () => d.sealer.seal(await transcribe(job.mediaId!, d, log))));
    if (r.tooLong) {
      await step.do("reply-too-long", () => d.wa.replyText(from,
        `That note is ${formatDuration(r.seconds!)} long - the limit is ${formatDuration(d.settings.maxAudioSeconds)}.`, messageId));
      await step.do("react-done", () => d.wa.react(from, messageId, "❌"));
      return;
    }
    if (!r.text) {
      await step.do("reply-empty", () => d.wa.replyText(from, "🤷 No speech detected.", messageId));
      await step.do("react-done", () => d.wa.react(from, messageId, "✅"));
      return;
    }
    let tldr: string | null = null;
    if (r.seconds !== null && r.seconds > d.settings.tldrMinSeconds) {
      tldr = await d.sealer.open<string | null>(await step.do("tldr", async () => {
        try { return await d.sealer.seal(await d.summarizer.tldr(r.text)); }
        catch (e) { log("tldr failed; sending transcript only", { error: String(e) }); return d.sealer.seal(null); }
      }));
    }
    const replies = buildReplies(r.text, tldr, hasArabic(r.text));
    if (r.unclear) replies[0] = `${UNCLEAR}\n\n${replies[0]}`;
    for (const [i, part] of replies.entries()) {
      await step.do(`reply-${i}`, () => d.wa.replyText(from, part, messageId));
    }
    await step.do("react-done", () => d.wa.react(from, messageId, "✅"));
    log("transcribed", { seconds: r.seconds, language: r.language, chars: r.text.length, tldr: !!tldr, unclear: r.unclear });
  } catch (e) {
    log("failed", { error: String(e) });
    await step.do("report-failure", async () => {
      await d.wa.react(from, messageId, "❌");
      await d.wa.replyText(from, FAILED, messageId);
    });
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
