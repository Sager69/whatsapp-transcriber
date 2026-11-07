import { describe, expect, it } from "vitest";
import { makeSealer } from "../src/seal";

describe("sealer", () => {
  it("round-trips values and hides the plaintext", async () => {
    const s = await makeSealer("k");
    const sealed = await s.seal({ text: "مرحبا" });
    expect(sealed).not.toContain("مرحبا");
    expect(await s.open(sealed)).toEqual({ text: "مرحبا" });
  });
  it("can't be opened with a different secret", async () => {
    const sealed = await (await makeSealer("a")).seal("x");
    await expect((await makeSealer("b")).open(sealed)).rejects.toThrow();
  });
  it("uses a fresh IV each time", async () => {
    const s = await makeSealer("k");
    expect(await s.seal("same")).not.toBe(await s.seal("same"));
  });
});
