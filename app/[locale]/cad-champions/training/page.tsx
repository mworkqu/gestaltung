import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Award, Compass, MapPin, PlayCircle, Ruler, Sparkles } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { SignedInExtras } from "@/components/cad-champions/shell/signed-in-extras";
import { formatDuration, TrainingUnavailable } from "@/components/cad-champions/training/page-bits";
import { StatsPanel, type BadgeItem } from "@/components/cad-champions/training/stats";
import { ProgressRing } from "@/components/cad-champions/training/visuals";
import { Alert, Button, HelpTip, PageHeader, StatusChip } from "@/components/cad-champions/ui";
import { requireCcUser } from "@/lib/cad-champions/auth/server";
import { formatDate, formatNumber } from "@/lib/cad-champions/format";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";
import { hasFullAccess } from "@/lib/cad-champions/training/access";
import { continueItem, loadRecommendations, loadTrainingState, pick } from "@/lib/cad-champions/training/server";

// Training overview (Prompt 9 Step E): continue, recommendations from the
// latest skill map, module cards with progress, XP / streak / badges,
// certificates, the SOLIDWORKS honesty note and the free-sample banner.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.training.meta" });
  return ccPageMetadata({ locale, path: "/training", title: t("overview") });
}

export default async function CcTrainingPage({ params }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  const cc = await requireCcUser(locale, ccPath(locale, "/training"));
  const t = await getTranslations({ locale, namespace: "CC.training.overview" });

  const header = <PageHeader title={t("title")} purpose={t("purpose")} help={<HelpTip label={t("helpLabel")}>{t("help")}</HelpTip>} />;

  const state = await loadTrainingState(cc);
  if (!state.ok) {
    return (
      <div className="container page-stack">
        {header}
        <TrainingUnavailable locale={locale} reason={state.reason} />
        <SignedInExtras pageName={t("title")} />
      </div>
    );
  }

  const { catalog, progress, access, views } = state;
  const recommendations = await loadRecommendations(cc.user.id, catalog);
  const next = continueItem(catalog, views, progress);
  const track = cc.profile?.track_software ?? "inventor";

  const badges: BadgeItem[] = [];
  views.forEach((v, i) => {
    for (const l of v.module.levels) {
      if (progress.badges.has(l.id)) badges.push({ id: l.id, level: l.number, moduleIndex: i, label: `${pick(locale, v.module.title_en, v.module.title_ar)} · ${pick(locale, l.title_en, l.title_ar)}` });
    }
  });

  const tCommon = await getTranslations({ locale, namespace: "CC.training.common" });
  const durations = await Promise.all(views.map((v) => formatDuration(locale, v.progress.minutesLeft)));

  return (
    <div className="container page-stack">
      {header}

      {!hasFullAccess(access) ? (
        <Alert
          tone="info"
          title={t("notEnrolledTitle")}
          action={
            <Button asChild size="sm">
              <Link href={ccPath(locale, "/training/join")}>{tCommon("seePlans")}</Link>
            </Button>
          }
        >
          {t("notEnrolledText")}
        </Alert>
      ) : null}

      {track === "solidworks" ? (
        <Alert tone="warning" title={t("solidworksTitle")}>
          {t("solidworksText")}
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="neu flex flex-col gap-3 p-6" aria-labelledby="cc-continue">
          <div className="flex items-center gap-2">
            <PlayCircle aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 text-accent" />
            <h2 id="cc-continue" className="title-card">
              {t("continueTitle")}
            </h2>
          </div>
          {next ? (
            <>
              <p className="text-base font-bold text-ink">
                {next.started ? t("continueResume", { title: pick(locale, next.title_en, next.title_ar) }) : t("continueStart", { title: pick(locale, next.title_en, next.title_ar) })}
              </p>
              <div className="mt-auto">
                <Button asChild>
                  <Link href={ccPath(locale, `/training/${next.kind === "lesson" ? "lessons" : "exercises"}/${next.slug}`)}>{tCommon(next.kind)}</Link>
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-body">{t("continueNone")}</p>
          )}
        </section>

        <section className="neu flex flex-col gap-3 p-6" aria-labelledby="cc-recommended">
          <div className="flex items-center gap-2">
            <Compass aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 text-accent" />
            <h2 id="cc-recommended" className="title-card">
              {t("recommendedTitle")}
            </h2>
          </div>
          {recommendations.length === 0 ? (
            <>
              <p className="text-sm text-body">{t("recommendedEmpty")}</p>
              <div className="mt-auto">
                <Button asChild variant="secondary">
                  <Link href={ccPath(locale, "/test")}>{t("takeTest")}</Link>
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-body">{t("recommendedText")}</p>
              <ol className="space-y-2">
                {recommendations.map((r, i) => (
                  <li key={`${r.step.skillAreaId}-${i}`} className="tile flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-ink">{tCommon(`areas.${r.step.skillAreaId}` as "areas.1")}</p>
                      <p className="text-xs text-body">
                        <span dir="ltr">{formatNumber(Math.round(r.step.percent), locale)}%</span>
                        {r.levelNumber ? ` · ${t("recommendedLevel", { level: formatNumber(r.levelNumber, locale) })}` : ""}
                      </p>
                    </div>
                    <Button asChild variant="secondary" size="sm">
                      <Link href={ccPath(locale, `/training/${r.module.slug}`)}>{t("recommendedOpen", { module: pick(locale, r.module.title_en, r.module.title_ar) })}</Link>
                    </Button>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      </div>

      <section className="neu space-y-4 p-6 sm:p-8" aria-labelledby="cc-stats">
        <div className="flex items-center gap-2">
          <Sparkles aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 text-accent" />
          <h2 id="cc-stats" className="title-section">
            {t("statsTitle")}
          </h2>
        </div>
        <StatsPanel locale={locale} xp={progress.xp} streak={progress.streak} badges={badges} />
      </section>

      <section className="space-y-4" aria-labelledby="cc-modules">
        <h2 id="cc-modules" className="title-section">
          {t("modulesTitle")}
        </h2>
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {views.map((v, i) => (
            <li key={v.module.id} className="neu flex flex-col gap-3 p-6">
              <div className="flex items-start gap-4">
                <ProgressRing percent={v.progress.percent} label={t("progressLabel", { percent: formatNumber(v.progress.percent, locale) })} />
                <div className="min-w-0 space-y-1">
                  <h3 className="title-card">{pick(locale, v.module.title_en, v.module.title_ar)}</h3>
                  {v.module.competitionModule ? <StatusChip tone="info">{v.module.competitionModule}</StatusChip> : null}
                </div>
              </div>
              {v.module.description_en || v.module.description_ar ? (
                <p className="line-clamp-3 text-sm text-body">{pick(locale, v.module.description_en, v.module.description_ar)}</p>
              ) : null}
              <p className="text-sm font-semibold text-ink">
                {t("levelsDone", { done: formatNumber(v.progress.levelsDone, locale), total: formatNumber(v.progress.levelsTotal, locale) })}
              </p>
              <p className="text-sm text-body">{v.progress.minutesLeft > 0 ? t("timeLeft", { time: durations[i] }) : t("noTimeLeft")}</p>
              <div className="mt-auto">
                <Button asChild variant={i === 0 && v.progress.percent < 100 ? "primary" : "secondary"}>
                  <Link href={ccPath(locale, `/training/${v.module.slug}`)}>{t("open")}</Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="neu space-y-3 p-6" aria-labelledby="cc-certs">
        <div className="flex items-center gap-2">
          <Award aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 text-accent" />
          <h2 id="cc-certs" className="title-card">
            {t("certificatesTitle")}
          </h2>
        </div>
        {progress.certificates.length === 0 ? (
          <p className="text-sm text-body">{t("certificatesEmpty")}</p>
        ) : (
          <ul className="space-y-2">
            {progress.certificates.map((c) => {
              const m = catalog.find((x) => x.id === c.moduleId);
              return (
                <li key={c.code} className="tile flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-ink">{m ? pick(locale, m.title_en, m.title_ar) : c.code}</p>
                    <p className="text-xs text-body">{formatDate(c.issuedAt, locale)}</p>
                  </div>
                  <Button asChild variant="secondary" size="sm">
                    <Link href={ccPath(locale, `/training/certificates/${c.code}`)}>{t("viewCertificate")}</Link>
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="cc-more">
        <h2 id="cc-more" className="title-section">
          {t("moreTitle")}
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Link href={ccPath(locale, "/training/instruments")} className="neu flex items-start gap-3 p-6 hover:shadow-neu focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <Ruler aria-hidden="true" strokeWidth={1.75} className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
            <span>
              <span className="block font-bold text-ink">{t("instrumentsLink")}</span>
              <span className="block text-sm text-body">{t("instrumentsText")}</span>
            </span>
          </Link>
          <Link href={ccPath(locale, "/training/in-person")} className="neu flex items-start gap-3 p-6 hover:shadow-neu focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <MapPin aria-hidden="true" strokeWidth={1.75} className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
            <span>
              <span className="block font-bold text-ink">{t("inPersonLink")}</span>
              <span className="block text-sm text-body">{t("inPersonText")}</span>
            </span>
          </Link>
        </div>
      </section>

      <SignedInExtras pageName={t("title")} />
    </div>
  );
}

