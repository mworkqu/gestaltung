import { Suspense, type ReactNode } from "react";
import { getTranslations } from "next-intl/server";

import { AdminOverview } from "@/components/dashboard/admin-overview";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "@/i18n/navigation";
import { loadFixParts } from "@/lib/admin/fix-data";
import { buildTiles, countConfirm, countReply, ORDER_STATUSES_TO_HANDLE, type TileKey } from "@/lib/admin/home-tiles";
import { NUMBERS_ANCHOR } from "@/lib/admin/nav";
import { loadStockData } from "@/lib/admin/stock-data";
import { arabicCountForm } from "@/lib/text/count";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

// The owner's dashboard Home. D2 (2026-10-11): "Numbers & funnels" merged in -
// its cards, funnel and latest lists are the top section (#numbers, the old
// /dashboard/overview redirects there), the four action tiles (Reply, Confirm,
// Buy, Fix; P5-12) stay below. Every other page is in the sidebar, so the old
// "More" menu is gone. Test data never counts (lib/admin/test-data.ts). A
// number that cannot be read shows a dash, never a wrong 0.
export async function AdminHome({ locale }: { locale: string }) {
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
      .not("is_test", "is", true) // orders marked as test (D3) never count; countConfirm also drops TEST-looking rows
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

  // Not awaited here: the numbers section renders while the tiles load.
  const counts = Promise.all([reply, confirm, buy, fix]).then(([r, c, b, f]) => ({
    reply: r ?? -1,
    confirm: c ?? -1,
    buy: b ?? -1,
    fix: f ?? -1,
  }));
  return <AdminHomeView locale={locale} counts={counts} numbers={<AdminOverview locale={locale} embedded />} />;
}

type Counts = Record<TileKey, number>;

/**
 * Home for given counts (-1 = could not be read) and an optional numbers
 * section. No I/O of its own (the e2e fixture renders it with sample counts).
 */
export async function AdminHomeView({
  locale,
  counts,
  numbers,
}: {
  locale: string;
  counts: Counts | Promise<Counts>;
  numbers?: ReactNode;
}) {
  const t = await getTranslations("AdminHome");
  const tNav = await getTranslations("DashboardNav");
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
        <h1 className="mt-2 text-2xl font-extrabold text-heading">{t("title")}</h1>
      </div>

      {/* D4: the "Continue where you left off" card goes here. */}

      {numbers && (
        <section id={NUMBERS_ANCHOR} aria-labelledby="home-numbers" className="scroll-mt-6 space-y-4">
          <h2 id="home-numbers" className="sr-only">
            {tNav("numbers")}
          </h2>
          {numbers}
        </section>
      )}

      <section aria-labelledby="home-todo" className="space-y-4">
        <div>
          <h2 id="home-todo" className="text-lg font-extrabold text-heading">
            {tNav("homeTodo")}
          </h2>
          <p className="mt-1 text-sm text-mutedtext">{t("intro")}</p>
        </div>
        <Suspense fallback={<TilesSkeleton />}>
          <Tiles counts={counts} />
        </Suspense>
      </section>
    </div>
  );
}

async function Tiles({ counts }: { counts: Counts | Promise<Counts> }) {
  const t = await getTranslations("AdminHome");
  const tiles = buildTiles(await counts);
  return (
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
            <h3 id={`tile-${key}`} className="text-lg font-extrabold text-heading">
              {t(`${key}Title`)}
            </h3>
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
  );
}

function TilesSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="neu flex flex-col gap-3 p-5 sm:p-6">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-14 w-20" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="mt-2 h-11 w-full rounded-xl" />
        </div>
      ))}
    </div>
  );
}
