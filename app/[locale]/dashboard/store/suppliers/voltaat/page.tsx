import { getTranslations, setRequestLocale } from "next-intl/server";
import { ExternalLink } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { VoltaatControls, VoltaatMapForm } from "@/components/admin/voltaat-sync";
import { formatPrice } from "@/lib/parts/format";
import { cn } from "@/lib/utils";

// Voltaat price sync (Task 19g): switch, run now, mapping, mapped products and
// the daily change report. super_admin only (store layout).

export const dynamic = "force-dynamic";

type Change = {
  offerId: string;
  partId?: string;
  partName: string;
  oldRetail?: number | null;
  newRetail?: number;
  oldAvailability?: string;
  newAvailability?: string;
  newOurPrice?: number | null;
  missing?: boolean;
  reason?: string;
};

export default async function VoltaatSyncPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("VoltaatSync");
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);
  const dateFmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-QA" : "en-GB", { dateStyle: "medium", timeStyle: "short" });

  const supabase = await createClient();
  const { data: sup } = await supabase.from("suppliers").select("id").eq("code", "voltaat").maybeSingle();
  const [settingRes, runsRes, offersRes] = await Promise.all([
    supabase.from("store_settings").select("value").eq("key", "voltaat_sync").maybeSingle(),
    supabase.from("supplier_sync_runs").select("*").eq("supplier_code", "voltaat").order("started_at", { ascending: false }).limit(14),
    sup
      ? supabase
          .from("supplier_offers")
          .select("id, part_id, supplier_url, retail_price, availability, last_checked_at, part:parts!supplier_offers_part_id_fkey(name, sku, unit_price, pricing_mode)")
          .eq("supplier_id", sup.id)
          .not("supplier_url", "is", null)
          .order("last_checked_at", { ascending: false })
          .limit(500)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (runsRes.error) {
    return <p className="neu p-6 text-sm text-mutedtext">{t("needsMigration")}</p>;
  }
  const enabled = (settingRes.data?.value as { enabled?: boolean } | null)?.enabled !== false;
  type OfferRow = {
    id: string;
    part_id: string;
    supplier_url: string;
    retail_price: number | null;
    availability: string;
    last_checked_at: string | null;
    part: { name: string; sku: string; unit_price: number; pricing_mode: string } | null;
  };
  const offers = (offersRes.data ?? []) as unknown as OfferRow[];
  const runs = runsRes.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
        <h1 className="mt-2 text-2xl font-extrabold text-heading">{t("title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-mutedtext">{t("intro")}</p>
      </div>

      <VoltaatControls locale={locale} enabled={enabled} />
      <VoltaatMapForm locale={locale} />

      <section className="neu space-y-3 p-5">
        <h2 className="text-base font-bold text-heading">{t("reportTitle")}</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-mutedtext">{t("noRuns")}</p>
        ) : (
          <ul className="divide-y divide-borderstrong/40">
            {runs.map((r) => {
              const changes = ((r.changes ?? []) as Change[]).filter((c) => !c.missing);
              const missing = ((r.changes ?? []) as Change[]).filter((c) => c.missing);
              return (
                <li key={r.id} className="py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-heading">{dateFmt.format(new Date(r.started_at))}</span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        r.status === "ok" ? "bg-emerald-500/10 text-emerald-700" : r.status === "blocked" || r.status === "failed" ? "bg-red-500/10 text-red-700" : "bg-slate-500/10 text-slate-600"
                      )}
                    >
                      {t(`status_${r.status}`)}
                    </span>
                    <span className="text-mutedtext">
                      {t("runLine", { checked: r.checked, changed: r.changed, missing: r.missing, requests: r.requests })}
                    </span>
                    {r.error && <span className="text-red-700">{r.error}</span>}
                  </div>
                  {changes.length > 0 && (
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full min-w-[520px] text-[13px]">
                        <thead>
                          <tr className="text-[10px] uppercase tracking-wider text-mutedtext">
                            <th className="py-1 text-start">{t("colProduct")}</th>
                            <th className="py-1 text-start">{t("colVoltaat")}</th>
                            <th className="py-1 text-start">{t("colAvailability")}</th>
                            <th className="py-1 text-end">{t("colOurPrice")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {changes.map((c) => {
                            const pct = c.oldRetail ? (((c.newRetail ?? 0) - c.oldRetail) / c.oldRetail) * 100 : null;
                            return (
                              <tr key={c.offerId} className="border-t border-borderstrong/30">
                                <td className="py-1 text-heading">{c.partName}</td>
                                <td className="py-1 tabular-nums">
                                  {c.oldRetail == null ? "—" : formatPrice(c.oldRetail, locale)} → <b>{formatPrice(c.newRetail ?? 0, locale)}</b>
                                  {pct !== null && (
                                    <span className={cn("ms-1 text-xs", pct > 0 ? "text-red-700" : "text-emerald-700")}>
                                      ({pct > 0 ? "+" : ""}
                                      {pct.toFixed(1)}%)
                                    </span>
                                  )}
                                </td>
                                <td className="py-1 text-mutedtext">
                                  {c.oldAvailability === c.newAvailability ? "" : `${t(`av_${c.oldAvailability}`)} → ${t(`av_${c.newAvailability}`)}`}
                                </td>
                                <td className="py-1 text-end tabular-nums">{c.newOurPrice == null ? "—" : formatPrice(c.newOurPrice, locale)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {missing.length > 0 && (
                    <p className="mt-1 text-xs text-amber-700">
                      {t("missingLine", { list: missing.map((m) => `${m.partName} (${t(`reason_${m.reason}`)})`).join(", ") })}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="neu space-y-3 p-5">
        <h2 className="text-base font-bold text-heading">{t("mappedTitle", { n: offers.length })}</h2>
        {offers.length === 0 ? (
          <p className="text-sm text-mutedtext">{t("noneMapped")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-mutedtext">
                  <th className="py-1 text-start">{t("colProduct")}</th>
                  <th className="py-1 text-end">{t("colVoltaat")}</th>
                  <th className="py-1 text-end">{t("colOurPrice")}</th>
                  <th className="py-1 text-start ps-4">{t("colAvailability")}</th>
                  <th className="py-1 text-start">{t("colChecked")}</th>
                </tr>
              </thead>
              <tbody>
                {offers.map((o) => (
                  <tr key={o.id} className="border-t border-borderstrong/30">
                    <td className="py-1.5">
                      <Link href={`/dashboard/store/${o.part_id}/edit`} className="text-heading hover:text-cobalt">
                        {o.part?.name}
                      </Link>{" "}
                      <a href={o.supplier_url} target="_blank" rel="noreferrer" className="inline-flex text-cobalt" aria-label={t("openVoltaat")}>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      {o.part?.pricing_mode !== "mirror" && <span className="ms-2 text-[11px] text-amber-700">{t("notMirror")}</span>}
                    </td>
                    <td className="py-1.5 text-end tabular-nums">{o.retail_price == null ? "—" : formatPrice(o.retail_price, locale)}</td>
                    <td className="py-1.5 text-end tabular-nums">{o.part ? formatPrice(o.part.unit_price, locale) : "—"}</td>
                    <td className="py-1.5 ps-4 text-mutedtext">{t(`av_${o.availability}`)}</td>
                    <td className="py-1.5 text-mutedtext">{o.last_checked_at ? dateFmt.format(new Date(o.last_checked_at)) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
