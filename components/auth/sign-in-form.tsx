"use client";

import { useEffect, useState } from "react";
import { useRouter as useNextRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { Loader2 } from "lucide-react";

import { Link, useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { dashboardPathForRole } from "@/lib/auth/redirects";
import { authAltHref, returnsToProject } from "@/lib/auth/next-path";
import { claimGuestWorkBounded, guestAccessToken } from "@/lib/auth/claim-guest-client";
import type { Role } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { AuthShell, authFieldClass } from "@/components/auth/auth-shell";
import { Turnstile, turnstileActive } from "@/components/turnstile";
import { cn } from "@/lib/utils";

// turnstileEnabled (P2-08): the store_settings switch from the server page.
// Off (default) = no widget and the exact same signInWithPassword call as before.
// next (W1): an already-validated "/{locale}/…" path (lib/auth/next-path.ts)
// to return to after signing in; null = the role's dashboard.
export function SignInForm({ turnstileEnabled = false, next = null }: { turnstileEnabled?: boolean; next?: string | null }) {
  const t = useTranslations("Auth");
  const tClaim = useTranslations("GuestClaim");
  const nextRouter = useNextRouter();
  const tCheck = useTranslations("Turnstile");
  const locale = useLocale();
  const isRtl = locale === "ar";
  const router = useRouter();

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);

  // Warm the page they land on while they type (sign-in should feel quick): the page
  // they return to, else the dashboard every role lands on today.
  useEffect(() => {
    if (next) nextRouter.prefetch(next);
    else router.prefetch(dashboardPathForRole("client"));
  }, [next, nextRouter, router]);

  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const data = new FormData(e.currentTarget);
    const email = String(data.get("email"));
    const password = String(data.get("password"));

    if (turnstileActive(turnstileEnabled) && !captcha) {
      setError(tCheck("required"));
      setLoading(false);
      return;
    }

    const supabase = createClient();
    // W1: a guest's work belongs to their ANONYMOUS user. Signing in swaps the
    // session for another auth.uid(), so keep the guest token now and hand it
    // to /api/auth/claim-guest once the new session exists.
    const guestToken = await guestAccessToken(supabase);
    const { data: signInData, error: signInError } =
      await supabase.auth.signInWithPassword(
        captcha ? { email, password, options: { captchaToken: captcha } } : { email, password }
      );
    // The token is single-use: get a fresh one for any next attempt.
    if (captcha) setCaptchaReset((k) => k + 1);

    if (signInError) {
      setError(/captcha/i.test(signInError.message) ? tCheck("captchaFailed") : t("errorInvalid"));
      setLoading(false);
      return;
    }

    // Never throws; a failure is kept for this tab and the site shows "Try again".
    // W8: waits at most a few seconds, so a slow claim cannot stall the redirect (a
    // late one clears the notice itself and reloads, so the account's data shows).
    if (guestToken) await claimGuestWorkBounded(guestToken, { onLateDone: () => window.location.reload() });

    // Back to where they were (a Studio step …): no role lookup needed.
    if (next) {
      nextRouter.push(next);
      nextRouter.refresh();
      return;
    }

    // Branch to the role-appropriate landing page (Stage 4: all → /dashboard). W8: no
    // profiles lookup here: the role is read from the session when it carries one,
    // else the default (every role lands on the same page today).
    const claimed = signInData.user?.app_metadata?.role;
    const role: Role = claimed === "super_admin" || claimed === "workshop" || claimed === "client" ? claimed : "client";

    // Locale-agnostic path; the i18n router prepends the active locale.
    router.push(dashboardPathForRole(role));
    router.refresh();
  }

  return (
    <AuthShell
      kicker={t("signInKicker")}
      heading={t("signInHeading")}
      intro={returnsToProject(next) ? tClaim("signInIntro") : t("signInIntro")}
      altPrompt={t("noAccount")}
      altLabel={t("signUpLink")}
      altHref={authAltHref("/sign-up", next)}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <label htmlFor="email" className={mono("block text-[10px] text-mutedtext")}>
            {t("emailLabel")}
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder={t("emailPlaceholder")}
            className={authFieldClass}
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="password"
            className={mono("block text-[10px] text-mutedtext")}
          >
            {t("passwordLabel")}
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            placeholder={t("passwordPlaceholder")}
            className={authFieldClass}
          />
        </div>

        <div className="-mt-2 text-end">
          <Link
            href="/forgot-password"
            className="text-sm font-semibold text-azure transition-colors hover:text-cobalt-hover"
          >
            {t("forgotLink")}
          </Link>
        </div>

        <Turnstile enabled={turnstileEnabled} onToken={setCaptcha} resetKey={captchaReset} action="sign_in" />

        {error && (
          <p className="text-sm font-medium text-destructive">{error}</p>
        )}

        <Button
          type="submit"
          size="lg"
          disabled={loading}
          aria-busy={loading}
          className="w-full rounded-full"
        >
          {loading && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />}
          {loading ? t("signingIn") : t("signInSubmit")}
        </Button>
      </form>
    </AuthShell>
  );
}
