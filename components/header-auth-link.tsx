"use client";

import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { hasAccount } from "@/lib/auth/guest-redirect";
import { cn } from "@/lib/utils";

// Header link that reflects auth state: "Sign in" for anonymous visitors,
// "Dashboard" once signed in. A guest (anonymous session) counts as signed out. Done client-side so the marketing pages stay
// statically rendered. SSR/first paint shows the signed-out link (matches the
// anonymous case); it swaps to Dashboard after the session resolves.
export function HeaderAuthLink({ isRtl }: { isRtl: boolean }) {
  const t = useTranslations("Nav");
  const { user } = useAuth();
  const signedIn = hasAccount(user);

  const href = signedIn ? "/dashboard" : "/sign-in";
  const label = signedIn ? t("dashboard") : t("signIn");

  return (
    <Link
      href={href}
      className={cn(
        "hidden rounded-lg px-3 py-2 text-mutedtext transition-colors duration-300 hover:text-heading sm:block",
        isRtl ? "text-sm font-medium" : "font-mono text-[11px] uppercase tracking-wider"
      )}
    >
      {label}
    </Link>
  );
}
