import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipboardCheck, HeartPulse, MessageCircleQuestion, ShieldAlert, UserX, Wallet, type LucideIcon } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { HelpTip, PageHeader } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { loadAdminHome, type HomeCard } from "@/lib/cad-champions/admin/home-server";
import { requireCcStaff } from "@/lib/cad-champions/auth/server";
import { formatDateTime, formatNumber } from "@/lib/cad-champions/format";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";

// Admin home "Today" (Prompt 11 Step A): what is waiting, with counts and a
// link each. Instructors see drawings and questions only.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.admin.home" });
  return ccPageMetadata({ locale, path: "/admin", title: t("title") });
}

type CardDef = { id: string; icon: LucideIcon; href: string; card: HomeCard; detail?: string | null };

export default async function CcAdminHomePage({ params }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  const cc = await requireCcStaff(locale, ccPath(locale, "/admin"));
  const t = await getTranslations({ locale, namespace: "CC.admin.home" });
  const home = await loadAdminHome(locale, cc.isAdmin);

  const waited = (hours: number | null | undefined, l: Locale): string | null => {
    if (hours == null) return null;
    const h = Math.floor(hours);
    if (h < 1) return t("oldestUnderHour");
    if (h < 48) return t("oldestHours", { hours: formatNumber(h, l) });
    return t("oldestDays", { days: formatNumber(Math.floor(h / 24), l) });
  };

  const cards: CardDef[] = [
    { id: "drawings", icon: ClipboardCheck, href: "/admin/review", card: home.drawings, detail: home.drawings.count ? waited(home.drawings.oldestHours, locale) : null },
    { id: "questions", icon: MessageCircleQuestion, href: "/admin/questions", card: home.questions },
  ];
  if (cc.isAdmin) {
    cards.push(
      {
        id: "payments",
        icon: Wallet,
        href: "/admin/payments",
        card: home.payments,
        detail: home.payments.count && home.payments.oldestAt ? t("oldestSince", { date: formatDateTime(home.payments.oldestAt, locale) }) : null,
      },
      { id: "deletions", icon: UserX, href: "/admin/operations/deletions", card: home.deletions },
      { id: "integrity", icon: ShieldAlert, href: "/admin/students?flagged=1", card: home.integrity },
      { id: "health", icon: HeartPulse, href: "/admin/health", card: home.health },
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} purpose={t("purpose")} help={<HelpTip label={t("helpLabel")}>{t("help")}</HelpTip>} />
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => {
          const n = c.card.count;
          const nothing = n === 0;
          return (
            <li key={c.id} className="neu flex flex-col gap-3 p-5">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface text-accent shadow-neu-sm">
                  <c.icon aria-hidden="true" strokeWidth={1.75} className="h-5 w-5" />
                </span>
                <h2 className="title-card">{t(`cards.${c.id}.title`)}</h2>
              </div>
              {n == null ? (
                <p className="text-sm text-mutedtext">{t("unknown")}</p>
              ) : nothing ? (
                <p className="text-sm text-body">{t("nothing")}</p>
              ) : (
                <p className="flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold tabular-nums text-heading">{formatNumber(n, locale)}</span>
                  <span className="text-sm text-body">{t(`cards.${c.id}.unit`)}</span>
                </p>
              )}
              {c.detail ? <p className="text-xs text-mutedtext">{c.detail}</p> : null}
              <p className="text-xs text-mutedtext">{t(`cards.${c.id}.text`)}</p>
              <Link
                href={ccPath(locale, c.href)}
                className="mt-auto inline-flex min-h-11 w-fit items-center rounded-full bg-accent px-5 text-sm font-semibold text-accent-foreground shadow-neu-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
              >
                {t(`cards.${c.id}.cta`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
