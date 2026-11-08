/** Cloudflare entry points: the webhook Worker and the per-message Workflow. */
import { DurableObject, WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { settings, type Env } from "./config";
import { handleRequest } from "./handler";
import { OutboxCore, sendDelivery } from "./outbox";
import { makeSealer } from "./seal";
import { processMessage, type Deps, type Job, type Step } from "./pipeline";
import { CohereTranscriber, GeminiSummarizer, GeminiTranscriber } from "./transcribe";
import { WhatsApp } from "./whatsapp";

type Bindings = Env & { TRANSCRIBE: Workflow<Job>; OUTBOX: DurableObjectNamespace<SenderOutbox> };

const outboxFor = (env: Bindings, from: string) => env.OUTBOX.get(env.OUTBOX.idFromName(from));
const whatsapp = (env: Bindings) => new WhatsApp(env.WA_TOKEN, env.WA_PHONE_NUMBER_ID, settings(env).graphVersion);

/** One per sender: releases replies in the order the sender's messages arrived. */
export class SenderOutbox extends DurableObject<Bindings> {
  private core?: Promise<OutboxCore>;
  private outbox() {
    return (this.core ??= makeSealer(this.env.WA_APP_SECRET).then((sealer) => new OutboxCore({
      storage: this.ctx.storage,
      sealer,
      send: (d) => sendDelivery(whatsapp(this.env), d),
      setAlarm: (at) => this.ctx.storage.setAlarm(at),
      log: (msg, data) => console.log(JSON.stringify({ msg, ...data })),
    })));
  }
  async enqueue(jobId: string) { return (await this.outbox()).enqueue(jobId); }
  async deliver(seq: number, sealed: string) { return (await this.outbox()).deliver(seq, sealed); }
  async alarm() { return (await this.outbox()).alarm(); }
}

export class TranscribeWorkflow extends WorkflowEntrypoint<Bindings, Job> {
  async run(event: WorkflowEvent<Job>, wfStep: WorkflowStep) {
    const env = this.env, s = settings(env);
    const deps: Deps = {
      wa: whatsapp(env),
      stt: new GeminiTranscriber(env.GEMINI_API_KEY, s.geminiModel),
      crosscheck: env.CO_API_KEY ? new CohereTranscriber(env.CO_API_KEY) : undefined,
      summarizer: new GeminiSummarizer(env.GEMINI_API_KEY, s.tldrModel),
      settings: s,
      sealer: await makeSealer(env.WA_APP_SECRET),
      outbox: { deliver: (seq, sealed) => outboxFor(env, event.payload.from).deliver(seq, sealed) },
      log: (msg, data) => console.log(JSON.stringify({ msg, job: event.instanceId, ...data })),
    };
    const step: Step = {
      do: <T>(name: string, fn: () => Promise<T>) =>
        wfStep.do(name, { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" }, timeout: "10 minutes" },
          fn as () => Promise<any>) as Promise<T>,
    };
    await processMessage(event.payload, deps, step);
  }
}

export default {
  async fetch(req: Request, env: Bindings): Promise<Response> {
    return handleRequest(req, env, {
      sequence: (from, id) => outboxFor(env, from).enqueue(id),
      start: async (id, job) => { await env.TRANSCRIBE.create({ id, params: job }); },
      exists: async (id) => { try { await (await env.TRANSCRIBE.get(id)).status(); return true; } catch { return false; } },
    });
  },
} satisfies ExportedHandler<Bindings>;
