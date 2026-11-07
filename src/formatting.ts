/** Reply formatting: right-to-left safety and WhatsApp's message-length limit. */
export const RLM = "\u200f"; // RIGHT-TO-LEFT MARK: invisible, strongly RTL
export const WA_MAX_CHARS = 4096;

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const RTL_SCRIPT = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}]/u;
const LETTER = /\p{L}/u;

export const hasArabic = (t: string) => ARABIC.test(t);

/** 'R' or 'L' for the first strongly-directional character (digits/punctuation are weak), else null. */
function firstStrong(text: string): "R" | "L" | null {
  for (const ch of text) {
    if (ch === RLM) return "R";
    if (LETTER.test(ch)) return RTL_SCRIPT.test(ch) ? "R" : "L";
  }
  return null;
}

/**
 * Make every paragraph of Arabic/mixed text render right-to-left. WhatsApp takes a paragraph's
 * direction from its first strong character, so a paragraph opening with an English word is laid
 * out LTR and the Arabic in it gets jumbled. An invisible RLM in front fixes that.
 */
export function rtlGuard(text: string): string {
  if (!hasArabic(text)) return text;
  return text
    .split("\n")
    .map((line) => (line.trim() && firstStrong(line) !== "R" ? RLM + line : line))
    .join("\n");
}

function cutPoint(window: string): number {
  const floor = Math.floor(window.length / 2);
  for (const seps of [["\n\n"], ["\n"], [". ", "? ", "! ", "؟ ", "، "], [" "]]) {
    let best = -1;
    for (const sep of seps) {
      const i = window.lastIndexOf(sep);
      if (i !== -1) best = Math.max(best, i + sep.length);
    }
    if (best > floor) return best;
  }
  return window.length;
}

/** Split into chunks of at most `limit` chars on natural boundaries; Arabic chunks keep their RTL guard. */
export function splitMessage(text: string, limit = WA_MAX_CHARS): string[] {
  let rest = text.trim();
  const chunks: string[] = [];
  while (rest.length > limit) {
    const cut = cutPoint(rest.slice(0, limit));
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return hasArabic(text) ? chunks.map(rtlGuard) : chunks;
}

export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Messages to send back, in order: the transcript chunk(s), with the tl;dr appended to the last one
 * (or as its own message when it doesn't fit under WhatsApp's limit).
 */
export function buildReplies(transcript: string, tldr: string | null, arabic: boolean, limit = WA_MAX_CHARS): string[] {
  const out = splitMessage(arabic ? rtlGuard(transcript) : transcript, limit);
  if (tldr) {
    const block = `${arabic ? "*باختصار:*" : "*tl;dr:*"}\n${tldr.trim()}`;
    const guarded = arabic ? rtlGuard(block) : block;
    const last = out.length - 1;
    if (last >= 0 && out[last].length + 2 + guarded.length <= limit) out[last] = `${out[last]}\n\n${guarded}`;
    else out.push(...splitMessage(guarded, limit));
  }
  return out;
}
