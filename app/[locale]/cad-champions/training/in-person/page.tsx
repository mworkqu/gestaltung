import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Backpack, CalendarDays, ExternalLink, MapPin, ShieldAlert, Trophy, Users, Wrench } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { SignedInExtras } from "@/components/cad-champions/shell/signed-in-extras";
import { BackToTraining } from "@/components/cad-champions/training/page-bits";
import { EmptyState, HelpTip, PageHeader, StatusChip, type ChipTone } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { requireCcUser } from "@/lib/cad-champions/auth/server";
import type { CcCohort } from "@/lib/cad-champions/db/types";
import { formatDate, formatNumber } from "@/lib/cad-champions/format";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";
import { IN_PERSON_MAP_URL } from "@/lib/cad-champions/training/catalog";
import { pick } from "@/lib/cad-champions/training/server";
import { createClient } from "@/lib/supabase/server";

// In-person cohorts (Prompt 9 Step G + COMPETITION_ALIGNMENT G): what
// happens, M4 conditions, schedule [TODO-MO], location, what to bring, who
// qualifies [TODO-MO], seats per cohort (cc_cohorts + cc_cohort_seats()).

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.training.meta" });
  return ccPageMetadata({ locale, path: "/training/in-person", title: t("inPerson") });
}

type CohortView = Pick<CcCohort, "id" | "name_en" | "name_ar" | "starts_on" | "ends_on" | "schedule_en" | "schedule_ar" | "location_en" | "location_ar" | "seats_total" | "status"> & {
  taken: number;
};

async function loadCohorts(): Promise<CohortView[]> {
  try {
    const db = await createClient();
    const [{ data: cohorts }, { data: seats }] = await Promise.all([
      db.from("cc_cohorts").select("id,name_en,name_ar,starts_on,ends_on,schedule_en,schedule_ar,location_en,location_ar,seats_total,status").neq("status", "draft").order("starts_on", { ascending: true, nullsFirst: false }),
      db.rpc("cc_cohort_seats"),
    ]);
    const taken = new Map(((seats ?? []) as { cohort_id: string; seats_taken: number }[]).map((s) => [s.cohort_id, s.seats_taken]));
    return ((cohorts ?? []) as Omit<CohortView, "taken">[]).map((c) => ({ ...c, taken: taken.get(c.id) ?? 0 }));
  } catch {
    return [];
  }
}

const STATUS_TONE: Record<string, ChipTone> = { open: "success", full: "warning", closed: "neutral", completed: "neutral" };

export default async function CcInPersonPage({ params }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  await requireCcUser(locale, ccPath(locale, "/training/in-person"));
  const t = await getTranslations({ locale, namespace: "CC.training.inPerson" });
  const cohorts = await loadCohorts();

  const card = "neu space-y-3 p-6";
  const head = (Icon: typeof Wrench, id: string, text: string) => (
    <div className="flex items-center gap-2">
      <Icon aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 text-accent" />
      <h2 id={id} className="title-card">
        {text}
      </h2>
    </div>
  );

  return (
    <div className="container page-stack">
      <PageHeader title={t("title")} purpose={t("purpose")} actions={<BackToTraining locale={locale} />} />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card} aria-labelledby="ip-what">
          {head(Wrench, "ip-what", t("whatTitle"))}
          <ul className="list-disc space-y-1 ps-5 text-sm text-body">
            {(["measuring", "scanning", "printing", "mocks"] as const).map((k) => (
              <li key={k}>{t(`what.${k}`)}</li>
            ))}
          </ul>
        </section>

        <section className={card} aria-labelledby="ip-m4">
          <div className="flex items-center justify-between gap-2">
            {head(ShieldAlert, "ip-m4", t("m4Title"))}
            <HelpTip label={t("m4HelpLabel")}>{t("m4Help")}</HelpTip>
          </div>
          <p className="text-sm text-body">{t("m4Text")}</p>
          <ul className="list-disc space-y-1 ps-5 text-sm text-body">
            {(["collect", "instruments", "noCopy", "computer"] as const).map((k) => (
              <li key={k}>{t(`m4.${k}`)}</li>
            ))}
          </ul>
          <Link href={ccPath(locale, "/training/instruments")} className="tap-target-y inline-flex items-center text-sm font-semibold text-accent underline underline-offset-2">
            {t("instrumentsLink")}
          </Link>
        </section>

        <section className={card} aria-labelledby="ip-schedule">
          {head(CalendarDays, "ip-schedule", t("scheduleTitle"))}
          <p className="text-sm text-body">{t("schedule")}</p>
        </section>

        <section className={card} aria-labelledby="ip-location">
          {head(MapPin, "ip-location", t("locationTitle"))}
          <p className="text-sm font-semibold text-ink">{t("location")}</p>
          <a href={IN_PERSON_MAP_URL} target="_blank" rel="noopener noreferrer" className="tap-target-y inline-flex items-center gap-1 text-sm font-semibold text-accent underline underline-offset-2">
            {t("map")}
            <ExternalLink aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 rtl:-scale-x-100" />
          </a>
        </section>

        <section className={card} aria-labelledby="ip-bring">
          {head(Backpack, "ip-bring", t("bringTitle"))}
          <ul className="list-disc space-y-1 ps-5 text-sm text-body">
            {(["laptop", "charger", "mouse", "notebook", "id"] as const).map((k) => (
              <li key={k}>{t(`bring.${k}`)}</li>
            ))}
          </ul>
        </section>

        <section className={card} aria-labelledby="ip-qualify">
          {head(Trophy, "ip-qualify", t("qualifyTitle"))}
          <p className="text-sm text-body">{t("qualify")}</p>
        </section>
      </div>

      <section className="space-y-3" aria-labelledby="ip-cohorts">
        <div className="flex items-center gap-2">
          <Users aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 text-accent" />
          <h2 id="ip-cohorts" className="title-section">
            {t("cohortsTitle")}
          </h2>
        </div>
        {cohorts.length === 0 ? (
          <EmptyState icon={Users} title={t("cohortsTitle")} description={t("cohortsEmpty")} />
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {cohorts.map((c) => (
              <li key={c.id} className="neu space-y-2 p-6">
                <CohortCard c={c} locale={locale} t={t} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <SignedInExtras pageName={t("title")} />
    </div>
  );
}

function CohortCard({ c, locale, t }: { c: CohortView; locale: Locale; t: Awaited<ReturnType<typeof getTranslations<"CC.training.inPerson">>> }) {
  const left = Math.max(0, c.seats_total - c.taken);
  const status = c.status in STATUS_TONE ? c.status : "closed";
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="title-card">{pick(locale, c.name_en, c.name_ar)}</h3>
        <StatusChip tone={STATUS_TONE[status] ?? "neutral"}>{t(`cohortStatus.${status as "open"}`)}</StatusChip>
      </div>
      <p className="text-sm text-body">
        {c.starts_on && c.ends_on ? t("cohortDates", { start: formatDate(c.starts_on, locale), end: formatDate(c.ends_on, locale) }) : t("cohortDatesSoon")}
      </p>
      {c.schedule_en || c.schedule_ar ? <p className="text-sm text-body">{pick(locale, c.schedule_en, c.schedule_ar)}</p> : null}
      {c.location_en || c.location_ar ? <p className="text-sm text-body">{pick(locale, c.location_en, c.location_ar)}</p> : null}
      <p className="text-sm font-semibold text-ink">
        {left === 0 ? t("cohortFull") : t("cohortSeats", { left: formatNumber(left, locale), total: formatNumber(c.seats_total, locale) })}
      </p>
    </>
  );
}
