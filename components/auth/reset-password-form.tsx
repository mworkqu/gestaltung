"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { CheckCircle2, Loader2 } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { AuthShell, authFieldClass } from "@/components/auth/auth-shell";
import { resetPasswordWithCode, resetPasswordWithHash, type ResetError } from "@/app/[locale]/reset-password/actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { cn } from "@/lib/utils";

// Two ways in, one password form (2026-10):
//  - tokenHash: the link from the email. It is only a hidden field here; the
//    server action verifies it when the form is submitted, so a mail scanner
//    that opens the link cannot spend the token.
//  - no tokenHash: the person types the address the email went to and the
//    6-digit code printed in it. Works in any browser and on any device, so a
//    reset requested on a laptop can be finished on a phone (no PKCE cookie).
export function ResetPasswordForm({ tokenHash }: { tokenHash: string | null }) {
  const t = useTranslations("Auth");
  const locale = useLocale();
  const isRtl = locale === "ar";

  const [error, setError] = useState<ResetError | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const data = new FormData(e.currentTarget);
    const password = String(data.get("password") ?? "");
    const confirm = String(data.get("confirm") ?? "");

    // Same checks as the action, so the common mistakes answer without a round trip.
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError("weak_password");
      return;
    }
    if (password !== confirm) {
      setError("mismatch");
      return;
    }

    setLoading(true);
    const result = tokenHash
      ? await resetPasswordWithHash({ tokenHash, password, confirm })
      : await resetPasswordWithCode({
          email: String(data.get("email") ?? ""),
          code: String(data.get("code") ?? ""),
          password,
          confirm,
        });
    if (result.ok) {
      setDone(true);
      setLoading(false);
      return;
    }
    setError(result.error);
    setLoading(false);
  }

  const shell = {
    kicker: t("signInKicker"),
    heading: tokenHash ? t("resetHeading") : t("resetCodeHeading"),
    altPrompt: t("haveAccount"),
    altLabel: t("signInLink"),
    altHref: "/sign-in",
  };

  if (done) {
    return (
      <AuthShell {...shell} heading={t("passwordUpdatedHeading")} intro={t("passwordUpdated")}>
        <div className="neu-inset mb-6 flex items-start gap-4 p-6">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cobalt shadow-neu-sm">
            <CheckCircle2 className="h-6 w-6 text-white" strokeWidth={1.5} />
          </span>
          <p className="text-sm leading-relaxed text-body">{t("passwordUpdated")}</p>
        </div>
        <Button asChild size="lg" className="w-full rounded-full">
          <Link href="/sign-in">{t("signInLink")}</Link>
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell {...shell} intro={tokenHash ? t("resetIntro") : t("resetCodeIntro")}>
      <form onSubmit={handleSubmit} className="space-y-5" data-testid="reset-form">
        {!tokenHash && (
          <>
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
              <label htmlFor="code" className={mono("block text-[10px] text-mutedtext")}>
                {t("codeLabel")}
              </label>
              <input
                id="code"
                name="code"
                type="text"
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                placeholder={t("codePlaceholder")}
                // Western digits in both languages (project rule), left to right.
                dir="ltr"
                className={cn(authFieldClass, "tracking-[0.3em]")}
              />
            </div>
          </>
        )}

        <div className="space-y-2">
          <label htmlFor="password" className={mono("block text-[10px] text-mutedtext")}>
            {t("newPasswordLabel")}
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            placeholder={t("passwordPlaceholder")}
            className={authFieldClass}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="confirm" className={mono("block text-[10px] text-mutedtext")}>
            {t("confirmPasswordLabel")}
          </label>
          <input
            id="confirm"
            name="confirm"
            type="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            placeholder={t("passwordPlaceholder")}
            className={authFieldClass}
          />
        </div>

        {error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {errorText(t, error)}
          </p>
        )}

        <Button type="submit" size="lg" disabled={loading} className="w-full rounded-full">
          {loading && <Loader2 className="animate-spin" />}
          {t("resetSubmit")}
        </Button>

        {/* An expired or already-used token: the only way on is a fresh email. */}
        {(error === "expired" || error === "too_many") && (
          <Link
            href="/forgot-password"
            className="block text-center text-sm font-semibold text-azure transition-colors hover:text-cobalt-hover"
          >
            {t("requestNewLink")}
          </Link>
        )}
      </form>
    </AuthShell>
  );
}

function errorText(t: (key: string) => string, error: ResetError): string {
  switch (error) {
    case "mismatch":
      return t("passwordMismatch");
    case "weak_password":
      return t("resetWeakPassword");
    case "invalid_email":
      return t("resetInvalidEmail");
    case "invalid_code":
      return t("resetInvalidCode");
    case "too_many":
      return t("resetTooMany");
    case "expired":
      return t("linkUsedOrExpired");
    default:
      return t("resetError");
  }
}
