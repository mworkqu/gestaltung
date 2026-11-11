import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipboardList, Eye, FileArchive, Timer } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { SignedInExtras } from "@/components/cad-champions/shell/signed-in-extras";
import { TestLoadProblem } from "@/components/cad-champions/test/server-parts";
import { Button, EmptyState, HelpTip, PageHeader, StatusChip, type ChipTone } from "@/components/cad-champions/ui";
import { requireCcUser } from "@/lib/cad-champions/auth/server";
import { formatNumber } from "@/lib/cad-champions/format";
import { HELP_SLUGS } from "@/lib/cad-champions/get-ready/content";
import { testCardState, type TestCardState } from "@/lib/cad-champions/journey/test-status";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";
import { listTests, loadLatestAttempts } from "@/lib/cad-champions/test/server";

// /test — the tests a student may take (Prompt 5 Step A). RLS decides what is
// listed: students see published tests that are not staff-only; staff also
// see unpublished and staff-only tests (with a Preview link).

type Props = { params: Promise<{ locale: string }> };

const STATE_TONE: Record<TestCardState, ChipTone> = {
  unavailable: "neutral",
  locked: "neutral",
  not_started: "neutral",
  in_progress: "info",
  time_up: "warning",
  grading: "info",
  ready: "success",
  expired: "neutral",
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.test" });
  return ccPageMetadata({ locale, path: "/test", title: t("list.title") });
}

export default async function CcTestListPage({ params }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  const cc = await requireCcUser(locale, ccPath(locale, "/test"));
  const t = await getTranslations({ locale, namespace: "CC.test" });

  const res = await listTests();
  const tests = res.ok ? res.tests : [];
  const latest = await loadLatestAttempts(
    cc.user.id,
    tests.map((x) => x.id)
  );

  return (
    <div className="container space-y-8 py-8 sm:py-12">
      <PageHeader
        title={t("list.title")}
        purpose={t("list.purpose")}
        help={
          <HelpTip label={t("list.helpLabel")} learnMoreSlug={HELP_SLUGS.howTheTestWorks}>
            {t("list.help")}
          </HelpTip>
        }
      />

      {!res.ok ? (
        <TestLoadProblem locale={locale} reason={res.reason === "not_found" ? "error" : res.reason} />
      ) : tests.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={t("list.emptyTitle")}
          description={t("list.emptyBody")}
          action={
            <Button asChild>
              <Link href={ccPath(locale, "/get-ready")}>{t("list.emptyCta")}</Link>
            </Button>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {tests.map((test) => {
            const attempt = latest.get(test.id) ?? null;
            const state = testCardState({ testAvailable: true, attempt, locked: false });
            const title = (locale === "ar" ? test.title_ar : test.title_en) || test.title_en;
            return (
              <li key={test.id} className="neu flex flex-col gap-4 p-6">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip tone="neutral">{t(`list.type.${test.type}`)}</StatusChip>
                  <StatusChip tone={STATE_TONE[state]}>{t(`list.status.${state}`)}</StatusChip>
                  {test.admin_only ? <StatusChip tone="warning">{t("list.staffOnly")}</StatusChip> : null}
                  {!test.is_published ? <StatusChip tone="warning">{t("list.unpublished")}</StatusChip> : null}
                </div>
                <h2 className="text-xl font-extrabold text-heading">{title}</h2>
                <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-body">
                  <span className="inline-flex items-center gap-1.5">
                    <Timer aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 text-accent" />
                    {test.time_limit_minutes ? t("list.minutes", { minutes: formatNumber(test.time_limit_minutes, locale) }) : t("list.untimed")}
                  </span>
                  {test.upload_mode === "module_package" ? (
                    <span className="inline-flex items-center gap-1.5">
                      <FileArchive aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 text-accent" />
                      {t("list.packageMode")}
                    </span>
                  ) : null}
                </p>
                <div className="mt-auto flex flex-wrap gap-3">
                  <Button asChild>
                    <Link href={ccPath(locale, `/test/${test.slug}`)}>
                      {state === "in_progress" || state === "time_up" ? t("list.continue") : t("list.open")}
                    </Link>
                  </Button>
                  {cc.isStaff ? (
                    <Button asChild variant="secondary">
                      <Link href={ccPath(locale, `/admin/tests/${test.slug}/preview`)}>
                        <Eye aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
                        {t("list.preview")}
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <SignedInExtras pageName={t("list.title")} />
    </div>
  );
}
