/** Bindings and settings. Secrets are set with `wrangler secret put`; the rest live in wrangler.toml [vars]. */
export interface Env {
  // secrets
  WA_TOKEN: string;
  WA_PHONE_NUMBER_ID: string;
  WA_APP_SECRET: string;
  WA_VERIFY_TOKEN: string;
  ALLOWED_NUMBERS: string; // comma-separated, international format without '+'
  GEMINI_API_KEY: string;
  CO_API_KEY?: string;
  CONTACT_EMAIL?: string; // shown on the privacy page
  // vars
  GRAPH_API_VERSION?: string;
  GEMINI_MODEL?: string;
  TLDR_MODEL?: string;
  TLDR_MIN_SECONDS?: string;
  MAX_AUDIO_SECONDS?: string;
  CROSSCHECK_MAX_SECONDS?: string;
  CROSSCHECK_MIN_AGREEMENT?: string;
}

export interface Settings {
  graphVersion: string;
  geminiModel: string;
  tldrModel: string;
  tldrMinSeconds: number;
  maxAudioSeconds: number;
  crosscheckMaxSeconds: number;
  crosscheckMinAgreement: number;
}

const num = (v: string | undefined, d: number) => (v !== undefined && v !== "" && !isNaN(Number(v)) ? Number(v) : d);

export function settings(env: Env): Settings {
  return {
    graphVersion: env.GRAPH_API_VERSION || "v25.0",
    geminiModel: env.GEMINI_MODEL || "gemini-3.8-flash",
    tldrModel: env.TLDR_MODEL || env.GEMINI_MODEL || "gemini-3.8-flash",
    tldrMinSeconds: num(env.TLDR_MIN_SECONDS, 60),
    maxAudioSeconds: num(env.MAX_AUDIO_SECONDS, 1800),
    crosscheckMaxSeconds: num(env.CROSSCHECK_MAX_SECONDS, 8),
    crosscheckMinAgreement: num(env.CROSSCHECK_MIN_AGREEMENT, 0.5),
  };
}

export function allowedNumbers(env: Env): Set<string> {
  return new Set((env.ALLOWED_NUMBERS || "").split(",").map((s) => s.trim().replace(/^\+/, "")).filter(Boolean));
}
