/** Minimal WhatsApp Cloud API client (Graph API) and webhook signature check. */

export async function verifySignature(appSecret: string, body: ArrayBuffer, header: string | null): Promise<boolean> {
  if (!appSecret || !header?.startsWith("sha256=")) return false;
  const given = header.slice(7);
  if (!/^[0-9a-f]{64}$/i.test(given)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const sig = new Uint8Array(given.match(/../g)!.map((h) => parseInt(h, 16)));
  return crypto.subtle.verify("HMAC", key, sig, body); // constant-time comparison
}

export interface WhatsAppApi {
  downloadMedia(mediaId: string): Promise<{ data: Uint8Array; mime: string }>;
  replyText(to: string, text: string, replyTo?: string): Promise<void>;
  react(to: string, messageId: string, emoji: string): Promise<void>;
}

export class WhatsApp implements WhatsAppApi {
  private base: string;
  constructor(private token: string, private phoneNumberId: string, graphVersion: string) {
    this.base = `https://graph.facebook.com/${graphVersion}`;
  }

  private async get(url: string): Promise<Response> {
    const r = await fetch(url, { headers: { authorization: `Bearer ${this.token}` } });
    if (!r.ok) throw new Error(`Graph GET ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return r;
  }

  async downloadMedia(mediaId: string) {
    const meta = (await (await this.get(`${this.base}/${mediaId}`)).json()) as { url: string; mime_type?: string };
    const data = new Uint8Array(await (await this.get(meta.url)).arrayBuffer());
    return { data, mime: (meta.mime_type ?? "audio/ogg").split(";")[0].trim() };
  }

  private async send(payload: Record<string, unknown>) {
    const r = await fetch(`${this.base}/${this.phoneNumberId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
    });
    if (!r.ok) throw new Error(`Graph send ${r.status}: ${(await r.text()).slice(0, 300)}`);
  }

  replyText(to: string, text: string, replyTo?: string) {
    return this.send({ to, type: "text", text: { body: text, preview_url: false }, ...(replyTo ? { context: { message_id: replyTo } } : {}) });
  }

  react(to: string, messageId: string, emoji: string) {
    return this.send({ to, type: "reaction", reaction: { message_id: messageId, emoji } });
  }
}
