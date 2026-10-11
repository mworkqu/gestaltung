import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { buildLabel } from "@/lib/version";
import pkg from "@/package.json";

// D7: the single compact footer line inside /dashboard (max 48px tall).
export async function DashboardFooter() {
  const t = await getTranslations("Footer");
  const build = buildLabel(process.env.VERCEL_GIT_COMMIT_SHA, pkg.version);
  return (
    <footer className="border-t border-borderstrong/40 bg-surface">
      <div className="container flex h-12 max-h-12 items-center justify-between gap-3 overflow-hidden text-xs text-mutedtext">
        <p className="truncate">
          {t("dashboardLine")} · <span className="font-mono" dir="ltr">{build}</span>
        </p>
        <Link href="/contact" className="inline-flex shrink-0 items-center font-semibold text-cobalt hover:text-cobalt-hover">
          {t("dashboardHelp")}
        </Link>
      </div>
    </footer>
  );
}
