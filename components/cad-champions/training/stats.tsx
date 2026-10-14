import { Flame, Sparkles, Trophy } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { HelpTip } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { formatNumber } from "@/lib/cad-champions/format";
import { displayStreak } from "@/lib/cad-champions/training/gamification";
import { createClient } from "@/lib/supabase/server";

import { LevelBadge } from "./visuals";

export interface BadgeItem {
  id: string;
  level: number;
  moduleIndex: number;
  label: string;
}

/** XP, weekly streak and badges (training overview). */
export async function StatsPanel({ locale, xp, streak, badges }: { locale: Locale; xp: number; streak: number; badges: BadgeItem[] }) {
  const t = await getTranslations({ locale, namespace: "CC.training.stats" });
  const tile = "tile flex items-center gap-3";
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className={tile}>
          <Sparkles aria-hidden="true" strokeWidth={1.75} className="h-6 w-6 shrink-0 text-accent" />
          <div className="min-w-0">
            <p className="flex items-center gap-1 text-xs font-semibold text-body">
              {t("xp")}
              <HelpTip label={t("xpHelpLabel")}>{t("xpHelp")}</HelpTip>
            </p>
            <p className="text-xl font-extrabold text-heading">{formatNumber(xp, locale)}</p>
          </div>
        </div>
        <div className={tile}>
          <Flame aria-hidden="true" strokeWidth={1.75} className="h-6 w-6 shrink-0 text-accent" />
          <div className="min-w-0">
            <p className="flex items-center gap-1 text-xs font-semibold text-body">
              {t("streak")}
              <HelpTip label={t("streakHelpLabel")}>{t("streakHelp")}</HelpTip>
            </p>
            <p className="text-xl font-extrabold text-heading">{t("streakValue", { weeks: formatNumber(streak, locale) })}</p>
          </div>
        </div>
        <div className={tile}>
          <Trophy aria-hidden="true" strokeWidth={1.75} className="h-6 w-6 shrink-0 text-accent" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-body">{t("badges")}</p>
            <p className="text-xl font-extrabold text-heading">{formatNumber(badges.length, locale)}</p>
          </div>
        </div>
      </div>
      {badges.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label={t("badges")}>
          {badges.map((b) => (
            <li key={b.id}>
              <LevelBadge level={b.level} moduleIndex={b.moduleIndex} label={t("badgeLabel", { level: b.label })} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-body">{t("badgesEmpty")}</p>
      )}
    </div>
  );
}

/** One line for the dashboard training card; renders nothing before 0083 or with no activity. */
export async function DashboardTrainingStats({ userId, locale }: { userId: string; locale: Locale }) {
  try {
    const db = await createClient();
    const [{ data: xp, error }, { count }] = await Promise.all([
      db.from("cc_student_xp").select("xp,streak_weeks,last_active_week").eq("user_id", userId).maybeSingle<{ xp: number; streak_weeks: number; last_active_week: string | null }>(),
      db.from("cc_badges").select("level_id", { count: "exact", head: true }).eq("user_id", userId),
    ]);
    if (error || (!xp && !count)) return null;
    const t = await getTranslations({ locale, namespace: "CC.training.stats" });
    const streak = displayStreak(xp ? { streakWeeks: xp.streak_weeks, lastActiveWeek: xp.last_active_week } : null);
    return (
      <p className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Trophy aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 shrink-0 text-accent" />
        {t("dashboardLine", { xp: formatNumber(xp?.xp ?? 0, locale), streak: formatNumber(streak, locale), badges: formatNumber(count ?? 0, locale) })}
      </p>
    );
  } catch {
    return null;
  }
}
