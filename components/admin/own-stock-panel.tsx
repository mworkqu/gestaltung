"use client";

// "Units on the shelf" on /dashboard/store/stock: the one place the owner sets
// own_stock.qty by hand — a stock take, a loss, a correction. The products we
// already hold are listed without searching; the search box finds any other
// product the page loaded, so a product that is NOT on the Buy list can be put
// on the shelf too. Logic lives in lib/admin/own-stock.ts.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, Loader2, Save, Search } from "lucide-react";

import { setShelfUnits } from "@/app/[locale]/dashboard/store/stock/actions";
import { Link } from "@/i18n/navigation";
import { useEditHref } from "@/components/admin/use-edit-href";
import { allShelfRows, onShelfRows, parseShelfQty, searchShelfRows, type ShelfRow } from "@/lib/admin/own-stock";
import type { StockLists } from "@/lib/admin/stock-lists";
import { cn } from "@/lib/utils";

type Note = { kind: "ok" | "warn" | "error"; text: string };

export function OwnStockPanel({ locale, lists }: { locale: string; lists: StockLists }) {
  const t = useTranslations("AdminStock");
  const tNav = useTranslations("DashboardNav");
  const router = useRouter();
  const edit = useEditHref();
  const [pending, start] = useTransition();
  const [term, setTerm] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, Note>>({});

  const all = useMemo(() => allShelfRows(lists), [lists]);
  const onShelf = useMemo(() => onShelfRows(lists), [lists]);
  const searching = term.trim().length > 0;
  const hits = useMemo(() => (searching ? searchShelfRows(all, term) : []), [all, term, searching]);
  const rows = searching ? hits : onShelf;

  const valueOf = (row: ShelfRow) => draft[row.id] ?? String(row.qty);

  const save = (row: ShelfRow) => {
    const raw = valueOf(row);
    setNotes((cur) => {
      const next = { ...cur };
      delete next[row.id];
      return next;
    });
    setSaving(row.id);
    start(async () => {
      const res = await setShelfUnits(locale, row.id, raw);
      setSaving(null);
      if ("error" in res) {
        setNotes((cur) => ({ ...cur, [row.id]: { kind: "error", text: t("shelfError", { error: res.error }) } }));
        return;
      }
      const note: Note =
        res.offer === "failed"
          ? { kind: "warn", text: t("shelfOfferFailed", { error: res.reason ?? "" }) }
          : res.offer === "added"
            ? { kind: "ok", text: t("shelfSavedOn", { count: String(res.qty) }) }
            : res.offer === "parked"
              ? { kind: "ok", text: t("shelfSavedParked") }
              : { kind: "ok", text: t("shelfSavedZero") };
      setNotes((cur) => ({ ...cur, [row.id]: note }));
      setDraft((cur) => {
        const next = { ...cur };
        delete next[row.id];
        return next;
      });
      router.refresh();
    });
  };

  const row = (r: ShelfRow) => {
    const raw = valueOf(r);
    const bad = parseShelfQty(raw) === null;
    const busy = pending && saving === r.id;
    const note = notes[r.id];
    return (
      <li key={r.id} id={`shelf-${r.id}`} className="neu-inset rounded-xl p-3">
        <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1">
            <Link
              href={edit(r.id, `shelf-${r.id}`)}
              className="block break-words text-sm font-semibold text-heading hover:text-cobalt"
            >
              {r.name}
            </Link>
            <p className="mt-0.5 text-xs text-mutedtext">{t("shelfOn", { count: String(r.qty) })}</p>
          </div>
          <label className="min-w-0">
            <span className="block text-xs text-mutedtext">{t("shelfQtyLabel")}</span>
            <input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={raw}
              onChange={(e) => setDraft((cur) => ({ ...cur, [r.id]: e.target.value }))}
              aria-invalid={bad || undefined}
              className={cn(
                "mt-0.5 w-full rounded-lg border bg-white px-2 py-1.5 text-sm tabular-nums sm:w-24",
                bad ? "border-red-500" : "border-borderstrong"
              )}
            />
          </label>
          <button
            type="button"
            disabled={bad || busy}
            onClick={() => save(r)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-cobalt px-3 py-2 text-xs font-semibold text-white hover:bg-cobalt-hover disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : note?.kind === "ok" ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
            {t("shelfSave")}
          </button>
        </div>
        {note && (
          <p
            role="status"
            className={cn(
              "mt-2 text-xs font-medium",
              note.kind === "ok" ? "text-emerald-700" : note.kind === "warn" ? "text-amber-700" : "text-red-700"
            )}
          >
            {note.text}
          </p>
        )}
      </li>
    );
  };

  return (
    <section aria-labelledby="stock-shelf" id="shelf" className="neu space-y-3 p-4 sm:p-5">
      <div>
        <h2 id="stock-shelf" className="text-lg font-extrabold text-heading">
          {t("shelfTitle", { count: String(onShelf.length) })}
        </h2>
        <p className="mt-0.5 text-xs text-mutedtext">{t("shelfHelp")}</p>
      </div>

      <label className="relative block max-w-sm">
        <span className="sr-only">{tNav("listSearchProducts")}</span>
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden />
        <input
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={tNav("listSearchProducts")}
          className="h-11 w-full rounded-xl border border-borderstrong/60 bg-surface ps-9 pe-3 text-sm text-heading shadow-neu-inset placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-cobalt/50"
        />
      </label>

      {rows.length === 0 ? (
        <p className="text-sm text-mutedtext">{searching ? t("shelfNoMatch", { q: term.trim() }) : t("shelfEmpty")}</p>
      ) : (
        <ul className="space-y-2">{rows.map(row)}</ul>
      )}
    </section>
  );
}
