/**
 * Workflow step outputs are persisted by Cloudflare (days, for retries and inspection).
 * Anything containing transcript content is sealed with AES-GCM before it leaves a step,
 * using a key derived from a Worker secret, so the stored state is unreadable ciphertext.
 */
export interface Sealer {
  seal(value: unknown): Promise<string>;
  open<T>(sealed: string): Promise<T>;
}

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function makeSealer(secret: string): Promise<Sealer> {
  if (!secret) throw new Error("sealing secret missing");
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("whatsapp-transcriber/step-state/v1"), info: new Uint8Array() },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  return {
    async seal(value) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(value))));
      return `v1.${b64(iv)}.${b64(ct)}`;
    },
    async open<T>(sealed: string) {
      const [v, iv, ct] = sealed.split(".");
      if (v !== "v1" || !iv || !ct) throw new Error("not a sealed value");
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, key, unb64(ct));
      return JSON.parse(new TextDecoder().decode(pt)) as T;
    },
  };
}
