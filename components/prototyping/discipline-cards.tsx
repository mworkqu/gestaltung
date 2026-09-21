"use client";

// Tree leaves that have no editor of their own yet. Each says only what we
// actually know, and points at the one place the client can change it.

import { useTranslations } from "next-intl";
import { Plug } from "lucide-react";

import { Link } from "@/i18n/navigation";
import type { PowerSource } from "@/lib/prototyping/engine";
import { Card, SoftButton } from "@/components/prototyping/ui";

export function PowerCard({
  power,
  onEditBrief,
}: {
  power: PowerSource | null;
  onEditBrief: () => void;
}) {
  const t = useTranslations("Prototyping");
  return (
    <Card kicker={t("discipline_electronics")} title={t("powerTitle")} intro={t("powerIntro")}>
      <p className="flex items-center gap-2 text-sm text-heading">
        <Plug className="h-4 w-4 shrink-0 text-cobalt" />
        {power ? t("powerFromBrief", { source: t(`power_${power}`) }) : t("powerUnknown")}
      </p>
      <SoftButton onClick={onEditBrief}>{t("editBrief")}</SoftButton>
    </Card>
  );
}

export function ComponentsCard() {
  const t = useTranslations("Prototyping");
  return (
    <Card kicker={t("discipline_electronics")} title={t("componentsTitle")} intro={t("componentsIntro")}>
      <Link
        href="/store"
        className="inline-flex w-fit items-center gap-1.5 rounded-lg bg-cobalt px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-cobalt-hover"
      >
        {t("openStore")}
      </Link>
    </Card>
  );
}

export function ScopeCard({ onEditBrief }: { onEditBrief: () => void }) {
  const t = useTranslations("Prototyping");
  return (
    <Card kicker={t("discipline_software")} title={t("scopeTitle")} intro={t("scopeIntro")}>
      <p className="max-w-[62ch] text-sm leading-relaxed text-body">{t("scopeBody")}</p>
      <SoftButton onClick={onEditBrief}>{t("editBrief")}</SoftButton>
    </Card>
  );
}
