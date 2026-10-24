"use client";

import { useState } from "react";
import { useRouter as useNextRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/components/auth/auth-shell";
import { confirmEmail, type ConfirmError } from "@/app/[locale]/confirm-email/actions";
import type { ConfirmType } from "@/lib/auth/reset-token";

// One button. The token is spent by the server action behind it, never by
// opening the page, so a scanner's pre-fetch leaves the link usable.
export function ConfirmEmailForm({
  tokenHash,
  type,
  next,
}: {
  tokenHash: string | null;
  type: ConfirmType | null;
  next: string | null;
}) {
  const t = useTranslations("Auth");
  const locale = useLocale();
  const router = useNextRouter();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ConfirmError | null>(null);

  const shell = {
    kicker: t("signUpKicker"),
    heading: t("confirmHeading"),
    altPrompt: t("haveAccount"),
    altLabel: t("signInLink"),
    altHref: "/sign-in",
  };

  // Nothing to confirm: the link was cut short by the mail client.
  if (!tokenHash || !type) {
    return (
      <AuthShell {...shell} intro={t("confirmMissing")}>
        <Button asChild size="lg" className="w-full rounded-full">
          <Link href="/sign-in">{t("signInLink")}</Link>
        </Button>
      </AuthShell>
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const result = await confirmEmail({ tokenHash, type, locale, next });
    if (!result.ok) {
      setError(result.error);
      setLoading(false);
      return;
    }
    // The action set the session cookies; refresh so the server sees them.
    router.push(result.next);
    router.refresh();
  }

  return (
    <AuthShell {...shell} intro={t("confirmIntro")}>
      <form onSubmit={handleSubmit} className="space-y-5" data-testid="confirm-form">
        {error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error === "expired" ? t("confirmExpired") : t("confirmFailed")}
          </p>
        )}

        <Button type="submit" size="lg" disabled={loading} className="w-full rounded-full">
          {loading && <Loader2 className="animate-spin" />}
          {t("confirmSubmit")}
        </Button>
      </form>
    </AuthShell>
  );
}
