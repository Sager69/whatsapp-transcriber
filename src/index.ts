/** Cloudflare entry points: the webhook Worker and the per-message Workflow. */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { settings, type Env } from "./config";
import { handleRequest } from "./handler";
import { makeSealer } from "./seal";
import { processMessage, type Deps, type Job, type Step } from "./pipeline";
import { CohereTranscriber, GeminiSummarizer, GeminiTranscriber } from "./transcribe";
import { WhatsApp } from "./whatsapp";

type Bindings = Env & { TRANSCRIBE: Workflow<Job> };

export class TranscribeWorkflow extends WorkflowEntrypoint<Bindings, Job> {
  async run(event: WorkflowEvent<Job>, wfStep: WorkflowStep) {
    const env = this.env, s = settings(env);
    const deps: Deps = {
      wa: new WhatsApp(env.WA_TOKEN, env.WA_PHONE_NUMBER_ID, s.graphVersion),
      stt: new GeminiTranscriber(env.GEMINI_API_KEY, s.geminiModel),
      crosscheck: env.CO_API_KEY ? new CohereTranscriber(env.CO_API_KEY) : undefined,
      summarizer: new GeminiSummarizer(env.GEMINI_API_KEY, s.tldrModel),
      settings: s,
      sealer: await makeSealer(env.WA_APP_SECRET),
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
      start: async (id, job) => { await env.TRANSCRIBE.create({ id, params: job }); },
      exists: async (id) => { try { await (await env.TRANSCRIBE.get(id)).status(); return true; } catch { return false; } },
    });
  },
} satisfies ExportedHandler<Bindings>;
