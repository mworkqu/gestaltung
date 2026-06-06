"use client";

import { useState, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Loader2, Plus, Trash2, TriangleAlert } from "lucide-react";

import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  addBomRow,
  deleteBomRow,
  startJob,
} from "@/app/[locale]/dashboard/jobs/actions";

type InvItem = { id: string; name: string; unit: string; quantity: number };
type BomRow = {
  id: string;
  inventory_item_id: string;
  quantity_needed: number;
  item: { name: string; unit: string; quantity: number } | null;
};

const controlClass =
  "rounded-xl border border-white/60 bg-panel px-3 py-2 text-sm text-heading shadow-neu-inset focus:outline-none focus:ring-2 focus:ring-cobalt/60";

export function WorkshopJobPanel({
  jobId,
  status,
  inventoryItems,
  bomRows,
}: {
  jobId: string;
  status: string;
  inventoryItems: InvItem[];
  bomRows: BomRow[];
}) {
  const t = useTranslations("Jobs");
  const locale = useLocale();
  const isRtl = locale === "ar";
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("");
  const [confirming, setConfirming] = useState(false);

  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  function run(fn: () => Promise<{ error?: string; ok?: boolean }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  function onAdd() {
    if (!itemId || !qty) return;
    run(() =>
      addBomRow({
        locale,
        jobId,
        inventoryItemId: itemId,
        quantityNeeded: Number(qty),
      })
    );
    setItemId("");
    setQty("");
  }

  const understocked = bomRows.filter(
    (r) => r.item && r.quantity_needed > Number(r.item.quantity)
  );
  const showStart = status === "submitted";

  return (
    <div className="neu mt-6 space-y-5 p-5">
      <p className={mono("text-[10px] text-azure")}>{t("bomTitle")}</p>

      {/* BOM rows */}
      {bomRows.length === 0 ? (
        <p className="text-sm text-mutedtext">{t("bomEmpty")}</p>
      ) : (
        <ul className="space-y-2">
          {bomRows.map((r) => {
            const stock = r.item ? Number(r.item.quantity) : 0;
            const under = r.item ? r.quantity_needed > stock : false;
            return (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-panel px-3 py-2.5 shadow-neu-sm"
              >
                <span className="flex-1 text-sm font-medium text-heading">
                  {r.item?.name ?? "—"}
                </span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 text-xs",
                    under ? "font-semibold text-destructive" : "text-mutedtext"
                  )}
                >
                  {under && <TriangleAlert className="h-3.5 w-3.5" />}
                  {t("stockLine", {
                    needed: r.quantity_needed,
                    stock,
                    unit: r.item?.unit ?? "",
                  })}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    run(() => deleteBomRow({ locale, jobId, bomId: r.id }))
                  }
                  aria-label={t("delete")}
                  disabled={pending}
                  className="text-mutedtext hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Add a BOM row */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label className={mono("block text-[10px] text-mutedtext")}>
            {t("bomItemLabel")}
          </label>
          <select
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
            className={cn(controlClass, isRtl && "text-right")}
          >
            <option value="">{t("bomItemPlaceholder")}</option>
            {inventoryItems.map((it) => (
              <option key={it.id} value={it.id}>
                {it.name} ({it.quantity} {it.unit})
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className={mono("block text-[10px] text-mutedtext")}>
            {t("bomQtyLabel")}
          </label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className={cn(controlClass, "w-28")}
          />
        </div>
        <Button
          type="button"
          size="sm"
          disabled={pending || !itemId || !qty}
          onClick={onAdd}
          className="rounded-full"
        >
          <Plus className="h-4 w-4" />
          {t("bomAdd")}
        </Button>
      </div>

      {inventoryItems.length === 0 && (
        <p className="text-[11px] text-faint">{t("bomNoInventory")}</p>
      )}

      {/* Start Job */}
      {showStart && (
        <div className="space-y-3 border-t border-borderstrong/60 pt-4">
          {understocked.length > 0 && (
            <div className="flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2.5">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <p className="text-xs leading-relaxed text-destructive">
                {t("insufficientBanner", {
                  items: understocked
                    .map((r) => r.item?.name ?? "")
                    .filter(Boolean)
                    .join("، "),
                })}
              </p>
            </div>
          )}

          {!confirming ? (
            <Button
              type="button"
              disabled={pending}
              onClick={() => setConfirming(true)}
              className="rounded-full"
            >
              {t("startJob")}
            </Button>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-body">{t("startJobConfirm")}</span>
              <Button
                type="button"
                disabled={pending}
                onClick={() => run(() => startJob({ locale, jobId }))}
                className="rounded-full"
              >
                {pending && <Loader2 className="animate-spin" />}
                {t("startJobConfirmYes")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => setConfirming(false)}
                className="rounded-full"
              >
                {t("cancel")}
              </Button>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm font-medium text-destructive">{error}</p>}
    </div>
  );
}
