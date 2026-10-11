// AI usage & pricing page: one plain status line per item (D5).
//
// Pure: takes booleans only ("set / not set"), never a secret value, so the
// result is safe to hand to a client component. The page maps `level` to
// OK / Needs action / Off on purpose and `state` to one plain business
// sentence (messages AiUsage.health.<id>.<state>); `envVars` are the exact
// variable names listed under "How to fix".

export type HealthLevel = "ok" | "action" | "off";
export type HealthId = "turnstile" | "gemini" | "groq" | "cleanup" | "charging";

export type HealthInput = {
  /** store_settings.turnstile.enabled plus whether each key is set. */
  turnstile: { enabled: boolean; siteKeySet: boolean; secretSet: boolean };
  geminiKeySet: boolean;
  groqKeySet: boolean;
  /** store_settings.anonymous_cleanup */
  cleanup: { enabled: boolean; dryRun: boolean };
  /** store_settings.ai_pricing.charging; null = row not there. */
  charging: boolean | null;
};

export type HealthItem = {
  id: HealthId;
  level: HealthLevel;
  /** Message key suffix, AiUsage.health.<id>.<state>. */
  state: string;
  /** Env var names still missing (empty when none are needed). */
  envVars: string[];
};

export const ENV = {
  turnstileSite: "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  turnstileSecret: "TURNSTILE_SECRET_KEY",
  gemini: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
} as const;

/**
 * Bot check. The switch decides "off" (docs/TURNSTILE.md): off means off on
 * purpose, whether or not the keys exist. Only an ON switch with a missing key
 * needs action (the widget or the server check cannot work).
 */
export function turnstileStatus(t: HealthInput["turnstile"]): HealthItem {
  const missing = [
    ...(t.siteKeySet ? [] : [ENV.turnstileSite]),
    ...(t.secretSet ? [] : [ENV.turnstileSecret]),
  ];
  if (t.enabled) {
    return missing.length
      ? { id: "turnstile", level: "action", state: "onMissingKeys", envVars: missing }
      : { id: "turnstile", level: "ok", state: "on", envVars: [] };
  }
  return missing.length
    ? { id: "turnstile", level: "off", state: "offNoKeys", envVars: missing }
    : { id: "turnstile", level: "off", state: "offKeysReady", envVars: [] };
}

function keyStatus(id: "gemini" | "groq", set: boolean, envVar: string): HealthItem {
  return set
    ? { id, level: "ok", state: "ok", envVars: [] }
    : { id, level: "action", state: "missing", envVars: [envVar] };
}

export function cleanupStatus(c: HealthInput["cleanup"]): HealthItem {
  if (!c.enabled) return { id: "cleanup", level: "off", state: "disabled", envVars: [] };
  if (c.dryRun) return { id: "cleanup", level: "off", state: "dryRun", envVars: [] };
  return { id: "cleanup", level: "ok", state: "live", envVars: [] };
}

export function chargingStatus(charging: boolean | null): HealthItem {
  return charging === true
    ? { id: "charging", level: "ok", state: "on", envVars: [] }
    : { id: "charging", level: "off", state: "off", envVars: [] };
}

export function healthStatus(input: HealthInput): HealthItem[] {
  return [
    turnstileStatus(input.turnstile),
    keyStatus("gemini", input.geminiKeySet, ENV.gemini),
    keyStatus("groq", input.groqKeySet, ENV.groq),
    cleanupStatus(input.cleanup),
    chargingStatus(input.charging),
  ];
}
