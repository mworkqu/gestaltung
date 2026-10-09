import { unstable_cache } from "next/cache";

import { SETTINGS_TAG, STOREFRONT_REVALIDATE } from "@/lib/cache/storefront";
import { createPublicClient } from "@/lib/supabase/public";
import {
  TURNSTILE_DEFAULTS,
  TURNSTILE_KEY,
  clientIp,
  parseTurnstileSettings,
  turnstileEnv,
  turnstileRequired,
  turnstileWidgetOn,
  verifyTurnstile,
  type TurnstileSettings,
} from "@/lib/turnstile";

// Turnstile on the server (P2-08). The switch is read like every other public
// setting (lib/store/public-catalog.ts pattern): cookie-free anon client +
// unstable_cache, tag "store-settings", so static / ISR pages stay static and
// a Dashboard save (revalidateStorefront) applies it at once. No row, no
// Supabase env, or any read error = OFF (today's behaviour).

export const getTurnstileSettings = unstable_cache(
  async (): Promise<TurnstileSettings> => {
    const supabase = createPublicClient();
    if (!supabase) return TURNSTILE_DEFAULTS;
    const { data, error } = await supabase.from("store_settings").select("value").eq("key", TURNSTILE_KEY).maybeSingle();
    if (error || !data) return TURNSTILE_DEFAULTS;
    return parseTurnstileSettings(data.value);
  },
  ["store-settings:turnstile"],
  { revalidate: STOREFRONT_REVALIDATE, tags: [SETTINGS_TAG] },
);

/** Does our server demand a token right now? (switch on AND both keys) */
export async function turnstileEnforced(): Promise<boolean> {
  return turnstileRequired(await getTurnstileSettings(), turnstileEnv());
}

/** For server pages: the `turnstileEnabled` prop (switch on AND a site key). */
export async function turnstileEnabledForPages(): Promise<boolean> {
  return turnstileWidgetOn(await getTurnstileSettings(), turnstileEnv().siteKey);
}

export type TurnstileCheck = { ok: true; enforced: boolean } | { ok: false; codes: string[] };

/**
 * The route-side check. Not enforced (switch off, or a key missing) → ok.
 * Enforced → the token must pass Cloudflare siteverify (remoteip from
 * x-forwarded-for). Routes answer 403 { error: "captcha_failed" } on !ok.
 */
export async function checkTurnstile(request: Request, token: string | null): Promise<TurnstileCheck> {
  const env = turnstileEnv();
  if (!turnstileRequired(await getTurnstileSettings(), env)) return { ok: true, enforced: false };
  const result = await verifyTurnstile(token, clientIp(request.headers), { secret: env.secret! });
  if (!result.ok) {
    console.warn("[turnstile] rejected:", result.codes.join(",") || "unknown");
    return { ok: false, codes: result.codes };
  }
  return { ok: true, enforced: true };
}
