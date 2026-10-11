"use client";

// The Fix list (D1): products grouped by what is missing (Delivery date ·
// Photo · Price · Supplier), Delivery date split by supplier, a plain "why" on
// every row, checkboxes + "Select all" per group, a bottom bar with bulk
// actions (confirm step + "N fixed, M failed — see why"), and a side drawer
// that fixes one product in place. Grouping rules: lib/admin/fix-groups.ts.

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, X } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Sheet } from "@/components/ui/sheet";
import {
  bulkMarkOnRequest,
  bulkSetDelivery,
  bulkUnpublish,
  fixOne,
  type BulkResponse,
} from "@/app/[locale]/dashboard/store/fix/actions";
import {
  chunk,
  groupFixRows,
  ISSUE_ORDER,
  nextRowId,
  summariseBulk,
  type BulkItemResult,
  type BulkSummary,
  type FixRow,
} from "@/lib/admin/fix-groups";
import type { FixIssue } from "@/lib/admin/home-tiles";
import { editHref } from "@/lib/admin/return-to";
import { cn } from "@/lib/utils";

export type FixListRow = FixRow & { imageUrl: string | null; price: number | null };
export type FixSupplier = { id: string; name: string };

type BulkKind = "delivery" | "onRequest" | "unpublish";
const BATCH = 20;
const OWN = "own";

const field =
  "w-full rounded-xl border border-white/60 bg-panel px-3 py-2 text-sm text-heading shadow-neu-inset outline-none focus:ring-2 focus:ring-cobalt/60";
const missingBox = "rounded-xl p-3 ring-2 ring-red-400";

// HINT: swap for components/ui/hint.tsx (D3) once it lands.
function Hint({ text }: { text: string }) {
  return (
    <span
      role="img"
      tabIndex={0}
      aria-label={text}
      title={text}
      className="inline-flex h-5 w-5 shrink-0 cursor-help items-center justify-center rounded-full border border-borderstrong text-[11px] font-bold text-mutedtext focus:outline-none focus-visible:ring-2 focus-visible:ring-cobalt/60"
    >
      ?
    </span>
  );
}

export function FixList({
  locale,
  initialRows,
  suppliers,
}: {
  locale: string;
  initialRows: FixListRow[];
  suppliers: FixSupplier[];
}) {
  const t = useTranslations("FixList");
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [bulk, setBulk] = useState<BulkKind | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [supplier, setSupplier] = useState<string>(OWN);
  const [leadDays, setLeadDays] = useState("2");
  const [summary, setSummary] = useState<BulkSummary | null>(null);
  const [showWhy, setShowWhy] = useState(false);
  const [pending, start] = useTransition();
  const focusAfter = useRef<string | null>(null);

  // The server is the truth after router.refresh().
  useEffect(() => {
    setRows(initialRows);
    setSelected((cur) => new Set([...cur].filter((id) => initialRows.some((r) => r.id === id))));
  }, [initialRows]);

  const groups = useMemo(() => groupFixRows(rows), [rows]);
  const order = useMemo(() => {
    const seen: string[] = [];
    for (const g of groups) {
      const list = g.subGroups ? g.subGroups.flatMap((s) => s.rows) : g.rows;
      for (const r of list) if (!seen.includes(r.id)) seen.push(r.id);
    }
    return seen;
  }, [groups]);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const open = openId ? byId.get(openId) ?? null : null;

  // Focus the next row once the drawer has closed and the list re-rendered.
  useEffect(() => {
    const id = focusAfter.current;
    if (!id || openId) return;
    focusAfter.current = null;
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-fix-row="${id}"]`)?.focus();
    });
  }, [openId, rows]);

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = (ids: string[]) =>
    setSelected((cur) => {
      const next = new Set(cur);
      const all = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (all) next.delete(id);
        else next.add(id);
      }
      return next;
    });

  const why = (r: FixRow) => {
    if (!r.why) return null;
    return t(`why_${r.why.code}`, { supplier: r.why.supplier ?? t("aSupplier") });
  };

  const applyFixed = useCallback((ids: string[], kind: BulkKind) => {
    const done = new Set(ids);
    setRows((cur) =>
      cur
        .map((r) => {
          if (!done.has(r.id)) return r;
          if (kind === "unpublish") return null;
          const issues = r.issues.filter((i) => i !== "delivery" && i !== "supplier");
          return issues.length ? { ...r, issues, why: null } : null;
        })
        .filter((r): r is FixListRow => r !== null)
    );
    setSelected((cur) => new Set([...cur].filter((id) => !done.has(id))));
  }, []);

  const runBulk = () => {
    const kind = bulk;
    if (!kind) return;
    const ids = [...selected];
    start(async () => {
      const all: BulkItemResult[] = [];
      for (const part of chunk(ids, BATCH)) {
        let res: BulkResponse;
        try {
          res =
            kind === "delivery"
              ? await bulkSetDelivery(locale, part, { supplier, leadDays })
              : kind === "onRequest"
                ? await bulkMarkOnRequest(locale, part)
                : await bulkUnpublish(locale, part);
        } catch {
          res = { error: "load" };
        }
        if ("error" in res) {
          for (const id of part) all.push({ id, name: byId.get(id)?.name ?? id, ok: false, reason: res.error });
        } else {
          all.push(...res.results);
        }
      }
      const s = summariseBulk(all);
      applyFixed(
        all.filter((r) => r.ok).map((r) => r.id),
        kind
      );
      setSummary(s);
      setShowWhy(false);
      setBulk(null);
      setConfirming(false);
      router.refresh();
    });
  };

  const supplierName = supplier === OWN ? t("ownStock") : suppliers.find((s) => s.id === supplier)?.name ?? "";
  const leadOk = /^\d{1,3}$/.test(leadDays.trim()) && Number(leadDays) <= 365;

  const onSaved = (id: string, remaining: FixIssue[]) => {
    if (remaining.length === 0) {
      focusAfter.current = nextRowId(order, id);
      setRows((cur) => cur.filter((r) => r.id !== id));
      setSelected((cur) => {
        const next = new Set(cur);
        next.delete(id);
        return next;
      });
      setOpenId(null);
    } else {
      setRows((cur) => cur.map((r) => (r.id === id ? { ...r, issues: remaining } : r)));
    }
    router.refresh();
  };

  if (rows.length === 0) {
    return <p className="neu p-6 text-sm text-mutedtext">{t("empty")}</p>;
  }

  const renderRow = (r: FixListRow, issue: FixIssue) => {
    const line = why(r);
    return (
      <li
        key={`${issue}-${r.id}`}
        id={`fix-${issue}-${r.id}`}
        className={cn("tile flex items-start gap-3 p-3", selected.has(r.id) && "ring-2 ring-cobalt/50")}
      >
        <input
          type="checkbox"
          checked={selected.has(r.id)}
          onChange={() => toggle(r.id)}
          aria-label={t("selectOne", { name: r.name })}
          className="mt-1 h-5 w-5 shrink-0 accent-cobalt"
        />
        <button
          type="button"
          data-fix-row={r.id}
          onClick={() => setOpenId(r.id)}
          className="min-w-0 flex-1 rounded-lg text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-cobalt/60"
        >
          <span className="block break-words text-sm font-semibold text-heading">{r.name}</span>
          <span className="mt-0.5 block text-xs text-mutedtext">
            {issue === "delivery" && line
              ? line
              : `${t("missing")} ${r.issues.map((i) => t(`issue_${i}`)).join(" · ")}`}
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="space-y-5 pb-40">
      <p className="text-sm font-semibold text-heading">{t("total", { count: String(rows.length) })}</p>

      {groups.map((g) => {
        const ids = g.rows.map((r) => r.id);
        const allOn = ids.every((id) => selected.has(id));
        return (
          <section key={g.issue} aria-labelledby={`fix-group-${g.issue}`} className="neu space-y-3 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h2 id={`fix-group-${g.issue}`} className="text-lg font-extrabold text-heading">
                  {t(`issue_${g.issue}`)}
                </h2>
                <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-bold tabular-nums text-red-700">
                  {g.count}
                </span>
                {/* HINT: group explanation */}
                <Hint text={t(`hint_${g.issue}`)} />
              </div>
              <label className="flex min-h-11 items-center gap-2 text-xs font-semibold text-body">
                <input type="checkbox" checked={allOn} onChange={() => toggleAll(ids)} className="h-5 w-5 accent-cobalt" />
                {t("selectAllGroup")}
              </label>
            </div>

            {g.subGroups ? (
              g.subGroups.map((s) => {
                const subIds = s.rows.map((r) => r.id);
                const subOn = subIds.every((id) => selected.has(id));
                return (
                  <div key={s.bucket} className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-borderstrong/40 pt-3">
                      <h3 className="text-sm font-bold text-heading">
                        {t(`bucket_${s.bucket}`)} <span className="tabular-nums text-mutedtext">· {s.rows.length}</span>
                      </h3>
                      <label className="flex min-h-11 items-center gap-2 text-xs text-body">
                        <input
                          type="checkbox"
                          checked={subOn}
                          onChange={() => toggleAll(subIds)}
                          aria-label={t("selectAllIn", { group: t(`bucket_${s.bucket}`) })}
                          className="h-5 w-5 accent-cobalt"
                        />
                        {t("selectAll")}
                      </label>
                    </div>
                    <ul className="space-y-2">{s.rows.map((r) => renderRow(byId.get(r.id)!, g.issue))}</ul>
                  </div>
                );
              })
            ) : (
              <ul className="space-y-2">{g.rows.map((r) => renderRow(byId.get(r.id)!, g.issue))}</ul>
            )}
          </section>
        );
      })}

      {summary && (
        <div role="status" aria-live="polite" className="neu fixed inset-x-4 bottom-28 z-40 mx-auto max-w-xl p-4 sm:bottom-24">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-semibold text-heading">
              {summary.failed.length
                ? t("resultMixed", { fixed: String(summary.fixed), failed: String(summary.failed.length) })
                : t("resultOk", { fixed: String(summary.fixed) })}
              {summary.failed.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowWhy((v) => !v)}
                  className="ms-2 text-cobalt underline underline-offset-2"
                >
                  {t("seeWhy")}
                </button>
              )}
            </p>
            <button
              type="button"
              onClick={() => setSummary(null)}
              aria-label={t("close")}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-mutedtext hover:text-heading"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {showWhy && (
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-body">
              {summary.failed.map((f) => (
                <li key={f.id}>
                  <span className="font-semibold">{f.name}</span> — {t(`reason_${reasonKey(f.reason)}`)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {selected.size > 0 && (
        <div className="neu fixed inset-x-2 bottom-2 z-40 mx-auto max-w-3xl p-3 sm:inset-x-4 sm:bottom-4">
          {!bulk ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="me-auto text-sm font-semibold text-heading">
                {t("selected", { count: String(selected.size) })}
              </span>
              <BarButton onClick={() => setBulk("delivery")} primary>
                {t("actionDelivery")}
              </BarButton>
              <BarButton onClick={() => setBulk("onRequest")}>{t("actionOnRequest")}</BarButton>
              <BarButton onClick={() => setBulk("unpublish")}>{t("actionUnpublish")}</BarButton>
              <BarButton onClick={() => setSelected(new Set())}>{t("clear")}</BarButton>
            </div>
          ) : (
            <div className="space-y-3">
              {bulk === "delivery" && !confirming && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
                  <label className="space-y-1 text-xs font-semibold text-body">
                    <span className="flex items-center gap-1.5">
                      {t("supplierLabel")}
                      {/* HINT: where the date comes from */}
                      <Hint text={t("hint_supplierPick")} />
                    </span>
                    <select value={supplier} onChange={(e) => setSupplier(e.target.value)} className={field}>
                      <option value={OWN}>{t("ownStock")}</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-xs font-semibold text-body">
                    <span>{t("leadDaysLabel")}</span>
                    <input
                      value={leadDays}
                      onChange={(e) => setLeadDays(e.target.value)}
                      inputMode="numeric"
                      dir="ltr"
                      className={cn(field, !leadOk && "ring-2 ring-red-400")}
                    />
                  </label>
                </div>
              )}
              {(confirming || bulk !== "delivery") && (
                <p className="text-sm text-heading">
                  {bulk === "delivery"
                    ? t("confirmDelivery", { count: String(selected.size), supplier: supplierName, days: leadDays.trim() })
                    : bulk === "onRequest"
                      ? t("confirmOnRequest", { count: String(selected.size) })
                      : t("confirmUnpublish", { count: String(selected.size) })}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-end gap-2">
                <BarButton
                  onClick={() => {
                    if (confirming && bulk === "delivery") setConfirming(false);
                    else {
                      setBulk(null);
                      setConfirming(false);
                    }
                  }}
                  disabled={pending}
                >
                  {t("back")}
                </BarButton>
                {bulk === "delivery" && !confirming ? (
                  <BarButton primary disabled={!leadOk} onClick={() => setConfirming(true)}>
                    {t("next")}
                  </BarButton>
                ) : (
                  <BarButton primary disabled={pending} onClick={runBulk}>
                    {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                    {t("confirm")}
                  </BarButton>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <Sheet
        open={open !== null}
        onOpenChange={(v) => {
          if (!v) setOpenId(null);
        }}
        title={open?.name ?? ""}
        closeLabel={t("close")}
        className="w-[min(28rem,94vw)]"
      >
        {open && (
          <FixDrawer
            key={open.id}
            locale={locale}
            row={open}
            suppliers={suppliers}
            onSaved={(remaining) => onSaved(open.id, remaining)}
          />
        )}
      </Sheet>
    </div>
  );
}

const REASONS = new Set([
  "notFound",
  "offerSave",
  "recompute",
  "stillMissing",
  "settings",
  "unpublish",
  "forbidden",
  "supplier",
  "load",
  "input",
]);
function reasonKey(reason: string) {
  return REASONS.has(reason) ? reason : "unknown";
}

function BarButton({
  children,
  onClick,
  primary,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50",
        primary ? "bg-cobalt text-white hover:bg-cobalt-hover" : "border border-borderstrong text-heading hover:border-cobalt hover:text-cobalt"
      )}
    >
      {children}
    </button>
  );
}

function FixDrawer({
  locale,
  row,
  suppliers,
  onSaved,
}: {
  locale: string;
  row: FixListRow;
  suppliers: FixSupplier[];
  onSaved: (remaining: FixIssue[]) => void;
}) {
  const t = useTranslations("FixList");
  const needOffer = row.issues.includes("delivery") || row.issues.includes("supplier");
  const needPhoto = row.issues.includes("photo");
  const needPrice = row.issues.includes("price");
  const [supplier, setSupplier] = useState(OWN);
  const [lead, setLead] = useState("");
  const [cost, setCost] = useState("");
  const [image, setImage] = useState("");
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const firstGroup = ISSUE_ORDER.find((i) => row.issues.includes(i)) ?? row.issues[0];
  const returnTo = `/${locale}/dashboard/store/fix#fix-${firstGroup}-${row.id}`;

  const save = () =>
    start(async () => {
      setError(null);
      const offer = needOffer && lead.trim() !== "" ? { supplier, leadDays: lead.trim(), cost: cost.trim() || null } : null;
      const imageUrl = needPhoto && image.trim() ? image.trim() : null;
      const p = needPrice && price.trim() ? price.trim() : null;
      if (!offer && !imageUrl && !p) {
        setError(t("drawerNothing"));
        return;
      }
      let res: Awaited<ReturnType<typeof fixOne>>;
      try {
        res = await fixOne(locale, row.id, { offer, imageUrl, price: p });
      } catch {
        setError(t("errorGeneric"));
        return;
      }
      if ("error" in res) {
        setError(res.reason ? t(`reason_${reasonKey(res.reason)}`) : t(`drawerError_${res.error}`));
        return;
      }
      if (res.remaining.length > 0) {
        setError(t("drawerStill", { list: res.remaining.map((i) => t(`issue_${i}`)).join(" · ") }));
      }
      onSaved(res.remaining);
    });

  const addThis = <span className="text-[11px] font-bold uppercase tracking-wide text-red-700">{t("addThis")}</span>;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="space-y-4"
    >
      {needOffer && (
        <fieldset className={missingBox}>
          <legend className="flex items-center gap-2 px-1 text-sm font-bold text-heading">
            {t("issue_delivery")} {addThis}
          </legend>
          {row.why && (
            <p className="mb-2 text-xs text-mutedtext">
              {t(`why_${row.why.code}`, { supplier: row.why.supplier ?? t("aSupplier") })}
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs font-semibold text-body sm:col-span-2">
              <span>{t("supplierLabel")}</span>
              <select value={supplier} onChange={(e) => setSupplier(e.target.value)} className={field}>
                <option value={OWN}>{t("ownStock")}</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs font-semibold text-body">
              <span>{t("leadDaysLabel")}</span>
              <input
                value={lead}
                onChange={(e) => setLead(e.target.value)}
                inputMode="numeric"
                dir="ltr"
                aria-invalid={lead.trim() === ""}
                className={cn(field, lead.trim() === "" && "ring-2 ring-red-400")}
                autoFocus
              />
            </label>
            <label className="space-y-1 text-xs font-semibold text-body">
              <span>{t("costLabel")}</span>
              <input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" dir="ltr" className={field} />
            </label>
          </div>
        </fieldset>
      )}

      {needPhoto && (
        <div className={missingBox}>
          <label className="space-y-1 text-xs font-semibold text-body">
            <span className="flex items-center gap-2 text-sm font-bold text-heading">
              {t("issue_photo")} {addThis}
            </span>
            <input
              value={image}
              onChange={(e) => setImage(e.target.value)}
              type="url"
              dir="ltr"
              placeholder="https://"
              aria-invalid={image.trim() === ""}
              className={cn(field, image.trim() === "" && "ring-2 ring-red-400")}
            />
            <span className="block font-normal text-mutedtext">{t("photoHint")}</span>
          </label>
        </div>
      )}

      {needPrice && (
        <div className={missingBox}>
          <label className="space-y-1 text-xs font-semibold text-body">
            <span className="flex items-center gap-2 text-sm font-bold text-heading">
              {t("issue_price")} {addThis}
            </span>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              dir="ltr"
              aria-invalid={price.trim() === ""}
              className={cn(field, price.trim() === "" && "ring-2 ring-red-400")}
            />
            <span className="block font-normal text-mutedtext">{t("priceHint")}</span>
          </label>
        </div>
      )}

      {error && <p className="text-sm font-medium text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-cobalt px-5 py-2 text-sm font-semibold text-white hover:bg-cobalt-hover disabled:opacity-50"
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("save")}
        </button>
        <Link href={editHref(row.id, returnTo)} className="text-sm font-semibold text-cobalt underline-offset-2 hover:underline">
          {t("fullEdit")}
        </Link>
      </div>
    </form>
  );
}
