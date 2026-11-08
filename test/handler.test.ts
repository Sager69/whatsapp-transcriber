import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/config";
import { handleRequest, jobId, type JobQueue } from "../src/handler";
import type { Job } from "../src/pipeline";

const SECRET = "s3cret";
const env = { WA_APP_SECRET: SECRET, WA_VERIFY_TOKEN: "vt", ALLOWED_NUMBERS: "+9617000000, 4477000000" } as Env;

class Queue implements JobQueue {
  jobs = new Map<string, Job>();
  seqs = new Map<string, number>();
  failNext = false;
  async sequence(from: string, id: string) {
    if (!this.seqs.has(id)) this.seqs.set(id, [...this.seqs.keys()].length + 1);
    return this.seqs.get(id)!;
  }
  async start(id: string, job: Job) {
    if (this.failNext) { this.failNext = false; throw new Error("unavailable"); }
    if (this.jobs.has(id)) throw new Error("instance already exists");
    this.jobs.set(id, job);
  }
  async exists(id: string) { return this.jobs.has(id); }
}

const payload = (from = "9617000000", id = "wamid.1", type = "audio") =>
  ({ entry: [{ changes: [{ value: { messages: [{ from, id, type, ...(type === "audio" ? { audio: { id: "media1", voice: true } } : { text: { body: "hi" } }) }] } }] }] });

function post(body: unknown, signature?: string) {
  const raw = JSON.stringify(body);
  const sig = signature ?? "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex");
  return new Request("https://bot.example/webhook", { method: "POST", body: raw, headers: { "x-hub-signature-256": sig } });
}

describe("webhook", () => {
  it("answers Meta's verification handshake", async () => {
    const ok = await handleRequest(new Request("https://x/webhook?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=42"), env, new Queue());
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("42");
    const bad = await handleRequest(new Request("https://x/webhook?hub.mode=subscribe&hub.verify_token=no&hub.challenge=42"), env, new Queue());
    expect(bad.status).toBe(403);
  });

  it("rejects a bad signature", async () => {
    const q = new Queue();
    const r = await handleRequest(post(payload(), "sha256=" + "0".repeat(64)), env, q);
    expect(r.status).toBe(401);
    expect(q.jobs.size).toBe(0);
  });

  it("rejects a missing signature", async () => {
    const r = await handleRequest(new Request("https://x/webhook", { method: "POST", body: "{}" }), env, new Queue());
    expect(r.status).toBe(401);
  });

  it("starts one job per allowlisted message", async () => {
    const q = new Queue();
    expect((await handleRequest(post(payload()), env, q)).status).toBe(200);
    expect([...q.jobs.values()]).toEqual([{ from: "9617000000", messageId: "wamid.1", type: "audio", mediaId: "media1", seq: 1 }]);
  });

  it("ignores numbers that are not allowlisted", async () => {
    const q = new Queue();
    expect((await handleRequest(post(payload("15550001111")), env, q)).status).toBe(200);
    expect(q.jobs.size).toBe(0);
  });

  it("handles a duplicate delivery once", async () => {
    const q = new Queue();
    await handleRequest(post(payload()), env, q);
    expect((await handleRequest(post(payload()), env, q)).status).toBe(200);
    expect(q.jobs.size).toBe(1);
  });

  it("asks Meta to retry when the job could not be started, keeping its place in line", async () => {
    const q = new Queue();
    q.failNext = true;
    expect((await handleRequest(post(payload()), env, q)).status).toBe(500);
    expect((await handleRequest(post(payload()), env, q)).status).toBe(200); // redelivery succeeds
    expect(q.jobs.size).toBe(1);
    expect([...q.jobs.values()][0].seq).toBe(1);
  });

  it("numbers a sender's messages in arrival order", async () => {
    const q = new Queue();
    await handleRequest(post(payload("9617000000", "wamid.A")), env, q);
    await handleRequest(post(payload("9617000000", "wamid.B")), env, q);
    expect([...q.jobs.values()].map((j) => [j.messageId, j.seq])).toEqual([["wamid.A", 1], ["wamid.B", 2]]);
  });

  it("job ids are deterministic and workflow-safe", async () => {
    const id = await jobId("wamid.HBgLOTYxNzAwMDAwMDAVAgASGBQzQUY5RkE0NjE3RkY4MEE1QjhGRQA=");
    expect(id).toMatch(/^m-[0-9a-f]{32}$/);
    expect(await jobId("wamid.HBgLOTYxNzAwMDAwMDAVAgASGBQzQUY5RkE0NjE3RkY4MEE1QjhGRQA=")).toBe(id);
  });
});

describe("other routes", () => {
  it("health check", async () => expect(await (await handleRequest(new Request("https://x/healthz"), env, new Queue())).json()).toEqual({ ok: true }));
  it("privacy page", async () => {
    const r = await handleRequest(new Request("https://x/privacy"), { ...env, CONTACT_EMAIL: "me@example.com" }, new Queue());
    const html = await r.text();
    expect(html).toContain("never stored");
    expect(html).toContain("me@example.com");
  });
  it("home page", async () => {
    const r = await handleRequest(new Request("https://x/"), env, new Queue());
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("/privacy");
  });
  it("unknown paths 404", async () => expect((await handleRequest(new Request("https://x/nope"), env, new Queue())).status).toBe(404));
});
