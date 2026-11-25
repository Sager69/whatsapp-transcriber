/** Local bake-off: run voice notes through the real pipeline (fake WhatsApp) and score against an answer key. */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { normalize } from "../src/agreement";
import { settings, type Env } from "../src/config";
import { processMessage } from "../src/pipeline";
import { makeSealer } from "../src/seal";
import { sendDelivery, type Delivery } from "../src/outbox";
import { CohereTranscriber, GeminiSummarizer, GeminiTranscriber } from "../src/transcribe";

const dir = process.argv[2] ?? "bakeoff/samples";
const answersPath = "bakeoff/answers.local.json";
const answers: Record<string, { contains?: string[]; start?: string }> = existsSync(answersPath) ? JSON.parse(readFileSync(answersPath, "utf8")) : {};
const env = process.env as unknown as Env;
const s = settings(env);
const stt = new GeminiTranscriber(env.GEMINI_API_KEY, s.geminiModel, s.geminiThinking);
const crosscheck = env.CO_API_KEY ? new CohereTranscriber(env.CO_API_KEY) : undefined;
const summarizer = new GeminiSummarizer(env.GEMINI_API_KEY, s.tldrModel);

let passed = 0, scored = 0;
for (const f of readdirSync(dir).filter((f) => /\.(opus|ogg)$/.test(f)).sort()) {
  const sent: string[] = [];
  const wa = {
    downloadMedia: async () => ({ data: new Uint8Array(readFileSync(join(dir, f))), mime: "audio/ogg" }),
    replyText: async (_to: string, text: string) => { sent.push(text); },
    react: async () => {},
  };
  const logs: string[] = [];
  const sealer = await makeSealer("local");
  await processMessage({ from: "x", messageId: f, type: "audio", mediaId: f, seq: 1 },
    { wa, stt, crosscheck, summarizer, settings: s, sealer,
      outbox: { deliver: async (_seq, sealed) => sendDelivery(wa, await sealer.open<Delivery>(sealed)) }, log: (m, d) => logs.push(`${m} ${JSON.stringify(d)}`) },
    { do: (_n, fn) => fn() });
  const all = sent.join("\n");
  let verdict = "";
  const rule = answers[f];
  if (rule) {
    scored++;
    const t = normalize(all.replace(/^⚠️.*\n\n/, "").replace(/^\*باختصار:\*[\s\S]*?\n(?=\S)/, ""));
    const ok = rule.start ? t.startsWith(normalize(rule.start)) : (rule.contains ?? []).every((p) => t.includes(normalize(p)));
    if (ok) passed++;
    verdict = ok ? " ✓" : " ✗";
  }
  console.log(`--- ${f}${verdict}\n${all}\n  [${logs.join(" | ")}]`);
}
if (scored) console.log(`\nanswer key: ${passed}/${scored} passed`);
