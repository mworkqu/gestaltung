"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { CheckCircle2, Loader2 } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { AuthShell, authFieldClass } from "@/components/auth/auth-shell";
import { cn } from "@/lib/utils";

export function ResetPasswordForm({ hasSession }: { hasSession: boolean }) {
  const t = useTranslations("Auth");
  const locale = useLocale();
  const isRtl = locale === "ar";

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const data = new FormData(e.currentTarget);
    const password = String(data.get("password"));
    const confirm = String(data.get("confirm"));

    if (password !== confirm) {
      setError(t("passwordMismatch"));
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(t("resetError"));
      setLoading(false);
      return;
    }

    // The recovery link signed them in; end that session so they sign in
    // normally with the new password.
    await supabase.auth.signOut();
    setDone(true);
    setLoading(false);
  }

  const shell = {
    kicker: t("signInKicker"),
    heading: t("resetHeading"),
    altPrompt: t("haveAccount"),
    altLabel: t("signInLink"),
    altHref: "/sign-in",
  };

  // No recovery session: the link was missing, expired or already used.
  if (!hasSession && !done) {
    return (
      <AuthShell {...shell} intro={t("linkExpired")}>
        <Button asChild size="lg" className="w-full rounded-full">
          <Link href="/forgot-password">{t("requestNewLink")}</Link>
        </Button>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell {...shell} intro={t("resetIntro")}>
        <div className="neu-inset flex items-start gap-4 p-6">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cobalt shadow-neu-sm">
            <CheckCircle2 className="h-6 w-6 text-white" strokeWidth={1.5} />
          </span>
          <p className="text-sm leading-relaxed text-body">{t("passwordUpdated")}</p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell {...shell} intro={t("resetIntro")}>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <label
            htmlFor="password"
            className={mono("block text-[10px] text-mutedtext")}
          >
            {t("newPasswordLabel")}
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            placeholder={t("passwordPlaceholder")}
            className={authFieldClass}
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="confirm"
            className={mono("block text-[10px] text-mutedtext")}
          >
            {t("confirmPasswordLabel")}
          </label>
          <input
            id="confirm"
            name="confirm"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            placeholder={t("passwordPlaceholder")}
            className={authFieldClass}
          />
        </div>

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
          {t("resetSubmit")}
        </Button>
      </form>
    </AuthShell>
  );
}
