"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Loader2 } from "lucide-react";

import { Link, useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { dashboardPathForRole } from "@/lib/auth/redirects";
import type { Role } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { AuthShell, authFieldClass } from "@/components/auth/auth-shell";
import { Turnstile, turnstileActive } from "@/components/turnstile";
import { cn } from "@/lib/utils";

// turnstileEnabled (P2-08): the store_settings switch from the server page.
// Off (default) = no widget and the exact same signInWithPassword call as before.
export function SignInForm({ turnstileEnabled = false }: { turnstileEnabled?: boolean }) {
  const t = useTranslations("Auth");
  const tCheck = useTranslations("Turnstile");
  const locale = useLocale();
  const isRtl = locale === "ar";
  const router = useRouter();

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);

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

    // Branch to the role-appropriate landing page (Stage 4: all → /dashboard).
    let role: Role = "client";
    const userId = signInData.user?.id;
    if (userId) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .single<{ role: Role }>();
      if (profile?.role) role = profile.role;
    }

    // Locale-agnostic path; the i18n router prepends the active locale.
    router.push(dashboardPathForRole(role));
    router.refresh();
  }

  return (
    <AuthShell
      kicker={t("signInKicker")}
      heading={t("signInHeading")}
      intro={t("signInIntro")}
      altPrompt={t("noAccount")}
      altLabel={t("signUpLink")}
      altHref="/sign-up"
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
          className="w-full rounded-full"
        >
          {loading && <Loader2 className="animate-spin" />}
          {t("signInSubmit")}
        </Button>
      </form>
    </AuthShell>
  );
}
