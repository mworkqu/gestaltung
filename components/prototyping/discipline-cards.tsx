"use client";

// Electronics leaves that have no editor of their own. Each says only what we
// actually know and points at the one place the client can change it.

import { useTranslations } from "next-intl";
import { ListChecks, PackagePlus, Plug } from "lucide-react";

import { rowOf, type Spec } from "@/lib/prototyping/spec";
import { formatFact } from "@/components/prototyping/spec-sheet";
import { Card, PrimaryButton, SoftButton } from "@/components/prototyping/ui";

export function PowerCard({ spec, onSet }: { spec: Spec | null; onSet: () => void }) {
  const t = useTranslations("Prototyping");
  const row = rowOf(spec, "power");
  return (
    <Card kicker={t("discipline_electronics")} title={t("powerTitle")} intro={t("powerIntro")}>
      <p className="flex items-center gap-2 text-sm text-heading">
        <Plug className="h-4 w-4 shrink-0 text-cobalt" />
        {row?.value ? t("powerIs", { source: formatFact("power", row.value, t) }) : t("powerUnknown")}
      </p>
      <SoftButton onClick={onSet}>{t(row?.value ? "powerChange" : "powerSet")}</SoftButton>
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
