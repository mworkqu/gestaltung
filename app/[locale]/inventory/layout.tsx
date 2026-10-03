import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LayoutDashboard } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { getAuthUser, getSessionContext } from "@/lib/auth/get-session";
import { guestRedirect } from "@/lib/auth/guest-redirect";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { cn } from "@/lib/utils";
import { metaFor } from "@/lib/meta";
import { MessagesScope } from "@/components/i18n/messages-scope";

// Inventory is now its own top-level, signed-in area (store-first Stage 4) —
// unrelated to the store landing. Single auth gate + page container (previously
// provided by the dashboard layout) + the Items|Projects sub-nav. Any signed-in
// role may reach it; RLS scopes rows to the caller's tenant. The dashboard/
// account menu links here; it is never linked from the store landing.
export const dynamic = "force-dynamic";

export const generateMetadata = metaFor("inventory");

export default async function InventoryLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Guests (anonymous session) have no inventory: send them to /projects (D5).
  const user = await getAuthUser();
  const guestTarget = guestRedirect({ user, path: `/${locale}/inventory` });
  if (guestTarget) redirect(guestTarget);

  const session = await getSessionContext(user);
  if (!session) redirect(`/${locale}/sign-in`);

  const t = await getTranslations("Inventory");
  const isRtl = locale === "ar";

  return (
    <MessagesScope scope="all">
    <div className="container py-10">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-borderstrong/60 pb-4">
        <h1
          className={cn(
            "text-heading",
            isRtl
              ? "text-base font-bold"
              : "font-mono text-[11px] uppercase tracking-wider"
          )}
        >
          {t("title")}
        </h1>
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-mutedtext transition-colors hover:text-heading",
              isRtl ? "text-sm font-medium" : "font-mono text-[11px] uppercase tracking-wider"
            )}
          >
            <LayoutDashboard className="h-3.5 w-3.5" />
            {t("backToDashboard")}
          </Link>
          <SignOutButton />
        </div>
      </div>
      <div className="pt-8">{children}</div>
    </div>
    </MessagesScope>
  );
}
