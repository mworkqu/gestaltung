"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Alert, Button, Card, SkeletonText, useToast } from "@/components/cad-champions/ui";
import { Turnstile, turnstileActive } from "@/components/turnstile";
import type { Locale } from "@/i18n/routing";
import { mapAuthError } from "@/lib/cad-champions/auth/errors";
import { ccCallbackUrl, ccContinueHref } from "@/lib/cad-champions/auth/paths";
import { checkPassword } from "@/lib/cad-champions/profile/password";
import { ccPath } from "@/lib/cad-champions/routes";
import { createClient } from "@/lib/supabase/client";

import { Field, PasswordField, ccFieldClass, describedBy } from "./fields";
import { useAuthErrorText } from "./use-auth-error";

const link = "inline-flex min-h-11 items-center font-semibold text-accent underline-offset-4 hover:underline";

/** "Forgot password": emails a reset link that lands on /cad-champions/{locale}/reset-password. */
export function CcForgotPasswordForm({
  locale,
  expired = false,
  turnstileEnabled = false,
}: {
  locale: Locale;
  expired?: boolean;
  turnstileEnabled?: boolean;
}) {
  const t = useTranslations("CC.auth");
  const errorText = useAuthErrorText();
  const [email, setEmail] = React.useState("");
  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<{ code: string; retry?: number } | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [captcha, setCaptcha] = React.useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = React.useState(0);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setFieldError("invalidEmail");
      return;
    }
    if (turnstileActive(turnstileEnabled) && !captcha) {
      setError({ code: "captchaRequired" });
      return;
    }
    setLoading(true);
    try {
      const { error: resetError } = await createClient().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: ccCallbackUrl(window.location.origin, ccPath(locale, "/reset-password")),
        ...(captcha ? { captchaToken: captcha } : {}),
      });
      if (captcha) {
        setCaptcha(null);
        setCaptchaReset((k) => k + 1);
      }
      // Unknown addresses are answered like a success on purpose.
      if (resetError && mapAuthError(resetError).code !== "unknown") {
        const mapped = mapAuthError(resetError);
        setError({ code: mapped.code, retry: mapped.retryAfterSec });
      } else {
        if (resetError) console.error("[cc-forgot] reset failed", resetError.message);
        setSent(true);
      }
    } catch (err) {
      console.error("[cc-forgot] failed", err);
      setError({ code: "network" });
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <Card className="space-y-4">
        <Alert tone="success" title={t("forgot.sentTitle")}>
          {t("forgot.sentBody")}
        </Alert>
        <p className="text-sm text-body">{t("checkEmail.spam")}</p>
        <Link href={ccPath(locale, "/sign-in")} className={link}>
          {t("common.backToSignIn")}
        </Link>
      </Card>
    );
  }

  const emailErr = fieldError ? errorText(fieldError) : undefined;

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        {expired ? <Alert tone="warning" title={t("forgot.expired")} /> : null}
        <div aria-live="polite">
          {error ? <Alert tone="error" title={t("errors.errorTitle")}>{errorText(error.code, error.retry)}</Alert> : null}
        </div>
        <Field id="cc-forgot-email" label={t("common.email")} error={emailErr}>
          <input
            id="cc-forgot-email"
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
              setFieldError(null);
            }}
            className={`${ccFieldClass} text-start`}
            {...describedBy("cc-forgot-email", { error: emailErr })}
          />
        </Field>
        <Turnstile enabled={turnstileEnabled} onToken={setCaptcha} resetKey={captchaReset} action="cc_reset" />
        <Button type="submit" loading={loading} loadingText={t("forgot.submitting")} className="w-full">
          {t("forgot.submit")}
        </Button>
        <Link href={ccPath(locale, "/sign-in")} className={link}>
          {t("common.backToSignIn")}
        </Link>
      </form>
    </Card>
  );
}

/**
 * "Choose a new password": the reset link signs the user in through
 * /api/auth/callback (recovery session), then this form calls updateUser.
 * No session = the link expired or was used: ask for a new one.
 */
export function CcResetPasswordForm({ locale }: { locale: Locale }) {
  const t = useTranslations("CC.auth");
  const errorText = useAuthErrorText();
  const toast = useToast();
  const [session, setSession] = React.useState<"checking" | "yes" | "no">("checking");
  const [password, setPassword] = React.useState("");
  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<{ code: string; retry?: number } | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [done, setDone] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (!cancelled) setSession(data.user && !data.user.is_anonymous ? "yes" : "no");
      })
      .catch(() => {
        if (!cancelled) setSession("no");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    const rules = checkPassword(password);
    if (!rules.length || !rules.number) {
      setFieldError("passwordRules");
      return;
    }
    setLoading(true);
    try {
      const { error: updateError } = await createClient().auth.updateUser({ password });
      if (updateError) {
        const mapped = mapAuthError(updateError);
        setError({ code: mapped.code, retry: mapped.retryAfterSec });
      } else {
        setDone(true);
        toast.success(t("reset.doneTitle"), t("reset.doneBody"));
      }
    } catch (err) {
      console.error("[cc-reset] failed", err);
      setError({ code: "network" });
    } finally {
      setLoading(false);
    }
  }

  if (session === "checking") {
    return (
      <Card>
        <p className="sr-only">{t("reset.checking")}</p>
        <SkeletonText lines={3} />
      </Card>
    );
  }

  if (session === "no") {
    return (
      <Card>
        <Alert
          tone="warning"
          title={t("reset.noSessionTitle")}
          action={
            <Link href={ccPath(locale, "/forgot-password")} className={link}>
              {t("reset.requestNew")}
            </Link>
          }
        >
          {t("reset.noSessionBody")}
        </Alert>
      </Card>
    );
  }

  if (done) {
    return (
      <Card className="space-y-4">
        <Alert tone="success" title={t("reset.doneTitle")}>
          {t("reset.doneBody")}
        </Alert>
        <Button type="button" onClick={() => window.location.assign(ccContinueHref(locale))}>
          {t("reset.continue")}
        </Button>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <div aria-live="polite">
          {error ? <Alert tone="error" title={t("errors.errorTitle")}>{errorText(error.code, error.retry)}</Alert> : null}
        </div>
        <PasswordField
          id="cc-reset-password"
          name="password"
          label={t("reset.newPassword")}
          value={password}
          onChange={(v) => {
            setPassword(v);
            setFieldError(null);
          }}
          error={fieldError ? errorText(fieldError) : undefined}
          autoComplete="new-password"
          showRules
        />
        <Button type="submit" loading={loading} loadingText={t("reset.submitting")} className="w-full">
          {t("reset.submit")}
        </Button>
      </form>
    </Card>
  );
}
