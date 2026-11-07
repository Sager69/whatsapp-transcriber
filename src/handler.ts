/** HTTP side: Meta's webhook handshake + deliveries, health check, privacy page. */
import { allowedNumbers, type Env } from "./config";
import type { Job } from "./pipeline";
import { verifySignature } from "./whatsapp";

export interface JobQueue {
  /** Start processing; must throw if it couldn't. */
  start(id: string, job: Job): Promise<void>;
  /** Whether processing for this id was already started (duplicate delivery). */
  exists(id: string): Promise<boolean>;
}

interface WaMessage { from: string; id: string; type: string; audio?: { id: string } }
interface WaPayload { entry?: { changes?: { value?: { messages?: WaMessage[] } }[] }[] }

/** Deterministic job id from WhatsApp's message id, so a redelivered message maps to the same job. */
export async function jobId(messageId: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(messageId)));
  return "m-" + [...h.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function handleRequest(req: Request, env: Env, queue: JobQueue): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === "/healthz") return Response.json({ ok: true });
  if (url.pathname === "/privacy") return new Response(privacyHtml(env.CONTACT_EMAIL), { headers: { "content-type": "text/html; charset=utf-8" } });
  if (url.pathname !== "/webhook") return new Response("not found", { status: 404 });

  if (req.method === "GET") {
    const q = url.searchParams;
    const ok = q.get("hub.mode") === "subscribe" && !!env.WA_VERIFY_TOKEN && q.get("hub.verify_token") === env.WA_VERIFY_TOKEN;
    return ok ? new Response(q.get("hub.challenge") ?? "") : new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const body = await req.arrayBuffer();
  if (!(await verifySignature(env.WA_APP_SECRET, body, req.headers.get("x-hub-signature-256")))) {
    return new Response("bad signature", { status: 401 });
  }
  let payload: WaPayload;
  try { payload = JSON.parse(new TextDecoder().decode(body)); } catch { return new Response("bad json", { status: 400 }); }

  const allowed = allowedNumbers(env);
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const m of change.value?.messages ?? []) {
        if (!allowed.has(m.from)) { console.log("ignoring message from non-allowlisted number"); continue; }
        const id = await jobId(m.id);
        try {
          await queue.start(id, { from: m.from, messageId: m.id, type: m.type, mediaId: m.audio?.id });
        } catch (e) {
          if (await queue.exists(id)) continue; // duplicate delivery: already being handled
          console.error("could not start job", String(e));
          return new Response("retry later", { status: 500 }); // Meta will redeliver
        }
      }
    }
  }
  return new Response("ok");
}

function privacyHtml(contact?: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy policy</title></head><body style="font:16px/1.6 system-ui;max-width:40em;margin:2em auto;padding:0 16px">
<h1>Privacy policy - Voice-note transcriber</h1>
<p>This is a private bot for a small group of invited users. It only processes messages from allowlisted phone numbers.</p>
<p>When you send a voice note, the audio is downloaded from WhatsApp and sent to Google Gemini to produce a transcript.
Very short notes are also sent to Cohere for a second transcription, to detect unreliable results. For notes longer than
a minute, the transcript is sent to Google Gemini to write a short summary. The reply is sent back to you on WhatsApp.</p>
<p>Audio is held in memory only while it is being processed and is never stored. Transcripts are not stored.
Operational logs record durations, detected language and errors, not content.</p>
${contact ? `<p>Contact: ${contact.replace(/[<>&"]/g, "")}</p>` : ""}</body></html>`;
}
