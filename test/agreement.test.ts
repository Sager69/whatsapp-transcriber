import { describe, expect, it } from "vitest";
import { agreement } from "../src/agreement";

describe("agreement", () => {
  // Real pairs from the bake-off (Gemini vs Cohere on notes under 8 seconds).
  it("flags the invented short-note transcript", () => expect(agreement("If they are the egg man.", "Give the Arabic name")).toBeLessThan(0.5));
  it("accepts spelling variants as agreement", () => {
    expect(agreement("أنا عارف الكلام هذا بديهي وتقليدي", "انا عارف الكلام هذا بديهي و تقليدي <hesitation>")).toBeGreaterThan(0.9);
    expect(agreement("إذا عندك الـ Steam Deck وضعك ممتاز ترى شي رائع", "إذا عندك الستيم ديك وضعك ممتاز ترى كثير رائع")).toBeGreaterThan(0.5);
  });
  it("matches Python difflib's ratio", () => expect(agreement("abcd", "bcde")).toBeCloseTo(0.75, 5));
  it("two empty transcripts agree", () => expect(agreement("", "")).toBe(1));
});
