"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Loader2 } from "lucide-react";

import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { dashboardPathForRole } from "@/lib/auth/redirects";
import type { Role } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { AuthShell, authFieldClass } from "@/components/auth/auth-shell";
import { cn } from "@/lib/utils";

export function SignInForm() {
  const t = useTranslations("Auth");
  const locale = useLocale();
  const isRtl = locale === "ar";
  const router = useRouter();

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const data = new FormData(e.currentTarget);
    const email = String(data.get("email"));
    const password = String(data.get("password"));

    const supabase = createClient();
    const { data: signInData, error: signInError } =
      await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      setError(t("errorInvalid"));
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
