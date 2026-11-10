"use client";

import * as React from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { useTranslations } from "next-intl";

import { Alert, Button, Card } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { mapAuthError } from "@/lib/cad-champions/auth/errors";
import { CC_PENDING_EMAIL_KEY, CC_RESEND_COOLDOWN_SEC, ccCallbackUrl, ccContinueHref } from "@/lib/cad-champions/auth/paths";
import { Ltr } from "@/lib/cad-champions/ltr";
import { ccPath } from "@/lib/cad-champions/routes";
import { createClient } from "@/lib/supabase/client";

import { useCountdown } from "./fields";
import { useAuthErrorText } from "./use-auth-error";

// "Check your email" after sign-up. The address comes from sessionStorage
// (cc:pending-email, set by the sign-up form), never from the URL.
export function CcCheckEmail({ locale }: { locale: Locale }) {
  const t = useTranslations("CC.auth");
  const errorText = useAuthErrorText();
  const [email, setEmail] = React.useState<string | null>(null);
  const [sending, setSending] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<{ code: string; retry?: number } | null>(null);
  // The email was just sent by sign-up, so the first resend waits too.
  const [cooldownKey, setCooldownKey] = React.useState(1);
  const left = useCountdown(CC_RESEND_COOLDOWN_SEC, cooldownKey);

  React.useEffect(() => {
    try {
      setEmail(window.sessionStorage.getItem(CC_PENDING_EMAIL_KEY));
    } catch {
      setEmail(null);
    }
  }, []);

  async function resend() {
    if (!email || left > 0 || sending) return;
    setSending(true);
    setError(null);
    setSent(false);
    try {
      const { error: resendError } = await createClient().auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: ccCallbackUrl(window.location.origin, ccContinueHref(locale)) },
      });
      if (resendError) {
        const mapped = mapAuthError(resendError);
        setError({ code: mapped.code, retry: mapped.retryAfterSec });
      } else {
        setSent(true);
      }
    } catch (e) {
      console.error("[cc-check-email] resend failed", e);
      setError({ code: "network" });
    } finally {
      setSending(false);
      setCooldownKey((k) => k + 1);
    }
  }

  const link = "font-semibold text-accent underline-offset-4 hover:underline";

  return (
    <Card className="space-y-5">
      <div className="flex items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-foreground shadow-neu-sm">
          <MailCheck aria-hidden className="h-6 w-6" strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <p className="text-sm text-body">{t("checkEmail.sentTo")}</p>
          <p className="mt-1 break-all text-base font-bold text-heading">
            {email ? <Ltr>{email}</Ltr> : t("checkEmail.noAddress")}
          </p>
        </div>
      </div>

      <p className="text-sm text-body">{t("checkEmail.steps")}</p>
      <Alert tone="info" title={t("checkEmail.spam")} />

      <div aria-live="polite">
        {sent ? <Alert tone="success" title={t("checkEmail.resent")}>{t("checkEmail.resentBody")}</Alert> : null}
        {error ? <Alert tone="error" title={t("errors.errorTitle")}>{errorText(error.code, error.retry)}</Alert> : null}
      </div>

      {email ? (
        <Button
          type="button"
          variant="secondary"
          onClick={resend}
          loading={sending}
          loadingText={t("checkEmail.resending")}
          disabled={left > 0}
          className="w-full sm:w-auto"
        >
          {left > 0 ? t("checkEmail.resendIn", { seconds: String(left) }) : t("checkEmail.resend")}
        </Button>
      ) : null}

      <div className="space-y-2 border-t border-white/60 pt-4 text-sm text-body">
        <p>
          {t("checkEmail.wrongEmail")}{" "}
          <Link href={ccPath(locale, "/sign-up")} className={`inline-flex min-h-11 items-center ${link}`}>
            {t("checkEmail.changeIt")}
          </Link>
        </p>
        <p>
          {t("checkEmail.already")}{" "}
          <Link href={ccPath(locale, "/sign-in")} className={`inline-flex min-h-11 items-center ${link}`}>
            {t("checkEmail.signIn")}
          </Link>
        </p>
      </div>
    </Card>
  );
}
