"use client";

// Electronics leaves that have no editor of their own. Each says only what we
// actually know and points at the one place the client can change it. The
// Power leaf also shows the stored circuit's power budget per rail — the same
// powerBudget() the hard rules block on, so the numbers always agree.

import { useTranslations } from "next-intl";
import { CircleAlert, ListChecks, PackagePlus, Plug } from "lucide-react";

import { powerBudget, type Netlist } from "@/lib/prototyping/netlist";
import { rowOf, type Spec } from "@/lib/prototyping/spec";
import { formatFact } from "@/components/prototyping/spec-sheet";
import { Card, PrimaryButton, SoftButton } from "@/components/prototyping/ui";

export function PowerCard({
  spec,
  netlist,
  onSet,
  onCircuit,
}: {
  spec: Spec | null;
  /** The stored circuit: its rails and each part's typical draw make the budget. */
  netlist: Netlist | null;
  onSet: () => void;
  onCircuit: () => void;
}) {
  const t = useTranslations("Prototyping");
  const row = rowOf(spec, "power");
  const budget = netlist ? powerBudget(netlist) : [];
  const who = (ref: string) => {
    const c = netlist?.components.find((x) => x.ref === ref);
    return c ? `${ref} (${c.function})` : ref;
  };
  return (
    <Card kicker={t("discipline_electronics")} title={t("powerTitle")} intro={t("powerIntro")}>
      <p className="flex items-center gap-2 text-sm text-heading">
        <Plug className="h-4 w-4 shrink-0 text-cobalt" />
        {row?.value ? t("powerIs", { source: formatFact("power", row.value, t) }) : t("powerUnknown")}
      </p>
      <SoftButton onClick={onSet}>{t(row?.value ? "powerChange" : "powerSet")}</SoftButton>

      <div className="space-y-2 border-t border-borderstrong/40 pt-3">
        <p className="text-xs font-bold text-heading">{t("powerBudgetTitle")}</p>
        {!budget.length && <p className="text-[12px] text-mutedtext">{t("powerBudgetNone")}</p>}
        {budget.map((b) => (
          <div key={b.rail} className="space-y-1 rounded-xl bg-panel/60 p-3 shadow-neu-inset">
            <p className="text-[12px] font-semibold text-heading">
              {t("powerRail", { name: b.rail, source: who(b.sourceRef), max: b.maxMa })}
            </p>
            <ul className="space-y-0.5 ps-1 font-mono text-[11px] text-mutedtext">
              {b.loads.map((l) => (
                <li key={l.ref}>
                  {l.ma === null
                    ? t("powerLoadUnknown", { ref: who(l.ref) })
                    : l.assumed
                      ? t("rule_assumedLoad", { ref: who(l.ref), ma: l.ma })
                      : t("powerLoad", { ref: who(l.ref), ma: l.ma })}
                </li>
              ))}
            </ul>
            <p className="text-[12px] text-heading">{t("powerDraw", { ma: b.drawMa })}</p>
            {b.headroomMa >= 0 ? (
              <p className="text-[12px] font-semibold text-heading">{t("powerHeadroom", { ma: b.headroomMa })}</p>
            ) : (
              <button
                type="button"
                onClick={onCircuit}
                className="flex items-start gap-2 text-start text-[12px] font-semibold text-destructive hover:underline"
              >
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {t("powerOver", { ma: -b.headroomMa })}
              </button>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

export function ComponentsCard({
  onAddExisting,
  onOpenList,
}: {
  onAddExisting: () => void;
  onOpenList: () => void;
}) {
  const t = useTranslations("Prototyping");
  return (
    <Card kicker={t("discipline_electronics")} title={t("componentsTitle")} intro={t("componentsIntro")}>
      <div className="flex flex-wrap gap-2">
        <PrimaryButton onClick={onAddExisting}>
          <PackagePlus className="h-3.5 w-3.5" />
          {t("addExisting")}
        </PrimaryButton>
        <SoftButton onClick={onOpenList}>
          <ListChecks className="h-3.5 w-3.5" />
          {t("openPartsList")}
        </SoftButton>
      </div>
    </Card>
  );
}
