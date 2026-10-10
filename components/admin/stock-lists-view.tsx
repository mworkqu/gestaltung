"use client";

// /dashboard/store/stock: three plain lists (Buy now / Watch / Do not buy),
// "Add to order", one order list per supplier with Copy for WhatsApp and
// Download CSV, and "I bought these". Logic lives in lib/admin/stock-lists.ts.
// No scores, weights, SKUs or margins here; "Details" opens the full restock table.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, ClipboardCopy, Download, Loader2, PackageCheck, Plus } from "lucide-react";

import { markBought } from "@/app/[locale]/dashboard/store/stock/actions";
import { Link } from "@/i18n/navigation";
import { buildOrderGroups, groupsCsv, whatsappText, type Interest, type StockItem } from "@/lib/admin/stock-lists";
import { formatPrice } from "@/lib/parts/format";
import { IMAGE_WIDTHS, sizedImage } from "@/lib/store/image-url";
import { arabicCountForm } from "@/lib/text/count";
import { cn } from "@/lib/utils";

const DONT_PREVIEW = 30;

export function StockListsView({
  locale,
  buy,
  watch,
  dont,
}: {
  locale: string;
  buy: StockItem[];
  watch: StockItem[];
  dont: StockItem[];
}) {
  const t = useTranslations("AdminStock");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [showAllDont, setShowAllDont] = useState(false);

  const orderable = useMemo(() => [...buy, ...watch], [buy, watch]);
  const groups = useMemo(() => buildOrderGroups(orderable, picked), [orderable, picked]);
  const money = (n: number) => formatPrice(n, locale);
  const count = (key: string, n: number) => t(key, { count: String(n), form: arabicCountForm(n) });

  const toggle = (it: StockItem) =>
    setPicked((cur) => {
      const next = { ...cur };
      if (next[it.part.id] !== undefined) delete next[it.part.id];
      else next[it.part.id] = it.qty;
      return next;
    });
  const setQty = (id: string, raw: string) =>
    setPicked((cur) => ({ ...cur, [id]: Math.max(1, Math.trunc(Number(raw)) || 1) }));

  const why = (i: Interest, ownQty: number): string[] => {
    const out: string[] = [];
    if (i.requestPeople > 0) out.push(count("reasonRequests", i.requestPeople));
    if (i.cartPeople > 0) out.push(count("reasonCarts", i.cartPeople));
    if (i.olderSignals > 0) out.push(count("reasonOlder", i.olderSignals));
    if (i.views > 0) out.push(count("reasonViews", i.views));
    if (ownQty > 0) out.push(t("reasonOwn", { count: String(ownQty) }));
    if (out.length === 0) out.push(t("reasonNone"));
    return out;
  };

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000);
  };

  const downloadCsv = (name: string, csv: string) => {
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `order-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "supplier"}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const bought = (g: (typeof groups)[number]) => {
    setMessage(null);
    start(async () => {
      const res = await markBought(
        locale,
        g.lines.map((l) => ({ partId: l.row.partId, supplierId: g.supplierId, qty: l.qty }))
      );
      if ("error" in res) {
        setMessage({ kind: "error", text: t("boughtError", { error: res.error }) });
        return;
      }
      setPicked((cur) => {
        const next = { ...cur };
        for (const l of g.lines) delete next[l.row.partId];
        return next;
      });
      setMessage({ kind: "ok", text: count("boughtDone", res.count) });
      router.refresh();
    });
  };

  const photo = (it: StockItem) =>
    it.part.photo ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={sizedImage(it.part.photo, IMAGE_WIDTHS.thumb) ?? it.part.photo}
        alt=""
        width={56}
        height={56}
        loading="lazy"
        className="h-14 w-14 shrink-0 rounded-lg bg-white object-contain"
      />
    ) : (
      <span className="h-14 w-14 shrink-0 rounded-lg bg-panel shadow-neu-sm" aria-hidden="true" />
    );

  const row = (it: StockItem, withAction: boolean) => {
    const on = picked[it.part.id] !== undefined;
    return (
      <li key={it.part.id} className={cn("neu-inset rounded-xl p-3", on && "ring-2 ring-cobalt/40")}>
        <div className="flex items-start gap-3">
          {photo(it)}
          <div className="min-w-0 flex-1">
            <Link href={`/dashboard/store/${it.part.id}/edit`} className="block break-words text-sm font-semibold text-heading hover:text-cobalt">
              {it.part.name}
            </Link>
            <ul className="mt-1 space-y-0.5 text-xs text-mutedtext">
              {why(it.interest, it.part.ownQty).map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        </div>
        {withAction && (
          <div className="mt-3 grid grid-cols-2 items-end gap-x-3 gap-y-2 text-xs sm:grid-cols-[1fr_1fr_auto_auto]">
            <div className="min-w-0">
              <p className="text-mutedtext">{t("supplierLabel")}</p>
              <p className="truncate font-medium text-heading">{it.part.supplier?.name ?? t("noSupplier")}</p>
            </div>
            <div className="min-w-0">
              <p className="text-mutedtext">{t("costLabel")}</p>
              <p className="font-medium tabular-nums text-heading">{it.part.landedCost === null ? t("costUnknown") : money(it.part.landedCost)}</p>
            </div>
            <label className="min-w-0">
              <span className="block text-mutedtext">{t("qtyLabel")}</span>
              <input
                type="number"
                min={1}
                inputMode="numeric"
                value={on ? picked[it.part.id] : it.qty}
                onChange={(e) => (on ? setQty(it.part.id, e.target.value) : setPicked((c) => ({ ...c, [it.part.id]: Math.max(1, Math.trunc(Number(e.target.value)) || 1) })))}
                className="mt-0.5 w-full rounded-lg border border-borderstrong bg-white px-2 py-1.5 text-sm tabular-nums sm:w-20"
              />
            </label>
            <button
              type="button"
              onClick={() => toggle(it)}
              aria-pressed={on}
              className={cn(
                "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold",
                on ? "bg-panel text-heading shadow-neu-sm" : "bg-cobalt text-white hover:bg-cobalt-hover"
              )}
            >
              {on ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              {on ? t("inOrder") : t("addToOrder")}
            </button>
          </div>
        )}
      </li>
    );
  };

  const section = (id: string, items: StockItem[], withAction: boolean, collapsible = false) => {
    const shown = collapsible && !showAllDont ? items.slice(0, DONT_PREVIEW) : items;
    return (
    <section aria-labelledby={`stock-${id}`} className="neu space-y-3 p-4 sm:p-5">
      <div>
        <h2 id={`stock-${id}`} className="text-lg font-extrabold text-heading">
          {t(`${id}Title`, { count: String(items.length) })}
        </h2>
        <p className="mt-0.5 text-xs text-mutedtext">{t(`${id}Help`)}</p>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-mutedtext">{t(`${id}Empty`)}</p>
      ) : (
        <ul className="space-y-2">{shown.map((it) => row(it, withAction))}</ul>
      )}
      {collapsible && items.length > DONT_PREVIEW && (
        <button type="button" onClick={() => setShowAllDont((v) => !v)} className="text-xs font-semibold text-cobalt hover:underline">
          {showAllDont ? t("showFewer") : t("showAll", { count: String(items.length) })}
        </button>
      )}
    </section>
    );
  };

  return (
    <div className="space-y-6">
      {section("buy", buy, true)}

      <section aria-labelledby="stock-order" className="neu space-y-3 p-4 sm:p-5">
        <h2 id="stock-order" className="text-lg font-extrabold text-heading">
          {t("orderTitle")}
        </h2>
        {groups.length === 0 ? (
          <p className="text-sm text-mutedtext">{t("orderEmpty")}</p>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => {
              const key = g.supplierId ?? "none";
              const name = g.supplierName || t("noSupplier");
              return (
                <div key={key} className="neu-inset space-y-3 rounded-xl p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-sm font-bold text-heading">{name}</h3>
                    {g.total > 0 && <span className="text-xs tabular-nums text-mutedtext">{t("orderTotal", { total: money(g.total) })}</span>}
                  </div>
                  <ul className="space-y-1 text-sm text-body">
                    {g.lines.map((l) => (
                      <li key={l.row.partId} className="flex gap-2">
                        <span className="shrink-0 font-semibold tabular-nums text-heading">{l.qty} ×</span>
                        <span className="min-w-0 break-words">{l.row.name}</span>
                      </li>
                    ))}
                  </ul>
                  {g.belowMinimum && g.minOrderValue !== null && (
                    <p className="text-xs font-medium text-amber-700">{t("belowMinimum", { min: money(g.minOrderValue) })}</p>
                  )}
                  {g.unpriced > 0 && <p className="text-xs text-mutedtext">{count("unpriced", g.unpriced)}</p>}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => copyText(key, whatsappText([g], t("whatsappHeading", { date: new Date().toISOString().slice(0, 10) })))}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-cobalt px-3 py-2 text-xs font-semibold text-white hover:bg-cobalt-hover"
                    >
                      {copied === key ? <Check className="h-3.5 w-3.5" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
                      {copied === key ? t("copied") : t("copyWhatsapp")}
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadCsv(name, groupsCsv([g]))}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-panel px-3 py-2 text-xs font-semibold text-heading shadow-neu-sm"
                    >
                      <Download className="h-3.5 w-3.5" />
                      {t("downloadCsv")}
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => bought(g)}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-panel px-3 py-2 text-xs font-semibold text-heading shadow-neu-sm disabled:opacity-60"
                    >
                      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PackageCheck className="h-3.5 w-3.5" />}
                      {t("bought")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {message && (
          <p role="status" className={cn("text-sm font-medium", message.kind === "ok" ? "text-emerald-700" : "text-red-700")}>
            {message.text}
          </p>
        )}
      </section>

      {section("watch", watch, true)}
      {section("dont", dont, false, true)}
    </div>
  );
}
