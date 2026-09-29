import { getTranslations, setRequestLocale } from "next-intl/server";
import { Camera, EyeOff, FileText, RefreshCcw, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { formatPrice, partName } from "@/lib/parts/format";
import { productSpecs } from "@/lib/store/specs";
import { hideProduct } from "./actions";
import { cn } from "@/lib/utils";

// Sourcing overview (owner, 2026-09-29): every product in plain groups —
// where it comes from and whether customers can see it — with what to act on
// first at the top. Read-only except "Keep Voltaat" on restocked items.

export const dynamic = "force-dynamic";

type P = {
  id: string;
  sku: string;
  name: string;
  name_ar: string | null;
  description: string | null;
  unit_price: number;
  lead_time_class: string | null;
  below_floor: boolean | null;
  income_pct: number | null;
  image_url: string | null;
  specs: unknown;
  datasheet_url: string | null;
  backup_for: string | null;
};

type Change = {
  partName?: string;
  sku?: string;
  field?: string;
  from?: number | string | null;
  to?: number | string | null;
  oldOurPrice?: number;
  newOurPrice?: number | null;
  newAvailability?: string;
  missing?: boolean;
};

const LIMIT = 40;

export default async function SourcingOverviewPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("SourcingOverview");
  const db = await createClient();

  const { rows, error } = await fetchAllRows<P>((from, to) =>
    db
      .from("parts")
      .select("id, sku, name, name_ar, description, unit_price, lead_time_class, below_floor, income_pct, image_url, specs, datasheet_url, backup_for")
      .eq("is_published", true)
      .is("merged_into", null)
      .order("id")
      .range(from, to)
  );
  if (error) return <p className="text-sm font-medium text-destructive">{t("needsMigration")}</p>;

  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const { data: runs } = await db
    .from("supplier_sync_runs")
    .select("supplier_code, started_at, changes")
    .gte("started_at", weekAgo)
    .order("started_at", { ascending: false })
    .limit(50);

  const byId = new Map(rows.map((p) => [p.id, p]));
  const src = (p: P) => (p.sku.startsWith("VLT-") ? "voltaat" : p.sku.startsWith("DK-") ? "digikey" : p.sku.startsWith("MS-") ? "mouser" : "other");
  const shown = rows.filter((p) => p.lead_time_class);
  const backups = rows.filter((p) => p.backup_for);
  const backedIds = new Set(backups.map((b) => b.backup_for));
  const hidden = rows.filter((p) => !p.lead_time_class && !backedIds.has(p.id));
  const restocked = backups.filter((b) => byId.get(b.backup_for!)?.lead_time_class);
  const pricier = backups.filter((b) => {
    const v = byId.get(b.backup_for!);
    return !!v && Number(b.unit_price) > Number(v.unit_price) * 1.3;
  });
  const belowFloor = shown.filter((p) => p.below_floor);
  const noPhoto = shown.filter((p) => !p.image_url);
  const noSpecs = shown.filter((p) => !p.datasheet_url && productSpecs(p).specs.length === 0);
  const changes = (runs ?? []).flatMap((r) =>
    ((r.changes as Change[] | null) ?? []).filter((c) => !c.missing).map((c) => ({ ...c, supplier: r.supplier_code as string }))
  );

  const count = (s: string) => shown.filter((p) => src(p) === s).length;
  const name = (p: P) => partName(p, locale);
  const money = (n: number) => formatPrice(n, locale);

  const highlights: { key: string; icon: LucideIcon; n: number; anchor: string; red?: boolean }[] = [
    { key: "restocked", icon: RefreshCcw, n: restocked.length, anchor: "restocked" },
    { key: "belowFloor", icon: TrendingDown, n: belowFloor.length, anchor: "below-floor", red: true },
    { key: "pricier", icon: TrendingUp, n: pricier.length, anchor: "pricier" },
    { key: "noPhoto", icon: Camera, n: noPhoto.length, anchor: "no-photo" },
  ];

  const list = (items: P[], extra?: (p: P) => React.ReactNode) => (
    <ul className="divide-y divide-borderstrong/40">
      {items.slice(0, LIMIT).map((p) => (
        <li key={p.id} className="flex flex-wrap items-center gap-3 py-2">
          {p.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.image_url} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded bg-white object-contain" />
          ) : (
            <span className="h-10 w-10 shrink-0 rounded bg-panel" />
          )}
          <span className="min-w-0 flex-1">
            <Link href={`/dashboard/store/${p.id}/edit`} className="block truncate text-sm font-medium text-heading hover:text-cobalt">
              {name(p)}
            </Link>
            <span className="font-mono text-[10px] text-faint">
              {p.sku} · {money(Number(p.unit_price))}
            </span>
          </span>
          {extra?.(p)}
        </li>
      ))}
      {items.length > LIMIT && <li className="py-2 text-xs text-mutedtext">{t("andMore", { count: items.length - LIMIT })}</li>}
      {items.length === 0 && <li className="py-2 text-sm text-mutedtext">{t("none")}</li>}
    </ul>
  );

  const section = (id: string, key: string, n: number, body: React.ReactNode, open = false) => (
    <details id={id} open={open} className="neu scroll-mt-24 p-5">
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-2">
        <span className="text-2xl font-extrabold tabular-nums text-heading">{n}</span>
        <span className="text-sm font-bold text-heading">{t(`${key}Title`)}</span>
        <span className="basis-full text-xs text-mutedtext">{t(`${key}Help`)}</span>
      </summary>
      <div className="mt-3">{body}</div>
    </details>
  );

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-azure">{t("kicker")}</p>
        <h1 className="mt-2 text-2xl font-extrabold text-heading">{t("title")}</h1>
        <p className="mt-1 max-w-[70ch] text-sm text-mutedtext">{t("intro")}</p>
      </div>

      {/* Look at these first */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-heading">{t("lookFirst")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {highlights.map((h) => {
            const tone = h.n === 0 ? "text-faint" : h.red ? "text-destructive" : "text-amber-700";
            return (
              <a key={h.key} href={`#${h.anchor}`} className={cn("neu flex items-start gap-3 p-4 transition-shadow hover:ring-2 hover:ring-cobalt/30", h.n === 0 && "opacity-60")}>
                <h.icon className={cn("mt-0.5 h-5 w-5 shrink-0", tone)} />
                <span>
                  <span className={cn("block text-2xl font-extrabold tabular-nums", tone)}>{h.n}</span>
                  <span className="block text-sm font-semibold text-heading">{t(`hl_${h.key}`)}</span>
                  <span className="block text-[11px] text-mutedtext">{t(`hlHelp_${h.key}`)}</span>
                </span>
              </a>
            );
          })}
        </div>
      </section>

      {/* Where the products customers can see come from */}
      <section className="neu grid gap-4 p-5 sm:grid-cols-4">
        {(
          [
            ["voltaat", count("voltaat")],
            ["digikey", count("digikey")],
            ["mouser", count("mouser")],
            ["hidden", hidden.length],
          ] as const
        ).map(([k, n]) => (
          <div key={k}>
            <p className="text-2xl font-extrabold tabular-nums text-heading">{n}</p>
            <p className="text-xs text-mutedtext">{t(`src_${k}`)}</p>
          </div>
        ))}
      </section>

      {section(
        "restocked",
        "restocked",
        restocked.length,
        list(restocked, (b) => (
          <span className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-mutedtext">{t("voltaatPrice", { price: money(Number(byId.get(b.backup_for!)!.unit_price)) })}</span>
            <form action={hideProduct}>
              <input type="hidden" name="id" value={b.id} />
              <input type="hidden" name="locale" value={locale} />
              <button type="submit" className="rounded-full bg-panel px-3 py-1 font-semibold text-heading shadow-neu-sm hover:text-cobalt">
                {t("keepVoltaat")}
              </button>
            </form>
          </span>
        )),
        restocked.length > 0
      )}

      {section(
        "below-floor",
        "belowFloor",
        belowFloor.length,
        list(belowFloor, (p) => <span className="text-xs font-semibold text-destructive">{p.income_pct ?? "—"}%</span>),
        belowFloor.length > 0
      )}

      {section(
        "pricier",
        "pricier",
        pricier.length,
        list(pricier, (b) => <span className="text-xs text-amber-700">{t("voltaatPrice", { price: money(Number(byId.get(b.backup_for!)!.unit_price)) })}</span>)
      )}

      {section(
        "backups",
        "backups",
        backups.length,
        list(backups, (b) => <span className="max-w-[40%] truncate text-xs text-mutedtext">{t("replaces", { name: name(byId.get(b.backup_for!) ?? b) })}</span>)
      )}

      {section("hidden", "hidden", hidden.length, list(hidden, () => <EyeOff className="h-4 w-4 text-faint" />))}

      {section("no-photo", "noPhoto", noPhoto.length, list(noPhoto))}

      {section("no-specs", "noSpecs", noSpecs.length, list(noSpecs, () => <FileText className="h-4 w-4 text-faint" />))}

      {section(
        "changes",
        "changes",
        changes.length,
        <ul className="divide-y divide-borderstrong/40 text-sm">
          {changes.slice(0, LIMIT).map((c, i) => {
            const from = c.oldOurPrice ?? (typeof c.from === "number" ? c.from : null);
            const to = c.newOurPrice ?? (typeof c.to === "number" ? c.to : null);
            return (
              <li key={i} className="flex flex-wrap items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate text-heading">{c.partName ?? c.sku ?? "—"}</span>
                <span className="text-xs text-mutedtext">{c.supplier}</span>
                {from !== null && to !== null ? (
                  <span className={cn("font-mono text-xs", to > from ? "text-amber-700" : "text-emerald-700")} dir="ltr">
                    {from} → {to}
                  </span>
                ) : (
                  <span className="text-xs text-mutedtext">{c.newAvailability ?? c.field ?? ""}</span>
                )}
              </li>
            );
          })}
          {changes.length === 0 && <li className="py-2 text-mutedtext">{t("none")}</li>}
        </ul>
      )}
    </div>
  );
}
