/**
 * Duration of an Ogg Opus file (WhatsApp voice notes), read from the container itself:
 * (last page's granule position - pre-skip) / 48 kHz. Returns null if the data isn't Ogg Opus.
 */
export function oggOpusDurationSeconds(data: Uint8Array): number | null {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const isOggS = (i: number) => data[i] === 0x4f && data[i + 1] === 0x67 && data[i + 2] === 0x67 && data[i + 3] === 0x53;
  if (data.length < 64 || !isOggS(0)) return null;

  // Pre-skip lives in the OpusHead packet on the first page.
  let preSkip = 0;
  const headAt = indexOf(data, [0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 0, 200); // "OpusHead"
  if (headAt === -1) return null;
  preSkip = dv.getUint16(headAt + 10, true);

  for (let i = data.length - 27; i >= 0; i--) {
    if (!isOggS(i) || data[i + 4] !== 0) continue; // capture pattern + stream structure version 0
    const granule = dv.getBigInt64(i + 6, true);
    if (granule <= 0n) continue;
    return Math.max(0, (Number(granule) - preSkip) / 48000);
  }
  return null;
}

function indexOf(hay: Uint8Array, needle: number[], from: number, maxScan: number): number {
  const end = Math.min(hay.length - needle.length, from + maxScan);
  outer: for (let i = from; i <= end; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}
