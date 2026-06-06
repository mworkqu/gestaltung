"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

// Header link that reflects auth state: "Sign in" for anonymous visitors,
// "Dashboard" once signed in. Done client-side so the marketing pages stay
// statically rendered. SSR/first paint shows the signed-out link (matches the
// anonymous case); it swaps to Dashboard after the session resolves.
export function HeaderAuthLink({ isRtl }: { isRtl: boolean }) {
  const t = useTranslations("Nav");
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setSignedIn(!!data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) =>
      setSignedIn(!!session)
    );
    return () => sub.subscription.unsubscribe();
  }, []);

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
