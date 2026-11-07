import { describe, expect, it } from "vitest";
import { RLM, buildReplies, rtlGuard, splitMessage } from "../src/formatting";

describe("rtlGuard", () => {
  it("leaves English untouched", () => expect(rtlGuard("hello there\nsecond")).toBe("hello there\nsecond"));
  it("guards Arabic paragraphs that start with English", () => {
    const [a, b] = rtlGuard("meeting بكرا الساعة ٣\nشو رأيك؟").split("\n");
    expect(a).toBe(RLM + "meeting بكرا الساعة ٣");
    expect(b).toBe("شو رأيك؟");
  });
  it("treats digits and punctuation as weak", () => {
    expect(rtlGuard("3 meetings بكرا").startsWith(RLM)).toBe(true);
    expect(rtlGuard("٣ اجتماعات").startsWith(RLM)).toBe(false);
    expect(rtlGuard("\"(Steam Deck)\" حلو").startsWith(RLM)).toBe(true);
  });
  it("is idempotent", () => { const once = rtlGuard("ok يلا"); expect(rtlGuard(once)).toBe(once); });
});

describe("splitMessage", () => {
  it("respects the limit and keeps all text", () => {
    const para = "كلمة ".repeat(300).trim();
    const text = Array(6).fill(para).join("\n\n");
    const chunks = splitMessage(text, 4096);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(4096));
    const strip = (s: string) => s.replaceAll(RLM, "").replace(/\s/g, "");
    expect(chunks.map(strip).join("")).toBe(strip(text));
  });
  it("guards chunks that start with English", () => {
    const text = "بدي احكيلك ".repeat(200).trim() + "\n\n" + "deadline يوم الخميس ".repeat(150).trim();
    for (const c of splitMessage(text, 3000))
      for (const line of c.split("\n")) if (line.trim()) expect(line[0] === RLM || /[؀-ۿ]/.test(line[0])).toBe(true);
  });
  it("hard-cuts text without spaces", () => expect(splitMessage("x".repeat(9000)).map((c) => c.length)).toEqual([4096, 4096, 808]));
});

describe("buildReplies", () => {
  it("appends an Arabic tl;dr to the end of the transcript", () => {
    const m = buildReplies("office بكرا", "رح نلتقي بكرا", true);
    expect(m).toEqual([`${RLM}office بكرا\n\n*باختصار:*\nرح نلتقي بكرا`]);
  });
  it("sends the tl;dr separately when it doesn't fit in the last message", () => {
    const transcript = "كلمة ".repeat(818).trim(); // 4089 chars: one message, no room for the tl;dr
    const m = buildReplies(transcript, "خلاصة", true);
    expect(m).toHaveLength(2);
    expect(m[1].replace(RLM, "").startsWith("*باختصار:*")).toBe(true);
    m.forEach((x) => expect(x.length).toBeLessThanOrEqual(4096));
  });
  it("English without tl;dr", () => expect(buildReplies("hi there", null, false)).toEqual(["hi there"]));
});
