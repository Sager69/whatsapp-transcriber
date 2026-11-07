import { TLDR_INSTRUCTIONS, TRANSCRIBE_INSTRUCTIONS } from "./prompt";

export interface Transcript { text: string; language: string; provider: string }
export interface Transcriber { name: string; transcribe(audio: Uint8Array, mime: string): Promise<Transcript> }

const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models";

export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function gemini(apiKey: string, model: string, body: unknown): Promise<string> {
  const r = await fetch(`${GEMINI}/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Gemini ${model} ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const data = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
}

export class GeminiTranscriber implements Transcriber {
  name = "gemini";
  constructor(private apiKey: string, private model: string, private instructions = TRANSCRIBE_INSTRUCTIONS) {}

  async transcribe(audio: Uint8Array, mime: string): Promise<Transcript> {
    const raw = await gemini(this.apiKey, this.model, {
      contents: [{ role: "user", parts: [{ inline_data: { mime_type: mime, data: toBase64(audio) } }, { text: this.instructions }] }],
      generationConfig: {
        temperature: 0,
        seed: 7,
        responseMimeType: "application/json",
        responseJsonSchema: {
          type: "object",
          properties: { language: { type: "string" }, transcript: { type: "string" } },
          required: ["language", "transcript"],
        },
      },
    });
    const d = JSON.parse(raw) as { language: string; transcript: string };
    return { text: d.transcript.trim(), language: d.language, provider: this.name };
  }
}

/** Cohere Transcribe Arabic: a different system, used as a second opinion on short notes. */
export class CohereTranscriber implements Transcriber {
  name = "cohere";
  constructor(private apiKey: string, private model = "cohere-transcribe-arabic-07-2026", private language = "ar") {}

  async transcribe(audio: Uint8Array, mime: string): Promise<Transcript> {
    const form = new FormData();
    form.set("model", this.model);
    form.set("language", this.language);
    form.set("temperature", "0");
    form.set("file", new Blob([audio], { type: mime }), mime.includes("ogg") ? "note.ogg" : "note");
    const r = await fetch("https://api.cohere.com/v2/audio/transcriptions", {
      method: "POST", headers: { authorization: `Bearer ${this.apiKey}` }, body: form,
    });
    if (!r.ok) throw new Error(`Cohere ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const d = (await r.json()) as { text?: string };
    return { text: (d.text ?? "").trim(), language: this.language, provider: this.name };
  }
}

export class GeminiSummarizer {
  constructor(private apiKey: string, private model: string) {}

  async tldr(transcript: string): Promise<string | null> {
    const text = await gemini(this.apiKey, this.model, {
      systemInstruction: { parts: [{ text: TLDR_INSTRUCTIONS }] },
      contents: [{ role: "user", parts: [{ text: `<transcript>\n${transcript}\n</transcript>` }] }],
      generationConfig: { temperature: 0.2 },
    });
    return text.trim() || null;
  }
}
