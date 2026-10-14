import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { SignedInExtras } from "@/components/cad-champions/shell/signed-in-extras";
import { TestIntro } from "@/components/cad-champions/test/intro-sections";
import { TestLoadProblem } from "@/components/cad-champions/test/server-parts";
import { StartPanel, type StartPanelState } from "@/components/cad-champions/test/start-panel";
import { HelpTip, PageHeader } from "@/components/cad-champions/ui";
import { requireCcUser } from "@/lib/cad-champions/auth/server";
import { HELP_SLUGS } from "@/lib/cad-champions/get-ready/content";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";
import { closeIfExpired, loadAttempts, loadLabels, loadTest, readGate } from "@/lib/cad-champions/test/server";
import { introState } from "@/lib/cad-champions/test/status";
import { toTaskViews } from "@/lib/cad-champions/test/view";

// Test intro (Prompt 5 Step A): summary, densities, rules, "Before you
// start", and Start / Continue / cooldown / Get Ready gate.

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.test" });
  return ccPageMetadata({ locale, path: `/test/${slug}`, title: t("intro.metaTitle") });
}

export default async function CcTestIntroPage({ params }: Props) {
  const { locale, slug } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  const cc = await requireCcUser(locale, ccPath(locale, `/test/${slug}`));
  const t = await getTranslations({ locale, namespace: "CC.test" });

  const back = (
    <Link href={ccPath(locale, "/test")} className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent underline-offset-2 hover:underline">
      <ArrowLeft aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 rtl:-scale-x-100" />
      {t("problem.back")}
    </Link>
  );

  const loaded = await loadTest(slug);
  if (!loaded.ok || (!loaded.test.is_published && !cc.isStaff)) {
    return (
      <div className="container space-y-6 py-8 sm:py-12">
        {back}
        <TestLoadProblem locale={locale} reason={loaded.ok ? "not_found" : loaded.reason} />
        <SignedInExtras pageName={t("list.title")} />
      </div>
    );
  }

  const { test } = loaded;
  const labels = await loadLabels();
  const tasks = toTaskViews(loaded.tasks, labels, locale, test.package_expectations);
  const attempts = await Promise.all((await loadAttempts(cc.user.id, test.id)).map((a) => closeIfExpired(a, test)));
  const gate = await readGate(cc);
  const state = introState({
    attempts,
    testType: test.type,
    cooldownDays: test.retake_cooldown_days,
    graceSeconds: test.grace_seconds,
    gate,
    isStaff: cc.isStaff,
    now: Date.now(),
  });

  let panel: StartPanelState;
  switch (state.kind) {
    case "continue":
      panel = { kind: "continue", secondsLeft: state.secondsLeft };
      break;
    case "cooldown":
      panel = { kind: "cooldown", retakeAt: state.retakeAt, days: test.retake_cooldown_days };
      break;
    case "locked":
      panel = { kind: "locked", reason: state.reason, remaining: state.remaining };
      break;
    default:
      panel = { kind: "start", minutes: test.time_limit_minutes };
  }
  const last = state.kind === "start" || state.kind === "cooldown" ? state.last : null;
  const title = (locale === "ar" ? test.title_ar : test.title_en) || test.title_en;

  return (
    <div className="container space-y-6 py-8 sm:py-12">
      {back}
      <PageHeader
        title={title}
        purpose={t("intro.purpose")}
        help={
          <HelpTip label={t("intro.helpLabel")} learnMoreSlug={HELP_SLUGS.howTheTestWorks}>
            {t("intro.help")}
          </HelpTip>
        }
      />
      <div className="max-w-4xl">
        <TestIntro
          locale={locale}
          test={test}
          tasks={tasks}
          action={
            tasks.length > 0 ? (
              <StartPanel slug={test.slug} state={panel} last={last ? { status: last.status, submittedAt: last.submitted_at } : null} />
            ) : null
          }
        />
      </div>
      <SignedInExtras pageName={title} />
    </div>
  );
}
