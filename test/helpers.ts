import type { Deps, Job, Step } from "../src/pipeline";
import { makeSealer } from "../src/seal";
import { sendDelivery, type Delivery } from "../src/outbox";
import type { Transcriber, Transcript } from "../src/transcribe";

export class FakeWA {
  sent: { to: string; text: string; replyTo?: string }[] = [];
  reactions: string[] = [];
  constructor(public audio: Uint8Array = new Uint8Array(0)) {}
  async downloadMedia() { return { data: this.audio, mime: "audio/ogg" }; }
  async replyText(to: string, text: string, replyTo?: string) { this.sent.push({ to, text, replyTo }); }
  async react(_to: string, _id: string, emoji: string) { this.reactions.push(emoji); }
}

export class FakeSTT implements Transcriber {
  name = "fake";
  calls = 0;
  constructor(public text = "بدي روح عالـ meeting بكرا", public fail = false) {}
  async transcribe(): Promise<Transcript> {
    this.calls++;
    if (this.fail) throw new Error("boom");
    return { text: this.text, language: "ar-levantine+en", provider: this.name };
  }
}

/** Runs steps inline, like a Workflow with no failures. Records step names and what each step returned (= what gets persisted). */
export class InlineStep implements Step {
  names: string[] = [];
  outputs: unknown[] = [];
  async do<T>(name: string, fn: () => Promise<T>): Promise<T> { this.names.push(name); const out = await fn(); this.outputs.push(out); return out; }
}

export const SETTINGS = {
  graphVersion: "v23.0", geminiModel: "m", geminiThinking: "off", tldrModel: "m", tldrMinSeconds: 60, maxAudioSeconds: 1800,
  crosscheckMaxSeconds: 8, crosscheckMinAgreement: 0.5,
};

const sealer = await makeSealer("test-secret");

/** Outbox stand-in for pipeline tests: sends each delivery straight away (ordering is tested in outbox.test.ts). */
export const directOutbox = (wa: FakeWA) => ({
  deliver: async (_seq: number, sealed: string) => sendDelivery(wa, await sealer.open<Delivery>(sealed)),
});

export function deps(over: Partial<Deps> & { wa: FakeWA }): Deps {
  return { stt: new FakeSTT(), summarizer: { tldr: async () => "رايح عالاجتماع بكرا" }, settings: SETTINGS, sealer, outbox: directOutbox(over.wa), ...over } as Deps;
}

export const job = (over: Partial<Job> = {}): Job => ({ from: "9617000000", messageId: "wamid.1", type: "audio", mediaId: "media1", seq: 1, ...over });
