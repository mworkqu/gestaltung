"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { CheckCircle2, Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { AuthShell, authFieldClass } from "@/components/auth/auth-shell";
import { cn } from "@/lib/utils";

export function ForgotPasswordForm({ expired = false }: { expired?: boolean }) {
  const t = useTranslations("Auth");
  const locale = useLocale();
  const isRtl = locale === "ar";

  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    const email = String(new FormData(e.currentTarget).get("email"));
    const next = encodeURIComponent(`/${locale}/reset-password`);

    // Whatever happens (unknown email, rate limit), show the same neutral
    // message so the form never reveals whether an account exists.
    try {
      await createClient().auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/api/auth/callback?next=${next}`,
      });
    } catch {
      // Intentionally ignored; see above.
    }

    setSent(true);
    setLoading(false);
  }

  return (
    <AuthShell
      kicker={t("signInKicker")}
      heading={t("forgotHeading")}
      intro={t("forgotIntro")}
      altPrompt={t("haveAccount")}
      altLabel={t("signInLink")}
      altHref="/sign-in"
    >
      {sent ? (
        <div className="neu-inset flex items-start gap-4 p-6">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cobalt shadow-neu-sm">
            <CheckCircle2 className="h-6 w-6 text-white" strokeWidth={1.5} />
          </span>
          <p className="text-sm leading-relaxed text-body">{t("forgotSent")}</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          {expired && (
            <p className="text-sm font-medium text-destructive">{t("linkExpired")}</p>
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
              autoComplete="email"
              placeholder={t("emailPlaceholder")}
              className={authFieldClass}
            />
          </div>

          <Button
            type="submit"
            size="lg"
            disabled={loading}
            className="w-full rounded-full"
          >
            {loading && <Loader2 className="animate-spin" />}
            {t("forgotSubmit")}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
