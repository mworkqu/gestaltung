import { getTranslations } from "next-intl/server";
import { LayoutDashboard } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { cn } from "@/lib/utils";

// Minimal top bar for signed-in areas that lack their own sub-nav (the job
// flow). The public header is hidden on app routes, so this is the escape hatch
// (Dashboard + Sign out). Dashboard/Inventory already ship their own bars.
export async function AccountBar({ locale }: { locale: string }) {
  const t = await getTranslations("Nav");
  const isRtl = locale === "ar";

  return (
    <div className="mb-8 flex items-center justify-end gap-3 border-b border-borderstrong/60 pb-4">
      <Link
        href="/dashboard"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-mutedtext transition-colors hover:text-heading",
          isRtl ? "text-sm font-medium" : "font-mono text-[11px] uppercase tracking-wider"
        )}
      >
        <LayoutDashboard className="h-3.5 w-3.5" />
        {t("dashboard")}
      </Link>
      <SignOutButton />
    </div>
  );
}
