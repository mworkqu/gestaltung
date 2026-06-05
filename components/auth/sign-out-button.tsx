"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { LogOut } from "lucide-react";

import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const t = useTranslations("Auth");
  const locale = useLocale();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSignOut() {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleSignOut}
      disabled={loading}
      className="rounded-full"
    >
      <LogOut className={locale === "ar" ? "rotate-180" : undefined} />
      {t("signOut")}
    </Button>
  );
}
