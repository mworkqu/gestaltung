import { getTranslations, setRequestLocale } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { loadFixParts } from "@/lib/admin/fix-data";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

// The Fix tile's target: published products missing a photo, price, supplier
// or delivery date, with what is missing and a link to edit. super_admin only.

export const dynamic = "force-dynamic";

export default async function FixPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("AdminHome");
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const db = await createClient();
  const items = await loadFixParts(db);

  return (
    <div className="space-y-6">
      <div>
        <p className={mono("text-[10px] text-azure")}>{t("fixKicker")}</p>
        <h1 className="mt-2 text-2xl font-extrabold text-heading">{t("fixPageTitle")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-mutedtext">{t("fixIntro")}</p>
      </div>
      {items === null ? (
        <p className="neu p-6 text-sm text-mutedtext">{t("loadError")}</p>
      ) : items.length === 0 ? (
        <p className="neu p-6 text-sm text-mutedtext">{t("fixEmpty")}</p>
      ) : (
        <ul className="space-y-2">
          {items.map(({ part, issues }) => (
            <li key={String(part.id)} className="neu flex flex-wrap items-center justify-between gap-3 p-3 sm:p-4">
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-semibold text-heading">{part.name}</p>
                <p className="mt-0.5 text-xs text-mutedtext">
                  {t("fixMissing")} {issues.map((i) => t(`issue_${i}`)).join(" · ")}
                </p>
              </div>
              <Link
                href={`/dashboard/store/${part.id}/edit`}
                className="inline-flex min-h-11 items-center rounded-lg bg-cobalt px-3 py-2 text-xs font-semibold text-white hover:bg-cobalt-hover"
              >
                {t("fixEdit")}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
