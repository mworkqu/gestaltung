"use client";

// The two ways a part enters a project, split at the moment of adding:
//
//   AddExistingDialog — pick from the Store or My Inventory. Stored as
//     source "catalog" with the SKU, price and stock it had when added.
//     Orderable today. Lead time: neither source records one, so the picker
//     says so instead of showing a number.
//   CreatePartDialog — asks what kind first (mechanical / electronics board /
//     software or website), because each goes to a different branch. Stored
//     as source "to_design", with no price.

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Cpu, Loader2, Plus, Search, SquareCode, Sparkles, Wrench } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { MATERIALS, PROCESSES, type Discipline } from "@/lib/prototyping/constants";
import { suggestSpec } from "@/lib/prototyping/engine";
import { formatPrice, partName } from "@/lib/parts/format";
import { Tag } from "@/components/ui/tag";
import {
  GhostButton,
  PrimaryButton,
  SoftButton,
  fieldClass,
  selectClass,
} from "@/components/prototyping/ui";
import { cn } from "@/lib/utils";
import type { Part } from "@/lib/supabase/types";

type StorePart = Pick<Part, "id" | "sku" | "name" | "name_ar" | "unit_price" | "stock_status">;

type Choice = {
  key: string;
  name: string;
  sku: string | null;
  price: number | null;
  stock: string;
  stockQty: number | null;
  catalogPartId: string | null;
  inventoryItemId: string | null;
};

function Dialog({
  title,
  sub,
  onClose,
  children,
}: {
  title: string;
  sub?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-4 backdrop-blur-sm sm:p-6"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="neu max-h-[calc(100vh-3rem)] w-full max-w-lg space-y-4 overflow-y-auto p-6 sm:p-8"
      >
        <div>
          <h2 className="text-lg font-extrabold tracking-tight text-heading">{title}</h2>
          {sub && <p className="mt-1 text-sm text-mutedtext">{sub}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Add an existing part ────────────────────────────────────────────────────

export function AddExistingDialog({
  projectId,
  nextIndex,
  onClose,
  onAdded,
}: {
  projectId: string;
  nextIndex: number;
  onClose: () => void;
  onAdded: () => Promise<void>;
}) {
  const t = useTranslations("Prototyping");
  const tParts = useTranslations("Parts");
  const locale = useLocale();
  const [from, setFrom] = useState<"store" | "inventory">("store");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Choice[] | null>(null);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const supabase = createClient();
    // PostgREST filter syntax: keep only characters that can't break it.
    const term = q.replace(/[^\p{L}\p{N}\s-]/gu, "").trim();
    const timer = setTimeout(async () => {
      if (from === "store") {
        let query = supabase
          .from("parts")
          .select("id, sku, name, name_ar, unit_price, stock_status")
          .eq("is_published", true)
          .order("name")
          .limit(20);
        if (term) query = query.or(`name.ilike.%${term}%,name_ar.ilike.%${term}%,sku.ilike.%${term}%`);
        const { data } = await query;
        if (!live) return;
        setResults(
          ((data ?? []) as StorePart[]).map((p) => ({
            key: p.id,
            name: partName(p, locale),
            sku: p.sku,
            price: Number(p.unit_price),
            stock: p.stock_status,
            stockQty: null,
            catalogPartId: p.id,
            inventoryItemId: null,
          }))
        );
      } else {
        const { data } = await supabase
          .from("client_inventory_items")
          .select("id, custom_name, quantity, product:parts(id, sku, name, name_ar, unit_price, stock_status)")
          .order("created_at", { ascending: false })
          .limit(100);
        if (!live) return;
        type Row = { id: string; custom_name: string | null; quantity: number; product: StorePart | null };
        const rows = ((data ?? []) as unknown as Row[]).map((r) => ({
          key: r.id,
          name: r.product ? partName(r.product, locale) : r.custom_name ?? "—",
          sku: r.product?.sku ?? null,
          price: r.product ? Number(r.product.unit_price) : null,
          stock: "in_inventory",
          stockQty: r.quantity,
          catalogPartId: r.product?.id ?? null,
          inventoryItemId: r.id,
        }));
        const needle = term.toLowerCase();
        setResults(
          needle
            ? rows.filter((r) => `${r.name} ${r.sku ?? ""}`.toLowerCase().includes(needle))
            : rows
        );
      }
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [from, q, locale]);

  async function add(p: Choice) {
    setBusy(true);
    const { error } = await createClient().from("project_parts").insert({
      project_id: projectId,
      code: `P-${String(nextIndex).padStart(2, "0")}`,
      position: nextIndex,
      name: p.name,
      quantity: qty,
      source: "catalog",
      kind: null,
      catalog_part_id: p.catalogPartId,
      inventory_item_id: p.inventoryItemId,
      sku: p.sku,
      unit_price: p.price,
      stock_status: p.stock,
      stock_qty: p.stockQty,
      status: "added",
    });
    setBusy(false);
    setFailed(!!error);
    if (error) return;
    await onAdded();
    onClose();
  }

  const stockLabel = (p: Choice) =>
    p.stock === "in_inventory"
      ? t("stock_in_inventory", { count: p.stockQty ?? 0 })
      : tParts(`stock_${p.stock}`);

  return (
    <Dialog title={t("addExisting")} sub={t("addExistingSub")} onClose={onClose}>
      <div className="flex gap-1.5" role="tablist">
        {(["store", "inventory"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={from === k}
            onClick={() => {
              setFrom(k);
              setResults(null);
            }}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
              from === k ? "bg-panel text-heading shadow-neu-inset" : "text-mutedtext hover:text-heading"
            )}
          >
            {t(k === "store" ? "fromStore" : "fromInventory")}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("searchParts")}
            aria-label={t("searchParts")}
            autoFocus
            className={cn(fieldClass, "py-2 ps-9")}
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-mutedtext">
          {t("quantity")}
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
            className={cn(selectClass, "w-16 text-center")}
          />
        </label>
      </div>

      {results === null ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-mutedtext" />
        </div>
      ) : results.length === 0 ? (
        <p className="py-4 text-sm text-mutedtext">
          {t(from === "store" ? "noStoreResults" : "noInventoryResults")}
        </p>
      ) : (
        <ul className="max-h-80 space-y-1.5 overflow-y-auto">
          {results.map((p) => (
            <li key={p.key} className="flex items-center gap-3 rounded-xl bg-panel px-3 py-2.5 shadow-neu-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-heading">{p.name}</p>
                <p className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-mutedtext">
                  {p.sku && <span className="font-mono">{p.sku}</span>}
                  <span>{p.price !== null ? formatPrice(p.price, locale) : t("priceNotListed")}</span>
                  <span>{stockLabel(p)}</span>
                  <span>{t("leadTimeNotListed")}</span>
                </p>
              </div>
              <SoftButton onClick={() => add(p)} disabled={busy}>
                <Plus className="h-3 w-3" />
                {t("add")}
              </SoftButton>
            </li>
          ))}
        </ul>
      )}

      {failed && <p className="text-xs font-medium text-destructive">{t("addFailed")}</p>}
      <div className="flex justify-end">
        <GhostButton onClick={onClose}>{t("cancel")}</GhostButton>
      </div>
    </Dialog>
  );
}

// ── Create a new part to design ─────────────────────────────────────────────

const KIND_ICON: Record<Discipline, typeof Wrench> = {
  mechanical: Wrench,
  electronics: Cpu,
  software: SquareCode,
};

export function CreatePartDialog({
  projectId,
  nextIndex,
  initialKind,
  onClose,
  onAdded,
}: {
  projectId: string;
  nextIndex: number;
  initialKind?: Discipline;
  onClose: () => void;
  onAdded: () => Promise<void>;
}) {
  const t = useTranslations("Prototyping");
  const tProj = useTranslations("Projects");
  const [kind, setKind] = useState<Discipline | null>(initialKind ?? null);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [qty, setQty] = useState(1);
  const [material, setMaterial] = useState("");
  const [process, setProcess] = useState("");
  const [suggestion, setSuggestion] = useState<ReturnType<typeof suggestSpec> | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function add() {
    if (!kind || !name.trim()) return;
    setBusy(true);
    // A board is always FR-4 through PCB manufacturing; software has neither.
    const spec =
      kind === "electronics"
        ? { material: "fr4", process: "pcb_manufacturing" }
        : kind === "software"
          ? { material: null, process: null }
          : { material: material || null, process: process || null };
    const { error } = await createClient().from("project_parts").insert({
      project_id: projectId,
      code: `P-${String(nextIndex).padStart(2, "0")}`,
      position: nextIndex,
      name: name.trim(),
      description: desc.trim() || null,
      quantity: qty,
      source: "to_design",
      kind,
      ...spec,
      status: "added",
    });
    setBusy(false);
    setFailed(!!error);
    if (error) return;
    await onAdded();
    onClose();
  }

  if (!kind) {
    return (
      <Dialog title={t("createNew")} sub={t("createNewSub")} onClose={onClose}>
        <ul className="grid gap-2">
          {(["mechanical", "electronics", "software"] as const).map((k) => {
            const Icon = KIND_ICON[k];
            return (
              <li key={k}>
                <button
                  type="button"
                  onClick={() => setKind(k)}
                  className="flex w-full items-center gap-3 rounded-xl bg-panel p-4 text-start shadow-neu-sm transition-colors hover:text-cobalt"
                >
                  <Icon className="h-5 w-5 shrink-0 text-cobalt" strokeWidth={1.6} />
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-heading">{t(`kind_${k}`)}</span>
                    <span className="block text-[12px] text-mutedtext">{t(`kindHint_${k}`)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex justify-end">
          <GhostButton onClick={onClose}>{t("cancel")}</GhostButton>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title={t("createNew")} onClose={onClose}>
      <div className="flex items-center gap-2">
        <Tag variant="neutral">{t(`kind_${kind}`)}</Tag>
        {!initialKind && (
          <GhostButton onClick={() => setKind(null)} className="px-1">
            {t("changeKind")}
          </GhostButton>
        )}
      </div>

      <label className="block space-y-1.5">
        <span className="text-xs font-semibold text-heading">{t("partName")}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          className={cn(fieldClass, "py-2.5")}
        />
      </label>
      <label className="block space-y-1.5">
        <span className="text-xs font-semibold text-heading">
          {t(kind === "software" ? "scopeField" : "partDesc")}
        </span>
        <textarea
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          rows={kind === "software" ? 4 : 2}
          className={cn(fieldClass, "resize-y py-2.5")}
        />
      </label>

      <div className={cn("grid gap-3", kind === "mechanical" && "sm:grid-cols-3")}>
        {kind === "mechanical" && (
          <>
            <label className="space-y-1.5">
              <span className="text-xs font-semibold text-heading">{t("material")}</span>
              <select
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
                className={cn(selectClass, "w-full py-2.5")}
              >
                <option value="">{t("unset")}</option>
                {MATERIALS.filter((m) => m !== "fr4").map((m) => (
                  <option key={m} value={m}>
                    {tProj(`material_${m}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-semibold text-heading">{t("process")}</span>
              <select
                value={process}
                onChange={(e) => setProcess(e.target.value)}
                className={cn(selectClass, "w-full py-2.5")}
              >
                <option value="">{t("unset")}</option>
                {PROCESSES.filter((p) => p !== "pcb_manufacturing").map((p) => (
                  <option key={p} value={p}>
                    {t(`process_${p}`)}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <label className="space-y-1.5">
          <span className="text-xs font-semibold text-heading">{t("quantity")}</span>
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
            className={cn(selectClass, "w-full py-2.5 text-center")}
          />
        </label>
      </div>

      {kind === "mechanical" && (
        // A suggestion, shown as one — it fills nothing until clicked.
        <div className="space-y-2">
          <SoftButton onClick={() => setSuggestion(suggestSpec(`${name} ${desc}`))}>
            <Sparkles className="h-3.5 w-3.5" />
            {t("suggestSpec")}
          </SoftButton>
          {suggestion && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-cobalt/[0.07] px-3 py-2 text-xs text-heading">
              <span className="min-w-0 flex-1">
                {t("suggestBecause", {
                  material: tProj(`material_${suggestion.material}`),
                  process: t(`process_${suggestion.process}`),
                  reason: t(`reason_${suggestion.reasonKey}`),
                })}
              </span>
              <PrimaryButton
                onClick={() => {
                  setMaterial(suggestion.material);
                  setProcess(suggestion.process);
                }}
              >
                {t("useSuggestion")}
              </PrimaryButton>
            </div>
          )}
        </div>
      )}

      {failed && <p className="text-xs font-medium text-destructive">{t("addFailed")}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <GhostButton onClick={onClose}>{t("cancel")}</GhostButton>
        <PrimaryButton onClick={add} disabled={busy || !name.trim()}>
          <Plus className="h-3.5 w-3.5" />
          {t("createPart")}
        </PrimaryButton>
      </div>
    </Dialog>
  );
}
