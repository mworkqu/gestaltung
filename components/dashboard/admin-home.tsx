import { getTranslations } from "next-intl/server";
import { ChevronDown } from "lucide-react";

import { adminNavGroups } from "@/components/dashboard/admin-nav-groups";
import { Link } from "@/i18n/navigation";
import { loadFixParts } from "@/lib/admin/fix-data";
import { buildTiles, countConfirm, countReply, ORDER_STATUSES_TO_HANDLE, type TileKey } from "@/lib/admin/home-tiles";
import { loadStockData } from "@/lib/admin/stock-data";
import { arabicCountForm } from "@/lib/text/count";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

// The owner's first screen (P5-12): four big tiles, each one number and one
// action - Reply, Confirm, Buy, Fix - and a single "More" menu with every other
// dashboard page. The old counts / funnel / cohorts live at /dashboard/overview.
// Test data never counts (lib/admin/test-data.ts). A number that cannot be read
// shows a dash, never a wrong 0.
export async function AdminHome({ locale }: { locale: string }) {
  const t = await getTranslations("AdminHome");
  const tNav = await getTranslations("DashboardNav");
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const db = await createClient();

  const reply = Promise.resolve(
    db.from("inquiries").select("id, name, message, status, is_test").eq("status", "new").limit(1000)
  ).then(
    (r) => (r.error ? null : countReply(r.data ?? [])),
    () => null
  );
  const confirm = Promise.resolve(
    db
      .from("part_orders")
      .select("id, status, customer_name, is_test")
      .in("status", [...ORDER_STATUSES_TO_HANDLE])
      .limit(1000)
  ).then(
    (r) => (r.error ? null : countConfirm(r.data ?? [])),
    () => null
  );
  const buy = loadStockData(db, { buyOnly: true }).then(
    (d) => (d ? d.lists.buy.length : null),
    () => null
  );
  const fix = loadFixParts(db).then(
    (items) => (items ? items.length : null),
    () => null
  );

  const [r, c, b, f] = await Promise.all([reply, confirm, buy, fix]);
  const tiles = buildTiles({ reply: r ?? -1, confirm: c ?? -1, buy: b ?? -1, fix: f ?? -1 });

  const groups = adminNavGroups((k) => tNav(k));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
        <h1 className="mt-2 text-2xl font-extrabold text-heading">{t("title")}</h1>
        <p className="mt-1 text-sm text-mutedtext">{t("intro")}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {tiles.map((tile) => {
          const known = tile.count >= 0;
          const key: TileKey = tile.key;
          const help = !known
            ? t("loadError")
            : tile.count === 0
              ? t(`${key}Zero`)
              : t(`${key}Help`, { count: String(tile.count), form: arabicCountForm(tile.count) });
          const urgent = known && tile.count > 0;
          return (
            <section key={key} aria-labelledby={`tile-${key}`} className="neu flex flex-col gap-3 p-5 sm:p-6">
              <h2 id={`tile-${key}`} className="text-lg font-extrabold text-heading">
                {t(`${key}Title`)}
              </h2>
              <p className={cn("text-6xl font-extrabold leading-none tabular-nums", urgent ? "text-cobalt" : "text-heading")}>
                {known ? String(tile.count) : "—"}
              </p>
              <p className="text-sm leading-relaxed text-mutedtext">{help}</p>
              <Link
                href={tile.href}
                className="mt-auto inline-flex min-h-11 items-center justify-center rounded-xl bg-cobalt px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-cobalt-hover"
              >
                {t(`${key}Action`)}
              </Link>
            </section>
          );
        })}
      </div>

      <details className="neu group p-1">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-bold text-heading [&::-webkit-details-marker]:hidden">
          <span>
            {t("more")}
            <span className="ms-2 text-xs font-normal text-mutedtext">{t("moreHint")}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-mutedtext transition-transform group-open:rotate-180" />
        </summary>
        <nav aria-label={t("more")} className="space-y-5 px-4 pb-4 pt-2">
          {groups.map((g, gi) => (
            <div key={gi} className="space-y-1">
              {g.label && <p className={mono("px-1 text-[10px] text-faint")}>{g.label}</p>}
              <ul className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                {g.items
                  .filter((i) => i.href !== "/dashboard")
                  .map((i) => (
                    <li key={i.href}>
                      <Link href={i.href} className="block rounded-lg px-1 py-2.5 text-sm text-body hover:text-cobalt">
                        {i.label}
                      </Link>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </nav>
      </details>
    </div>
  );
}
