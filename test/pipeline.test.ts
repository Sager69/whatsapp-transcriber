import { beforeEach, describe, expect, it, vi } from "vitest";
import * as ogg from "../src/ogg";
import { FAILED, HELP, UNCLEAR, processMessage } from "../src/pipeline";
import { FakeSTT, FakeWA, InlineStep, deps, job } from "./helpers";

const duration = (s: number | null) => vi.spyOn(ogg, "oggOpusDurationSeconds").mockReturnValue(s);
beforeEach(() => vi.restoreAllMocks());

describe("processMessage", () => {
  it("short note: transcript only, quoting the note", async () => {
    duration(20);
    const wa = new FakeWA(), summarizer = { tldr: vi.fn() };
    await processMessage(job(), deps({ wa, summarizer }), new InlineStep());
    expect(summarizer.tldr).not.toHaveBeenCalled();
    expect(wa.sent).toHaveLength(1);
    expect(wa.sent[0].text).toContain("meeting");
    expect(wa.sent[0].replyTo).toBe("wamid.1");
    expect(wa.reactions).toEqual(["⏳", "✅"]);
  });

  it("long note: transcript with the tl;dr at the end", async () => {
    duration(95);
    const wa = new FakeWA();
    await processMessage(job(), deps({ wa }), new InlineStep());
    expect(wa.sent).toHaveLength(1);
    const [transcript, tldr] = wa.sent[0].text.split("\n\n");
    expect(transcript).toContain("meeting");
    expect(tldr.replace("\u200f", "").startsWith("*باختصار:*")).toBe(true);
  });

  it("note right at 60s gets no tl;dr", async () => {
    duration(59.6);
    const wa = new FakeWA(), summarizer = { tldr: vi.fn() };
    await processMessage(job(), deps({ wa, summarizer }), new InlineStep());
    expect(summarizer.tldr).not.toHaveBeenCalled();
  });

  it("tl;dr failure still sends the transcript", async () => {
    duration(95);
    const wa = new FakeWA();
    await processMessage(job(), deps({ wa, summarizer: { tldr: async () => { throw new Error("x"); } } }), new InlineStep());
    expect(wa.sent).toHaveLength(1);
    expect(wa.reactions.at(-1)).toBe("✅");
  });

  it("text message gets the help text", async () => {
    const wa = new FakeWA();
    await processMessage(job({ type: "text", mediaId: undefined }), deps({ wa }), new InlineStep());
    expect(wa.sent[0].text).toBe(HELP);
  });

  it("transcription failure is reported to the user", async () => {
    duration(20);
    const wa = new FakeWA();
    await processMessage(job(), deps({ wa, stt: new FakeSTT("", true) }), new InlineStep());
    expect(wa.reactions.at(-1)).toBe("❌");
    expect(wa.sent[0].text).toBe(FAILED);
  });

  it("too-long note is refused before transcribing", async () => {
    duration(4000);
    const wa = new FakeWA(), stt = new FakeSTT();
    await processMessage(job(), deps({ wa, stt }), new InlineStep());
    expect(stt.calls).toBe(0);
    expect(wa.sent[0].text).toContain("limit");
  });

  it("hands all replies to the outbox in one step", async () => {
    duration(95);
    const step = new InlineStep();
    await processMessage(job(), deps({ wa: new FakeWA() }), step);
    expect(step.names).toEqual(["react-pending", "transcribe", "tldr", "deliver"]);
  });
});

describe("⏳ reaction", () => {
  it("transcription starts without waiting for the ⏳ reaction", async () => {
    duration(20);
    const wa = new FakeWA();
    let releaseReact!: () => void;
    wa.react = async (_to, _id, emoji) => {
      if (emoji === "⏳") await new Promise<void>((r) => (releaseReact = r));
      wa.reactions.push(emoji);
    };
    const stt = new FakeSTT();
    const run = processMessage(job(), deps({ wa, stt }), new InlineStep());
    await new Promise((r) => setTimeout(r, 10));
    expect(stt.calls).toBe(1);        // already transcribing
    expect(wa.sent).toHaveLength(0);  // but the reply waits for ⏳ to finish
    releaseReact();
    await run;
    expect(wa.reactions).toEqual(["⏳", "✅"]); // ✅ never lands before ⏳
    expect(wa.sent).toHaveLength(1);
  });

  it("a failed ⏳ reaction doesn't stop the transcript", async () => {
    duration(20);
    const wa = new FakeWA();
    wa.react = async (_to, _id, emoji) => { if (emoji === "⏳") throw new Error("graph 500"); wa.reactions.push(emoji); };
    await processMessage(job(), deps({ wa }), new InlineStep());
    expect(wa.sent).toHaveLength(1);
    expect(wa.reactions).toEqual(["✅"]);
  });
});

describe("short-note cross-check", () => {
  it("flags a short note when the two systems disagree", async () => {
    duration(2.6);
    const wa = new FakeWA(), second = new FakeSTT("Give the Arabic name");
    await processMessage(job(), deps({ wa, stt: new FakeSTT("If they are the egg man."), crosscheck: second }), new InlineStep());
    expect(second.calls).toBe(1);
    expect(wa.sent[0].text.startsWith(UNCLEAR)).toBe(true);
    expect(wa.sent[0].text).toContain("egg man");
  });

  it("does not flag spelling-level differences", async () => {
    duration(7.4);
    const wa = new FakeWA();
    await processMessage(job(), deps({ wa, stt: new FakeSTT("أنا عارف الكلام هذا بديهي وتقليدي"),
      crosscheck: new FakeSTT("انا عارف الكلام هذا بديهي و تقليدي <hesitation>") }), new InlineStep());
    expect(wa.sent[0].text.startsWith("⚠️")).toBe(false);
  });

  it("long notes skip the cross-check", async () => {
    duration(30);
    const second = new FakeSTT("totally different");
    await processMessage(job(), deps({ wa: new FakeWA(), crosscheck: second }), new InlineStep());
    expect(second.calls).toBe(0);
  });

  it("a failing cross-check still delivers the transcript", async () => {
    duration(3);
    const wa = new FakeWA();
    await processMessage(job(), deps({ wa, stt: new FakeSTT("إي فيك تدقلي"), crosscheck: new FakeSTT("", true) }), new InlineStep());
    expect(wa.sent[0].text).toBe("إي فيك تدقلي");
    expect(wa.reactions.at(-1)).toBe("✅");
  });
});

describe("persisted step state", () => {
  it("never contains transcript or tl;dr text in the clear", async () => {
    duration(95);
    const step = new InlineStep();
    await processMessage(job(), deps({ wa: new FakeWA(), stt: new FakeSTT("سر كتير خاص meeting") }), step);
    const persisted = JSON.stringify(step.outputs);
    expect(persisted).not.toContain("سر كتير خاص");
    expect(persisted).not.toContain("رايح عالاجتماع");
    expect(persisted).toMatch(/v1\./);
  });
});
