"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { CheckCircle2, Loader2 } from "lucide-react";

import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { AuthShell, authFieldClass } from "@/components/auth/auth-shell";
import { PhoneInput } from "@/components/phone-input";
import { cn } from "@/lib/utils";

export function SignUpForm() {
  const t = useTranslations("Auth");
  const locale = useLocale();
  const isRtl = locale === "ar";
  const router = useRouter();

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const data = new FormData(e.currentTarget);
    const fullName = String(data.get("fullName"));
    const phone = String(data.get("phone")).trim();
    const email = String(data.get("email"));
    const password = String(data.get("password"));

    const supabase = createClient();
    // full_name + phone + locale go into user metadata; the handle_new_user()
    // trigger copies them into the auto-created profiles row.
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, phone, locale } },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    // If email confirmation is ON, there's no session yet — tell them to check
    // their inbox. If it's OFF (recommended for local testing), we have a
    // session and can go straight to the dashboard.
    if (signUpData.session) {
      router.push(`/dashboard`);
      router.refresh();
      return;
    }

    setCheckEmail(true);
    setLoading(false);
  }

  if (checkEmail) {
    return (
      <AuthShell
        kicker={t("signUpKicker")}
        heading={t("checkEmailHeading")}
        intro={t("checkEmailIntro")}
        altPrompt={t("haveAccount")}
        altLabel={t("signInLink")}
        altHref="/sign-in"
      >
        <div className="neu-inset flex items-start gap-4 p-6">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cobalt shadow-neu-sm">
            <CheckCircle2 className="h-6 w-6 text-white" strokeWidth={1.5} />
          </span>
          <p className="text-sm leading-relaxed text-body">
            {t("checkEmailBody")}
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      kicker={t("signUpKicker")}
      heading={t("signUpHeading")}
      intro={t("signUpIntro")}
      altPrompt={t("haveAccount")}
      altLabel={t("signInLink")}
      altHref="/sign-in"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <label
            htmlFor="fullName"
            className={mono("block text-[10px] text-mutedtext")}
          >
            {t("nameLabel")}
          </label>
          <input
            id="fullName"
            name="fullName"
            type="text"
            required
            autoComplete="name"
            placeholder={t("namePlaceholder")}
            className={authFieldClass}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="phone" className={mono("block text-[10px] text-mutedtext")}>
            {t("phoneLabel")}
          </label>
          <PhoneInput
            id="phone"
            name="phone"
            placeholder={t("phonePlaceholder")}
            codeAriaLabel={t("countryCode")}
          />
        </div>

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
          {t("signUpSubmit")}
        </Button>
      </form>
    </AuthShell>
  );
}
