"use client";

import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { CheckCircle2, Loader2 } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { AuthShell, authFieldClass } from "@/components/auth/auth-shell";
import { Turnstile, turnstileActive } from "@/components/turnstile";
import { OTP_VALID_HOURS } from "@/lib/auth/reset-token";
import { COMPANY_WHATSAPP } from "@/lib/company";
import { cn } from "@/lib/utils";

// Seconds before "Send it again" becomes pressable. Supabase also rate-limits
// the endpoint; this stops the obvious double-press that burns that budget.
const RESEND_AFTER_SEC = 60;

/**
 * The address the last reset was asked for, kept in THIS browser only so the
 * "that link expired" screen can prefill it. Never put in a URL.
 */
const LAST_EMAIL_KEY = "gestaltung:reset-email";

// turnstileEnabled (P2-08): Supabase's CAPTCHA protection also covers the
// password-reset email, so this form carries the widget too. Off (default) =
// no widget and the exact same resetPasswordForEmail call as before.
export function ForgotPasswordForm({
  expired = false,
  turnstileEnabled = false,
}: {
  expired?: boolean;
  turnstileEnabled?: boolean;
}) {
  const t = useTranslations("Auth");
  const tCheck = useTranslations("Turnstile");
  const locale = useLocale();
  const isRtl = locale === "ar";

  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const [wait, setWait] = useState(0);
  const [resent, setResent] = useState(false);
  const [prefill, setPrefill] = useState("");

  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  // Coming back from an expired link: show the address they asked for, so the
  // only thing left to do is press the button. Block body (lint).
  useEffect(() => {
    try {
      setPrefill(window.localStorage.getItem(LAST_EMAIL_KEY) ?? "");
    } catch {
      // Private window or storage blocked: the field stays empty.
    }
  }, []);

  // Visible countdown on the resend button. Block body: an expression body
  // would hand the interval's return value to React as a cleanup function.
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setInterval(() => setWait((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(timer);
  }, [wait]);

  /**
   * Whatever happens (unknown email, rate limit), the screen is the same, so
   * the form never reveals whether an account exists.
   *
   * redirectTo is a LOCALE PATH, not the old /api/auth/callback: the template
   * builds the link as `{{ .RedirectTo }}?token_hash=…&type=recovery`, and the
   * page it opens verifies nothing until the form is submitted.
   */
  async function send(email: string) {
    try {
      await createClient().auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/${locale}/reset-password`,
        ...(captcha ? { captchaToken: captcha } : {}),
      });
    } catch {
      // Intentionally ignored; see above.
    }
    try {
      window.localStorage.setItem(LAST_EMAIL_KEY, email);
    } catch {
      // Storage blocked: only the prefill after an expired link is lost.
    }
    // A Turnstile token is single-use: get a fresh one for the next send.
    if (captcha) {
      setCaptcha(null);
      setCaptchaReset((k) => k + 1);
    }
    setWait(RESEND_AFTER_SEC);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (turnstileActive(turnstileEnabled) && !captcha) {
      setError(tCheck("required"));
      return;
    }
    setLoading(true);
    const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
    await send(email);
    setSentTo(email);
    setLoading(false);
  }

  async function handleResend() {
    if (!sentTo || wait > 0) return;
    setResent(false);
    setLoading(true);
    await send(sentTo);
    setResent(true);
    setLoading(false);
  }

  const shell = {
    kicker: t("signInKicker"),
    heading: t("forgotHeading"),
    altPrompt: t("haveAccount"),
    altLabel: t("signInLink"),
    altHref: "/sign-in",
  };

  if (sentTo) {
    return (
      <AuthShell {...shell} heading={t("forgotSentHeading")} intro={t("forgotSent", { email: sentTo })}>
        <div className="neu-inset flex items-start gap-4 p-6">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cobalt shadow-neu-sm">
            <CheckCircle2 className="h-6 w-6 text-white" strokeWidth={1.5} />
          </span>
          {/* Western digits in both languages (project rule): a string, not a number. */}
          <p className="text-sm leading-relaxed text-body">{t("forgotValidFor", { hours: String(OTP_VALID_HOURS) })}</p>
        </div>

        <div className="mt-6 space-y-4">
          <Button
            type="button"
            size="lg"
            variant="outline"
            onClick={handleResend}
            disabled={loading || wait > 0}
            data-testid="resend"
            className="w-full rounded-full"
          >
            {loading && <Loader2 className="animate-spin" />}
            {wait > 0 ? t("forgotResendIn", { seconds: String(wait) }) : t("forgotResend")}
          </Button>

          {resent && wait > 0 && <p className="text-sm text-body">{t("forgotResent")}</p>}

          <p className="text-sm text-mutedtext">
            <Link
              href="/reset-password"
              className="font-semibold text-azure transition-colors hover:text-cobalt-hover"
            >
              {t("haveCode")}
            </Link>
          </p>

          <p className="text-sm text-mutedtext">
            <a
              href={COMPANY_WHATSAPP.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-azure transition-colors hover:text-cobalt-hover"
            >
              {t("forgotHelp")}
            </a>
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell {...shell} intro={t("forgotIntro")}>
      <form onSubmit={handleSubmit} className="space-y-5">
        {expired && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {t("linkUsedOrExpired")}
          </p>
        )}

        <div className="space-y-2">
          <label htmlFor="email" className={mono("block text-[10px] text-mutedtext")}>
            {t("emailLabel")}
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            defaultValue={prefill}
            key={prefill}
            autoComplete="email"
            placeholder={t("emailPlaceholder")}
            className={authFieldClass}
          />
        </div>

        <Turnstile enabled={turnstileEnabled} onToken={setCaptcha} resetKey={captchaReset} action="password_reset" />

        {error && <p className="text-sm font-medium text-destructive">{error}</p>}

        <Button type="submit" size="lg" disabled={loading} className="w-full rounded-full">
          {loading && <Loader2 className="animate-spin" />}
          {t("forgotSubmit")}
        </Button>

        <p className="text-center text-sm text-mutedtext">
          <Link href="/reset-password" className="font-semibold text-azure transition-colors hover:text-cobalt-hover">
            {t("haveCode")}
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
