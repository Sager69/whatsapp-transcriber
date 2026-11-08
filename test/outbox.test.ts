import { describe, expect, it } from "vitest";
import { GAP_MS, OutboxCore, type Delivery, type Storage } from "../src/outbox";
import { makeSealer } from "../src/seal";

class MemStorage implements Storage {
  m = new Map<string, unknown>();
  async get<T>(k: string) { return this.m.get(k) as T | undefined; }
  async put(k: string, v: unknown) { this.m.set(k, v); }
  async delete(k: string) { return this.m.delete(k); }
}

async function setup(opts: { failFor?: string } = {}) {
  const sealer = await makeSealer("k");
  const storage = new MemStorage();
  const sent: string[] = [];
  const alarms: number[] = [];
  let clock = 1_000_000;
  const box = new OutboxCore({
    storage, sealer, now: () => clock,
    send: async (d) => { if (d.messageId === opts.failFor) throw new Error("graph down"); sent.push(d.messageId); },
    setAlarm: async (at) => { alarms.push(at); },
  });
  const seal = (id: string) => sealer.seal({ to: "x", messageId: id, replies: [`transcript of ${id}`], reaction: "✅" } satisfies Delivery);
  return { box, storage, sent, alarms, seal, tick: (ms: number) => { clock += ms; } };
}

describe("OutboxCore", () => {
  it("releases replies in arrival order even when later notes finish first", async () => {
    const { box, sent, seal } = await setup();
    const a = await box.enqueue("A"), b = await box.enqueue("B"), c = await box.enqueue("C");
    expect([a, b, c]).toEqual([1, 2, 3]);
    await box.deliver(c, await seal("C"));
    await box.deliver(b, await seal("B"));
    expect(sent).toEqual([]); // waiting for A
    await box.deliver(a, await seal("A"));
    expect(sent).toEqual(["A", "B", "C"]);
  });

  it("enqueue is idempotent per job (webhook retries keep their place)", async () => {
    const { box } = await setup();
    expect(await box.enqueue("A")).toBe(1);
    expect(await box.enqueue("B")).toBe(2);
    expect(await box.enqueue("A")).toBe(1);
  });

  it("ignores a retried delivery that was already sent", async () => {
    const { box, sent, seal } = await setup();
    const a = await box.enqueue("A");
    await box.deliver(a, await seal("A"));
    await box.deliver(a, await seal("A"));
    expect(sent).toEqual(["A"]);
  });

  it("skips a stalled message after the gap, and sends it when it finally arrives", async () => {
    const { box, sent, seal, alarms } = await setup();
    const a = await box.enqueue("A"), b = await box.enqueue("B");
    await box.deliver(b, await seal("B"));
    expect(alarms.at(-1)).toBe(1_000_000 + GAP_MS);
    await box.alarm(); // A still missing, B waiting → skip A
    expect(sent).toEqual(["B"]);
    await box.deliver(a, await seal("A")); // late, but not lost
    expect(sent).toEqual(["B", "A"]);
  });

  it("doesn't skip when nothing is waiting behind the head", async () => {
    const { box, sent, seal } = await setup();
    const a = await box.enqueue("A");
    await box.alarm();
    await box.deliver(a, await seal("A"));
    expect(sent).toEqual(["A"]);
  });

  it("a failed send doesn't block the next replies", async () => {
    const { box, sent, seal } = await setup({ failFor: "A" });
    const a = await box.enqueue("A"), b = await box.enqueue("B");
    await box.deliver(a, await seal("A"));
    await box.deliver(b, await seal("B"));
    expect(sent).toEqual(["B"]);
  });

  it("stores only sealed deliveries, and deletes them once sent", async () => {
    const { box, storage, seal } = await setup();
    const a = await box.enqueue("A"), b = await box.enqueue("B");
    await box.deliver(b, await seal("B"));
    expect(JSON.stringify([...storage.m.values()])).not.toContain("transcript of");
    await box.deliver(a, await seal("A"));
    expect([...storage.m.keys()].filter((k) => k.startsWith("d:"))).toEqual([]);
  });
});
