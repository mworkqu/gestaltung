"use client";

// Sourcing for one product: its pricing mode, the derived figures (preferred
// offer, landed cost, income, lead-time class, margin-floor flag) and every
// supplier offer, with add / edit / pin / delete. The figures are derived in
// the database, so after each change the page re-renders from the server.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle, ExternalLink, Loader2, Pencil, Pin, PinOff, Plus, Trash2 } from "lucide-react";

import {
  deleteOffer,
  pinOffer,
  saveOffer,
  setPricingMode,
  type OfferInput,
} from "@/app/[locale]/dashboard/store/sourcing/actions";
import {
  AVAILABILITIES,
  type PartSourcing,
  type PricingMode,
  type Supplier,
  type SupplierOffer,
} from "@/lib/store/sourcing";
import { formatPrice } from "@/lib/parts/format";
import { cn } from "@/lib/utils";

const input =
  "w-full rounded-lg border border-white/60 bg-surface px-2 py-1 text-[12px] text-heading shadow-neu-inset outline-none focus:ring-2 focus:ring-cobalt/60";

type Props = {
  locale: string;
  partId: string;
  unitPrice: number;
  sourcing: PartSourcing;
  offers: (SupplierOffer & { landed_qar: number | null })[];
  suppliers: Supplier[];
  floorPct: number;
};

export function SourcingPanel({ locale, partId, unitPrice, sourcing, offers, suppliers, floorPct }: Props) {
  const t = useTranslations("Sourcing");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));
  const preferred = offers.find((o) => o.id === sourcing.preferred_offer_id) ?? null;
  const preferredSupplier = preferred ? supplierById.get(preferred.supplier_id) : null;

  const run = (fn: () => Promise<{ error?: string; ok?: boolean }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.error) setError(r.error === "duplicate" ? t("errorDuplicate") : r.error);
      else {
        setEditing(null);
        router.refresh();
      }
    });

  const money = (v: number | null) => (v === null ? "—" : formatPrice(v, locale));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-heading">{t("title")}</h2>
        <label className="flex items-center gap-2 text-sm text-body">
          {t("pricingMode")}
          <select
            value={sourcing.pricing_mode}
            disabled={pending}
            onChange={(e) => run(() => setPricingMode(locale, partId, e.target.value as PricingMode))}
            className={cn(input, "w-auto")}
          >
            <option value="markup">{t("mode_markup")}</option>
            <option value="mirror">{t("mode_mirror")}</option>
          </select>
        </label>
      </div>
      <p className="text-xs text-mutedtext">{t(sourcing.pricing_mode === "mirror" ? "modeHelp_mirror" : "modeHelp_markup")}</p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label={t("preferred")} value={preferredSupplier?.name ?? t("none")} sub={sourcing.pinned_offer_id ? t("pinned") : preferred ? t("byRule") : undefined} />
        <Stat label={t("ourPrice")} value={money(unitPrice)} sub={sourcing.pricing_mode === "mirror" ? t("mirrored") : undefined} />
        <Stat label={t("landedCost")} value={money(sourcing.landed_cost_qar)} />
        <Stat label={t("expectedIncome")} value={money(sourcing.expected_income_qar)} sub={sourcing.pricing_mode === "mirror" ? t("commission") : t("priceMinusCost")} />
        <Stat
          label={t("incomePct")}
          value={sourcing.income_pct === null ? "—" : `${sourcing.income_pct}%`}
          warn={sourcing.below_floor}
          sub={t("floor", { pct: floorPct })}
        />
        <Stat label={t("leadTime")} value={sourcing.lead_time_class ? t(`lt_${sourcing.lead_time_class}`) : t("onRequest")} />
      </div>

      {sourcing.below_floor && (
        <p className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {t("belowFloor", { pct: floorPct })}
        </p>
      )}
      {error && <p className="text-sm font-medium text-destructive">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-borderstrong/60 text-start text-[10px] uppercase tracking-wider text-mutedtext">
              {["supplier", "sku", "cost", "retail", "pack", "moq", "availability", "leadDays", "landed", "checked", ""].map((k) => (
                <th key={k} className="px-2 py-2 text-start font-semibold">
                  {k ? t(`col_${k}`) : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {offers.map((o) =>
              editing === o.id ? (
                <OfferForm
                  key={o.id}
                  offer={o}
                  suppliers={suppliers}
                  pending={pending}
                  onCancel={() => setEditing(null)}
                  onSave={(v) => run(() => saveOffer(locale, partId, o.id, v))}
                />
              ) : (
                <tr
                  key={o.id}
                  className={cn(
                    "border-b border-borderstrong/40",
                    o.id === sourcing.preferred_offer_id && "bg-cobalt/5",
                    !o.active && "opacity-50"
                  )}
                >
                  <td className="px-2 py-2 font-medium text-heading">
                    {supplierById.get(o.supplier_id)?.name ?? "?"}
                    {o.id === sourcing.preferred_offer_id && (
                      <span className="ms-2 rounded-full bg-cobalt/15 px-2 py-0.5 text-[10px] text-cobalt">
                        {o.id === sourcing.pinned_offer_id ? t("pinned") : t("preferred")}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 font-mono" dir="ltr">
                    {o.supplier_url ? (
                      <a href={o.supplier_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-cobalt hover:underline">
                        {o.supplier_sku ?? t("link")} <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      o.supplier_sku ?? "—"
                    )}
                  </td>
                  <td className="px-2 py-2 tabular-nums" dir="ltr">{o.cost === null ? "—" : `${o.cost} ${o.currency}`}</td>
                  <td className="px-2 py-2 tabular-nums" dir="ltr">{o.retail_price === null ? "—" : `${o.retail_price} ${o.currency}`}</td>
                  <td className="px-2 py-2 tabular-nums">{o.pack_size}</td>
                  <td className="px-2 py-2 tabular-nums">{o.moq}</td>
                  <td className="px-2 py-2">{t(`av_${o.availability}`)}</td>
                  <td className="px-2 py-2 tabular-nums">{o.lead_time_days ?? "—"}</td>
                  <td className="px-2 py-2 tabular-nums">{money(o.landed_qar)}</td>
                  <td className="px-2 py-2 text-mutedtext">{o.last_checked_at ? new Date(o.last_checked_at).toLocaleDateString(locale) : "—"}</td>
                  <td className="px-2 py-2">
                    <div className="flex justify-end gap-1">
                      <IconBtn label={t("edit")} onClick={() => setEditing(o.id)} disabled={pending}>
                        <Pencil className="h-3.5 w-3.5" />
                      </IconBtn>
                      {o.id === sourcing.pinned_offer_id ? (
                        <IconBtn label={t("unpin")} onClick={() => run(() => pinOffer(locale, partId, null))} disabled={pending}>
                          <PinOff className="h-3.5 w-3.5" />
                        </IconBtn>
                      ) : (
                        <IconBtn label={t("pin")} onClick={() => run(() => pinOffer(locale, partId, o.id))} disabled={pending || !o.active}>
                          <Pin className="h-3.5 w-3.5" />
                        </IconBtn>
                      )}
                      <IconBtn
                        label={t("delete")}
                        onClick={() => confirm(t("confirmDelete")) && run(() => deleteOffer(locale, partId, o.id))}
                        disabled={pending}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconBtn>
                    </div>
                  </td>
                </tr>
              )
            )}
            {editing === "new" && (
              <OfferForm
                suppliers={suppliers}
                pending={pending}
                onCancel={() => setEditing(null)}
                onSave={(v) => run(() => saveOffer(locale, partId, null, v))}
              />
            )}
          </tbody>
        </table>
        {offers.length === 0 && editing !== "new" && <p className="px-2 py-4 text-sm text-mutedtext">{t("noOffers")}</p>}
      </div>

      {editing === null && (
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="inline-flex items-center gap-1.5 rounded-full border border-borderstrong px-4 py-1.5 text-sm font-medium text-heading hover:border-cobalt hover:text-cobalt"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {t("addOffer")}
        </button>
      )}
    </div>
  );
}

function Stat({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className={cn("rounded-xl bg-panel p-3 shadow-neu-sm", warn && "ring-2 ring-red-400")}>
      <p className="text-[10px] uppercase tracking-wider text-mutedtext">{label}</p>
      <p className={cn("mt-1 text-sm font-bold tabular-nums text-heading", warn && "text-red-700")}>{value}</p>
      {sub && <p className="text-[10px] text-mutedtext">{sub}</p>}
    </div>
  );
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-7 w-7 items-center justify-center rounded-md text-mutedtext hover:bg-panel hover:text-cobalt disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function OfferForm({
  offer,
  suppliers,
  pending,
  onSave,
  onCancel,
}: {
  offer?: SupplierOffer;
  suppliers: Supplier[];
  pending: boolean;
  onSave: (v: OfferInput) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("Sourcing");
  const first = suppliers.find((s) => s.active) ?? suppliers[0];
  const [v, setV] = useState<OfferInput>({
    supplier_id: offer?.supplier_id ?? first?.id ?? "",
    supplier_sku: offer?.supplier_sku ?? "",
    supplier_url: offer?.supplier_url ?? "",
    cost: offer?.cost ?? "",
    retail_price: offer?.retail_price ?? "",
    currency: offer?.currency ?? first?.default_currency ?? "USD",
    pack_size: offer?.pack_size ?? 1,
    moq: offer?.moq ?? 1,
    availability: offer?.availability ?? "unknown",
    lead_time_days: offer?.lead_time_days ?? "",
    active: offer?.active ?? true,
  });
  const set = (k: keyof OfferInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setV((cur) => ({ ...cur, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));
  const onSupplier = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const s = suppliers.find((x) => x.id === e.target.value);
    setV((cur) => ({ ...cur, supplier_id: e.target.value, currency: offer ? cur.currency : s?.default_currency ?? cur.currency }));
  };

  return (
    <tr className="border-b border-borderstrong/40 bg-panel/60 align-top">
      <td className="px-1 py-2">
        <select value={v.supplier_id} onChange={onSupplier} className={input}>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <label className="mt-1 flex items-center gap-1 text-[11px] text-mutedtext">
          <input type="checkbox" checked={v.active !== false} onChange={set("active")} /> {t("active")}
        </label>
      </td>
      <td className="px-1 py-2">
        <input value={String(v.supplier_sku ?? "")} onChange={set("supplier_sku")} placeholder={t("col_sku")} className={input} dir="ltr" />
        <input value={String(v.supplier_url ?? "")} onChange={set("supplier_url")} placeholder="https://" className={cn(input, "mt-1")} dir="ltr" />
      </td>
      <td className="px-1 py-2">
        <input value={String(v.cost ?? "")} onChange={set("cost")} inputMode="decimal" className={input} dir="ltr" />
        <input value={String(v.currency ?? "")} onChange={set("currency")} maxLength={3} className={cn(input, "mt-1 uppercase")} dir="ltr" />
      </td>
      <td className="px-1 py-2">
        <input value={String(v.retail_price ?? "")} onChange={set("retail_price")} inputMode="decimal" className={input} dir="ltr" />
      </td>
      <td className="px-1 py-2">
        <input value={String(v.pack_size ?? "")} onChange={set("pack_size")} inputMode="numeric" className={input} dir="ltr" />
      </td>
      <td className="px-1 py-2">
        <input value={String(v.moq ?? "")} onChange={set("moq")} inputMode="numeric" className={input} dir="ltr" />
      </td>
      <td className="px-1 py-2">
        <select value={v.availability} onChange={set("availability")} className={input}>
          {AVAILABILITIES.map((a) => (
            <option key={a} value={a}>
              {t(`av_${a}`)}
            </option>
          ))}
        </select>
      </td>
      <td className="px-1 py-2">
        <input value={String(v.lead_time_days ?? "")} onChange={set("lead_time_days")} inputMode="numeric" className={input} dir="ltr" />
      </td>
      <td colSpan={3} className="px-1 py-2">
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-full px-3 py-1 text-[12px] text-mutedtext hover:text-heading">
            {t("cancel")}
          </button>
          <button
            type="button"
            disabled={pending || !v.supplier_id}
            onClick={() => onSave(v)}
            className="inline-flex items-center gap-1 rounded-full bg-cobalt px-3 py-1 text-[12px] font-semibold text-white disabled:opacity-50"
          >
            {pending && <Loader2 className="h-3 w-3 animate-spin" />}
            {t("save")}
          </button>
        </div>
      </td>
    </tr>
  );
}
