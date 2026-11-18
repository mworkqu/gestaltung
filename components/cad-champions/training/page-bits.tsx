import Link from "next/link";
import { ArrowLeft, CheckCircle2, Circle, Lock, SearchX, Wrench } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Button, EmptyState, StatusChip, type ChipTone } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { formatNumber } from "@/lib/cad-champions/format";
import { ccPath } from "@/lib/cad-champions/routes";
import type { LevelStatus } from "@/lib/cad-champions/training/ladder";
import { splitMinutes } from "@/lib/cad-champions/training/ladder";

export async function BackToTraining({ locale, href }: { locale: Locale; href?: string }) {
  const t = await getTranslations({ locale, namespace: "CC.training.common" });
  return (
    <Button asChild variant="ghost" size="sm">
      <Link href={href ?? ccPath(locale, "/training")}>
        <ArrowLeft aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 rtl:-scale-x-100" />
        {t("back")}
      </Link>
    </Button>
  );
}

/** "Being set up" / error / not found states (never a crash before 0083). */
export async function TrainingUnavailable({ locale, reason }: { locale: Locale; reason: "not_set_up" | "error" | "not_found" }) {
  const t = await getTranslations({ locale, namespace: "CC.training.common" });
  const key = reason === "not_set_up" ? "notSetUp" : reason === "not_found" ? "notFound" : "error";
  return (
    <EmptyState
      icon={reason === "not_found" ? SearchX : Wrench}
      title={t(`${key}Title`)}
      description={t(`${key}Text`)}
      action={reason === "not_found" ? <BackToTraining locale={locale} /> : undefined}
    />
  );
}

const STATUS_TONE: Record<LevelStatus, ChipTone> = { locked: "neutral", unlocked: "info", completed: "success" };
const STATUS_ICON = { locked: Lock, unlocked: Circle, completed: CheckCircle2 } as const;

export async function LevelStatusChip({ locale, status }: { locale: Locale; status: LevelStatus }) {
  const t = await getTranslations({ locale, namespace: "CC.training.common.status" });
  return (
    <StatusChip tone={STATUS_TONE[status]} icon={STATUS_ICON[status]}>
      {t(status)}
    </StatusChip>
  );
}

/** "2 h 15 min" / "45 min" with Western digits. */
export async function formatDuration(locale: Locale, minutes: number): Promise<string> {
  const t = await getTranslations({ locale, namespace: "CC.training.common" });
  const { hours, minutes: m } = splitMinutes(minutes);
  if (hours === 0) return t("minutes", { minutes: formatNumber(m, locale) });
  return t("hoursMinutes", { hours: formatNumber(hours, locale), minutes: formatNumber(m, locale) });
}
