/** Agreement between two independent transcripts, used to flag invented text on short notes. */

export function normalize(t: string): string {
  return t
    .replace(/<[^>]+>/g, " ") // e.g. <hesitation> tags
    .replace(/[ً-ْـ]/g, "") // diacritics, tatweel
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

/** Ratcliff/Obershelp similarity (same measure as Python's difflib ratio), 0..1. */
export function agreement(a: string, b: string): number {
  const x = [...normalize(a)], y = [...normalize(b)];
  if (!x.length && !y.length) return 1;
  return (2 * matches(x, 0, x.length, y, 0, y.length)) / (x.length + y.length);
}

function matches(a: string[], alo: number, ahi: number, b: string[], blo: number, bhi: number): number {
  // longest common substring in a[alo:ahi], b[blo:bhi]
  let best = 0, bi = alo, bj = blo;
  let prev = new Array(bhi - blo + 1).fill(0);
  for (let i = alo; i < ahi; i++) {
    const cur = new Array(bhi - blo + 1).fill(0);
    for (let j = blo; j < bhi; j++) {
      if (a[i] === b[j]) {
        const k = prev[j - blo] + 1;
        cur[j - blo + 1] = k;
        if (k > best) { best = k; bi = i - k + 1; bj = j - k + 1; }
      }
    }
    prev = cur;
  }
  if (!best) return 0;
  return best + matches(a, alo, bi, b, blo, bj) + matches(a, bi + best, ahi, b, bj + best, bhi);
}
