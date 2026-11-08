/**
 * Per-sender outbox: replies are released in the order the messages were received, not in the
 * order transcription finishes. One instance per sender (a Durable Object in production).
 *
 * - The webhook calls `enqueue(jobId)` when a message arrives → a sequence number (idempotent).
 * - When a job is done, it calls `deliver(seq, sealedDelivery)`.
 * - Deliveries are sent strictly in sequence. If the job at the head of the line hasn't delivered
 *   within GAP_MS while later ones are waiting, it's skipped so it can't block everyone; when it
 *   does deliver later, it's sent right away.
 * Stored deliveries are sealed (they contain transcripts) and deleted once sent.
 */
import type { Sealer } from "./seal";

export const GAP_MS = 5 * 60 * 1000;

export interface Delivery { to: string; messageId: string; replies: string[]; reaction: string }

export interface Storage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<unknown>;
}

export interface OutboxDeps {
  storage: Storage;
  sealer: Sealer;
  send(d: Delivery): Promise<void>;
  setAlarm(at: number): Promise<void>;
  now?: () => number;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

export class OutboxCore {
  private flushing = false;
  constructor(private d: OutboxDeps) {}

  private get log() { return this.d.log ?? (() => {}); }
  private async next() { return (await this.d.storage.get<number>("next")) ?? 1; }
  private async last() { return (await this.d.storage.get<number>("last")) ?? 0; }

  async enqueue(jobId: string): Promise<number> {
    const s = this.d.storage;
    const existing = await s.get<number>(`job:${jobId}`);
    if (existing !== undefined) return existing;
    const seq = (await this.last()) + 1;
    await s.put("last", seq);
    await s.put(`job:${jobId}`, seq);
    return seq;
  }

  async deliver(seq: number, sealed: string): Promise<void> {
    const s = this.d.storage;
    if (seq < (await this.next())) {
      // Already passed: either it was sent (a retried delivery → ignore) or it was skipped (send now).
      if (await s.get(`skipped:${seq}`)) {
        await s.delete(`skipped:${seq}`);
        await this.sendSafely(seq, sealed);
      }
      return;
    }
    await s.put(`d:${seq}`, sealed);
    await this.flush();
  }

  async flush(): Promise<void> {
    if (this.flushing) return; // the running loop will pick up anything new
    this.flushing = true;
    try {
      for (;;) {
        const next = await this.next();
        const sealed = await this.d.storage.get<string>(`d:${next}`);
        if (!sealed) break;
        await this.sendSafely(next, sealed);
        await this.d.storage.delete(`d:${next}`);
        await this.d.storage.put("next", next + 1);
      }
      if ((await this.last()) >= (await this.next())) await this.d.setAlarm((this.d.now ?? Date.now)() + GAP_MS);
    } finally {
      this.flushing = false;
    }
  }

  /** Called GAP_MS after the line last moved: skip a missing head if later deliveries are waiting. */
  async alarm(): Promise<void> {
    const next = await this.next(), last = await this.last();
    if (next > last || (await this.d.storage.get(`d:${next}`))) return this.flush();
    for (let s = next + 1; s <= last; s++) {
      if (await this.d.storage.get(`d:${s}`)) {
        this.log("outbox: skipping a stalled message", { seq: next });
        await this.d.storage.put(`skipped:${next}`, true);
        await this.d.storage.put("next", next + 1);
        break;
      }
    }
    await this.flush();
  }

  private async sendSafely(seq: number, sealed: string) {
    try {
      await this.d.send(await this.d.sealer.open<Delivery>(sealed));
    } catch (e) {
      this.log("outbox: delivery failed", { seq, error: String(e) });
    }
  }
}

/** Sends one delivery: each reply quoting the original message (retrying transient failures), then the reaction. */
export async function sendDelivery(
  wa: { replyText(to: string, text: string, replyTo?: string): Promise<void>; react(to: string, id: string, emoji: string): Promise<void> },
  d: Delivery,
): Promise<void> {
  const retry = async (fn: () => Promise<void>) => {
    for (let attempt = 1; ; attempt++) {
      try { return await fn(); } catch (e) { if (attempt >= 3) throw e; await new Promise((r) => setTimeout(r, 1000 * attempt)); }
    }
  };
  for (const text of d.replies) await retry(() => wa.replyText(d.to, text, d.messageId));
  if (d.reaction) await retry(() => wa.react(d.to, d.messageId, d.reaction));
}
