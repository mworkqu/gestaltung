"use client";

// The Parts list: every part in the project, whatever its source.
//
// This is the one table. The discipline branches show only the to-design rows
// of their kind, for design work — the same records, never a copy — so this
// table is where price, stock and source live and the branches don't repeat
// them. Status reads partNeeds(), the same function readiness uses.

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRight, PackagePlus, Plus, Trash2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { formatPrice } from "@/lib/parts/format";
import { disciplineOf, isCatalog, partNeeds } from "@/lib/prototyping/parts";
import { MAX_PARTS } from "@/lib/prototyping/constants";
import { Tag } from "@/components/ui/tag";
import { AddExistingDialog, CreatePartDialog } from "@/components/prototyping/part-dialogs";
import { Card, PrimaryButton, SoftButton, selectClass } from "@/components/prototyping/ui";
import { cn } from "@/lib/utils";
import type { ProjectPart } from "@/lib/supabase/types";

type Filter = "all" | "catalog" | "to_design";

export function PartsList({
  projectId,
  parts,
  nextIndex,
  onChanged,
  onOpen,
}: {
  projectId: string;
  parts: ProjectPart[];
  nextIndex: number;
  onChanged: () => Promise<void>;
  /** Opens a to-design part where it is designed. */
  onOpen: (part: ProjectPart) => void;
}) {
  const t = useTranslations("Prototyping");
  const tParts = useTranslations("Parts");
  const locale = useLocale();
  const [filter, setFilter] = useState<Filter>("all");
  const [dialog, setDialog] = useState<"existing" | "new" | null>(null);

  const shown = parts.filter(
    (p) => filter === "all" || (filter === "catalog" ? isCatalog(p) : !isCatalog(p))
  );
  const full = parts.length >= MAX_PARTS;

  async function setQty(part: ProjectPart, quantity: number) {
    await createClient().from("project_parts").update({ quantity }).eq("id", part.id);
    await onChanged();
  }

  async function remove(part: ProjectPart) {
    // One record: removing it here removes its design item too.
    await createClient().from("project_parts").delete().eq("id", part.id);
    await onChanged();
  }

  function status(part: ProjectPart) {
    if (isCatalog(part)) {
      const label =
        part.stock_status === "in_inventory"
          ? t("stock_in_inventory", { count: part.stock_qty ?? 0 })
          : part.stock_status
            ? tParts(`stock_${part.stock_status}`)
            : t("orderable");
      return (
        <Tag variant={part.stock_status === "out_of_stock" ? "inventory" : "buy"}>{label}</Tag>
      );
    }
    const needs = partNeeds(part);
    return needs.length ? (
      <span className="text-[11.5px] text-inventory">
        {needs.map((n) => t(`partNeed_${n}`)).join(" · ")}
      </span>
    ) : (
      <Tag variant="buy">{t("readyToMake")}</Tag>
    );
  }

  return (
    <Card
      kicker={t("node_parts")}
      title={t("partsListTitle")}
      intro={t("partsListIntro")}
      actions={
        <>
          <SoftButton onClick={() => setDialog("existing")} disabled={full}>
            <PackagePlus className="h-3.5 w-3.5" />
            {t("addExisting")}
          </SoftButton>
          <PrimaryButton onClick={() => setDialog("new")} disabled={full}>
            <Plus className="h-3.5 w-3.5" />
            {t("createNew")}
          </PrimaryButton>
        </>
      }
    >
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("filterSource")}>
        {(["all", "catalog", "to_design"] as const).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
              filter === f ? "bg-panel text-heading shadow-neu-inset" : "text-mutedtext hover:text-heading"
            )}
          >
            {t(`filter_${f}`)}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-mutedtext">{parts.length ? t("noPartsFiltered") : t("noParts")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-faint">
                <th className="px-2 pb-2 text-start font-medium">{t("colCode")}</th>
                <th className="px-2 pb-2 text-start font-medium">{t("colPart")}</th>
                <th className="px-2 pb-2 text-start font-medium">{t("colSource")}</th>
                <th className="px-2 pb-2 text-start font-medium">{t("quantity")}</th>
                <th className="px-2 pb-2 text-start font-medium">{t("colPrice")}</th>
                <th className="px-2 pb-2 text-start font-medium">{t("colStatus")}</th>
                <th className="px-2 pb-2">
                  <span className="sr-only">{t("deletePart")}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-borderstrong/40">
              {shown.map((part) => {
                const kind = disciplineOf(part);
                return (
                  <tr key={part.id} className="align-middle">
                    <td className="px-2 py-2.5 font-mono text-[11px] text-faint">{part.code}</td>
                    <td className="px-2 py-2.5">
                      {kind ? (
                        <button
                          type="button"
                          onClick={() => onOpen(part)}
                          className="group inline-flex items-center gap-1 text-start text-[13px] font-semibold text-heading hover:text-cobalt"
                        >
                          {part.name}
                          <ChevronRight className="h-3 w-3 opacity-50 rtl:rotate-180" />
                        </button>
                      ) : (
                        <span className="text-[13px] font-semibold text-heading">{part.name}</span>
                      )}
                      <span className="block text-[11px] text-mutedtext">
                        {kind ? t(`kind_${kind}`) : part.sku && <span className="font-mono">{part.sku}</span>}
                      </span>
                    </td>
                    <td className="px-2 py-2.5">
                      <Tag variant={isCatalog(part) ? "buy" : "neutral"}>
                        {t(isCatalog(part) ? "source_catalog" : "source_to_design")}
                      </Tag>
                    </td>
                    <td className="px-2 py-2.5">
                      <input
                        type="number"
                        min={1}
                        defaultValue={part.quantity}
                        aria-label={`${t("quantity")} ${part.code}`}
                        onBlur={(e) => {
                          const q = Math.max(1, parseInt(e.target.value, 10) || 1);
                          if (q !== part.quantity) void setQty(part, q);
                        }}
                        className={cn(selectClass, "w-16 text-center")}
                      />
                    </td>
                    <td className="px-2 py-2.5 text-[12px] tabular-nums text-heading">
                      {isCatalog(part) && part.unit_price != null ? (
                        formatPrice(Number(part.unit_price), locale)
                      ) : (
                        <span className="text-mutedtext" title={isCatalog(part) ? undefined : t("pricedAtQuote")}>
                          —
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2.5">{status(part)}</td>
                    <td className="px-2 py-2.5 text-end">
                      <button
                        type="button"
                        onClick={() => remove(part)}
                        aria-label={`${t("deletePart")} ${part.code}`}
                        className="rounded p-1 text-faint transition-colors hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {dialog === "existing" && (
        <AddExistingDialog
          projectId={projectId}
          nextIndex={nextIndex}
          onClose={() => setDialog(null)}
          onAdded={onChanged}
        />
      )}
      {dialog === "new" && (
        <CreatePartDialog
          projectId={projectId}
          nextIndex={nextIndex}
          onClose={() => setDialog(null)}
          onAdded={onChanged}
        />
      )}
    </Card>
  );
}
