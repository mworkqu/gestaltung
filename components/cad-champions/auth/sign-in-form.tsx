"use client";

import * as React from "react";
import Link from "next/link";
import { Mail } from "lucide-react";
import { useTranslations } from "next-intl";

import { Alert, Button, Card } from "@/components/cad-champions/ui";
import { Turnstile, turnstileActive } from "@/components/turnstile";
import type { Locale } from "@/i18n/routing";
import { claimGuestWorkBounded, guestAccessToken } from "@/lib/auth/claim-guest-client";
import { mapAuthError } from "@/lib/cad-champions/auth/errors";
import { CC_RESEND_COOLDOWN_SEC, ccCallbackUrl, ccContinueHref, ccSignUpHref } from "@/lib/cad-champions/auth/paths";
import { Ltr } from "@/lib/cad-champions/ltr";
import { ccPath } from "@/lib/cad-champions/routes";
import { createClient } from "@/lib/supabase/client";

import { Field, PasswordField, ccFieldClass, describedBy, useCountdown } from "./fields";
import { useAuthErrorText } from "./use-auth-error";

type Err = { code: string; retry?: number };

// Sign in (Prompt 2 Step C): email + password, or an emailed sign-in link.
// Every success goes through /cad-champions/{locale}/auth/continue (profile
// language cookie + redirect to `next`) with a full page load, so <html lang
// dir> matches the profile's language.
export function CcSignInForm({
  locale,
  next,
  turnstileEnabled = false,
  expired = false,
}: {
  locale: Locale;
  next: string | null;
  turnstileEnabled?: boolean;
  expired?: boolean;
}) {
  const t = useTranslations("CC.auth");
  const errorText = useAuthErrorText();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState<"password" | "magic" | null>(null);
  const [error, setError] = React.useState<Err | null>(null);
  const [fieldError, setFieldError] = React.useState<{ email?: string; password?: string }>({});
  const [magicSentTo, setMagicSentTo] = React.useState<string | null>(null);
  const [confirmSent, setConfirmSent] = React.useState(false);
  const [resendKey, setResendKey] = React.useState(0);
  const resendLeft = useCountdown(CC_RESEND_COOLDOWN_SEC, resendKey);
  const [captcha, setCaptcha] = React.useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = React.useState(0);
  const needsCaptcha = turnstileActive(turnstileEnabled);

  const continueHref = ccContinueHref(locale, next);

  function takeCaptcha(): string | null | false {
    if (!needsCaptcha) return null;
    if (!captcha) {
      setError({ code: "captchaRequired" });
      return false;
    }
    const token = captcha;
    setCaptcha(null);
    setCaptchaReset((k) => k + 1);
    return token;
  }

  function validEmail(): boolean {
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    if (!ok) setFieldError((f) => ({ ...f, email: "invalidEmail" }));
    return ok;
  }

  async function onPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setConfirmSent(false);
    setFieldError({});
    const emailOk = validEmail();
    if (!password) setFieldError((f) => ({ ...f, password: "required" }));
    if (!emailOk || !password) return;
    const token = takeCaptcha();
    if (token === false) return;

    setLoading("password");
    try {
      const supabase = createClient();
      // A main-site guest's work moves to the account they sign in to (same as the site's sign-in).
      const guestToken = await guestAccessToken(supabase);
      const { error: signInError } = await supabase.auth.signInWithPassword(
        token ? { email: email.trim(), password, options: { captchaToken: token } } : { email: email.trim(), password },
      );
      if (signInError) {
        const mapped = mapAuthError(signInError);
        setError({ code: mapped.code, retry: mapped.retryAfterSec });
        setLoading(null);
        return;
      }
      if (guestToken) await claimGuestWorkBounded(guestToken);
      window.location.assign(continueHref);
    } catch (err) {
      console.error("[cc-sign-in] failed", err);
      setError({ code: "network" });
      setLoading(null);
    }
  }

  async function onMagicLink() {
    if (loading) return;
    setError(null);
    setFieldError({});
    if (!email.trim()) {
      setFieldError({ email: "magicNeedsEmail" });
      document.getElementById("cc-signin-email")?.focus();
      return;
    }
    if (!validEmail()) return;
    const token = takeCaptcha();
    if (token === false) return;

    setLoading("magic");
    try {
      const { error: otpError } = await createClient().auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: false,
          emailRedirectTo: ccCallbackUrl(window.location.origin, continueHref),
          ...(token ? { captchaToken: token } : {}),
        },
      });
      // "No such user" is answered like a success on purpose: we never reveal who has an account.
      const unknownUser =
        !!otpError &&
        (otpError.code === "otp_disabled" || otpError.code === "user_not_found" || /signups not allowed/i.test(otpError.message));
      if (otpError && !unknownUser) {
        const mapped = mapAuthError(otpError);
        setError({ code: mapped.code, retry: mapped.retryAfterSec });
      } else {
        setMagicSentTo(email.trim());
      }
    } catch (err) {
      console.error("[cc-sign-in] magic link failed", err);
      setError({ code: "network" });
    } finally {
      setLoading(null);
    }
  }

  async function resendConfirmation() {
    if (resendLeft > 0) return;
    try {
      const { error: resendError } = await createClient().auth.resend({
        type: "signup",
        email: email.trim(),
        options: { emailRedirectTo: ccCallbackUrl(window.location.origin, continueHref) },
      });
      if (resendError) {
        const mapped = mapAuthError(resendError);
        setError({ code: mapped.code, retry: mapped.retryAfterSec });
      } else {
        setConfirmSent(true);
      }
    } catch (err) {
      console.error("[cc-sign-in] resend failed", err);
      setError({ code: "network" });
    } finally {
      setResendKey((k) => k + 1);
    }
  }

  const link = "inline-flex min-h-11 items-center font-semibold text-accent underline-offset-4 hover:underline";

  if (magicSentTo) {
    return (
      <Card className="space-y-4">
        <Alert tone="success" title={t("signIn.magicSentTitle")}>
          {t("signIn.magicSentBody")}
        </Alert>
        <p className="break-all text-base font-bold text-heading">
          <Ltr>{magicSentTo}</Ltr>
        </p>
        <p className="text-sm text-body">{t("checkEmail.spam")}</p>
        <Button type="button" variant="ghost" onClick={() => setMagicSentTo(null)}>
          {t("common.backToSignIn")}
        </Button>
      </Card>
    );
  }

  const emailErr = fieldError.email
    ? fieldError.email === "magicNeedsEmail"
      ? t("signIn.magicNeedsEmail")
      : errorText(fieldError.email)
    : undefined;
  const passwordErr = fieldError.password ? errorText(fieldError.password) : undefined;

  return (
    <Card className="space-y-5">
      {expired ? <Alert tone="warning" title={t("signIn.linkExpired")} /> : null}

      <div aria-live="polite">
        {error ? (
          <Alert
            tone="error"
            title={t("errors.errorTitle")}
            action={
              error.code === "emailNotConfirmed" ? (
                <Button type="button" variant="secondary" size="sm" onClick={resendConfirmation} disabled={resendLeft > 0}>
                  {resendLeft > 0 ? t("checkEmail.resendIn", { seconds: String(resendLeft) }) : t("signIn.resendConfirm")}
                </Button>
              ) : undefined
            }
          >
            {errorText(error.code, error.retry)}
            {error.code === "invalidCredentials" ? (
              <>
                {" "}
                <Link href={ccPath(locale, "/forgot-password")} className="font-semibold text-accent underline-offset-4 hover:underline">
                  {t("signIn.forgot")}
                </Link>
              </>
            ) : null}
          </Alert>
        ) : null}
        {confirmSent ? <Alert tone="success" title={t("signIn.resendConfirmDone")} className="mt-3" /> : null}
      </div>

      <form onSubmit={onPassword} noValidate className="space-y-5">
        <Field id="cc-signin-email" label={t("common.email")} error={emailErr}>
          <input
            id="cc-signin-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            dir="ltr"
            maxLength={254}
            placeholder={t("common.emailPlaceholder")}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (fieldError.email) setFieldError((f) => ({ ...f, email: undefined }));
            }}
            className={`${ccFieldClass} text-start`}
            {...describedBy("cc-signin-email", { error: emailErr })}
          />
        </Field>

        <PasswordField
          id="cc-signin-password"
          name="password"
          label={t("common.password")}
          value={password}
          onChange={(val) => {
            setPassword(val);
            if (fieldError.password) setFieldError((f) => ({ ...f, password: undefined }));
          }}
          error={passwordErr}
          autoComplete="current-password"
        />

        <div className="-mt-2 text-end">
          <Link href={ccPath(locale, "/forgot-password")} className={link}>
            {t("signIn.forgot")}
          </Link>
        </div>

        <Turnstile enabled={turnstileEnabled} onToken={setCaptcha} resetKey={captchaReset} action="cc_sign_in" />

        <Button type="submit" loading={loading === "password"} loadingText={t("signIn.submitting")} disabled={loading === "magic"} className="w-full">
          {t("signIn.submit")}
        </Button>
      </form>

      <div className="flex items-center gap-3 text-xs text-mutedtext" aria-hidden>
        <span className="h-px flex-1 bg-white/80" />
        <span>{t("common.or")}</span>
        <span className="h-px flex-1 bg-white/80" />
      </div>

      <div className="space-y-2">
        <Button
          type="button"
          variant="secondary"
          onClick={onMagicLink}
          loading={loading === "magic"}
          loadingText={t("signIn.magicSending")}
          disabled={loading === "password"}
          className="w-full"
        >
          <Mail aria-hidden className="h-4 w-4" strokeWidth={1.75} />
          {t("signIn.magicLink")}
        </Button>
        <p className="text-center text-xs text-mutedtext">{t("signIn.magicHelp")}</p>
      </div>

      <p className="border-t border-white/60 pt-4 text-sm text-body">
        {t("signIn.noAccount")}{" "}
        <Link href={ccSignUpHref(locale, next)} className={link}>
          {t("signIn.signUpLink")}
        </Link>
      </p>
    </Card>
  );
}
