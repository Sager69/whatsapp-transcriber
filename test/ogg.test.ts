import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { oggOpusDurationSeconds } from "../src/ogg";

const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"]); return true; } catch { return false; } })();

describe("oggOpusDurationSeconds", () => {
  it.skipIf(!hasFfmpeg)("reads the duration of a real Ogg Opus file (WhatsApp's voice-note format)", () => {
    for (const secs of [2.6, 3.5, 61.2]) {
      const f = join(mkdtempSync(join(tmpdir(), "ogg-")), "note.ogg");
      execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", `sine=frequency=440:duration=${secs}`, "-c:a", "libopus", f]);
      expect(oggOpusDurationSeconds(new Uint8Array(readFileSync(f)))).toBeCloseTo(secs, 1);
    }
  });
  it("returns null for non-Ogg data", () => {
    expect(oggOpusDurationSeconds(new TextEncoder().encode("x".repeat(100)))).toBeNull();
    expect(oggOpusDurationSeconds(new Uint8Array(0))).toBeNull();
  });
});
