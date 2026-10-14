import { Download, FolderTree, Gavel, ListChecks, Scale, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { ArticleBody } from "@/components/cad-champions/help/article-body";
import { Card, EmptyState, HelpTip, StatusChip } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import type { CcTest } from "@/lib/cad-champions/db/types";
import { formatNumber } from "@/lib/cad-champions/format";
import { ESSENTIAL_ACTIONS, HELP_SLUGS } from "@/lib/cad-champions/get-ready/content";
import { ESSENTIAL_ACTION_KEYS } from "@/lib/cad-champions/get-ready/steps";
import { Ltr } from "@/lib/cad-champions/ltr";
import { ccPath } from "@/lib/cad-champions/routes";
import { densitiesOf, type TaskView } from "@/lib/cad-champions/test/view";
import { RESULTS_FOLDERS, TEMPLATE_ZIP_NAME } from "@/lib/cad-champions/upload/package-check";

import { ModuleChip } from "./module-chip";

// Test intro (Prompt 5 Step A): summary table, densities, rules, "Before you
// start" recap and, for module_package tests, the Results folder layout with
// the template ZIP. Server component; shared by /test/[slug] and the admin
// preview. The Start / Continue panel is passed in as `action`.

const DEFAULT_RULES = ["alone", "software", "units", "density", "oneFile", "replace", "timer", "autoSubmit", "grace", "retake"] as const;
const CONDUCT_RULES = ["internet", "phone", "devices", "usb", "help"] as const;

export async function TestIntro({
  locale,
  test,
  tasks,
  action,
}: {
  locale: Locale;
  test: CcTest;
  tasks: TaskView[];
  action?: React.ReactNode;
}) {
  const t = await getTranslations({ locale, namespace: "CC.test" });
  const tg = await getTranslations({ locale, namespace: "CC.get-ready" });
  const isPackage = test.upload_mode === "module_package";
  const timed = test.time_limit_minutes != null;
  const totalPoints = tasks.reduce((s, x) => s + x.points, 0);
  const densities = densitiesOf(tasks);
  const intro = ((locale === "ar" ? test.intro_ar : test.intro_en) || test.intro_en || "").trim();
  const customRules = ((locale === "ar" ? test.rules_ar : test.rules_en) || test.rules_en || "").trim();
  const competitionRules = test.type === "mock" || test.type === "qualifier";

  const rules = DEFAULT_RULES.filter((r) => {
    if (!timed && (r === "timer" || r === "autoSubmit" || r === "grace")) return false;
    if (r === "retake" && !(test.retake_cooldown_days > 0)) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {intro ? (
        <Card className="p-6 sm:p-8">
          <ArticleBody markdown={intro} locale={locale} hasVideoId={false} />
        </Card>
      ) : null}

      {/* Summary */}
      <section aria-labelledby="cc-test-summary" className="neu space-y-5 p-6 sm:p-8">
        <div className="flex items-center gap-2">
          <ListChecks aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 text-accent" />
          <h2 id="cc-test-summary" className="text-xl font-extrabold text-heading">
            {t("intro.summaryTitle")}
          </h2>
        </div>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="tile">
            <dt className="text-xs font-semibold text-body">{t("intro.totalTime")}</dt>
            <dd className="mt-1 text-lg font-extrabold text-heading">
              {timed ? t("intro.timeValue", { minutes: formatNumber(test.time_limit_minutes ?? 0, locale) }) : t("intro.untimed")}
            </dd>
          </div>
          <div className="tile">
            <dt className="text-xs font-semibold text-body">{t("intro.taskCount")}</dt>
            <dd className="mt-1 text-lg font-extrabold text-heading">{formatNumber(tasks.length, locale)}</dd>
          </div>
          <div className="tile">
            <dt className="text-xs font-semibold text-body">{t("intro.totalPoints")}</dt>
            <dd className="mt-1 text-lg font-extrabold text-heading">{formatNumber(totalPoints, locale)}</dd>
          </div>
        </dl>

        {tasks.length === 0 ? (
          <EmptyState icon={ListChecks} title={t("intro.noTasksTitle")} description={t("intro.noTasksBody")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-start text-sm text-body">
              <thead>
                <tr>
                  <th scope="col" className="border-b border-borderstrong/60 px-3 py-2 text-start font-semibold text-heading">{t("intro.table.task")}</th>
                  <th scope="col" className="border-b border-borderstrong/60 px-3 py-2 text-start font-semibold text-heading">{t("intro.table.skill")}</th>
                  <th scope="col" className="border-b border-borderstrong/60 px-3 py-2 text-start font-semibold text-heading">
                    <span className="inline-flex items-center gap-1">
                      {t("intro.table.module")}
                      <HelpTip label={t("intro.moduleHelpLabel")} learnMoreSlug={HELP_SLUGS.realCompetition}>
                        {t("intro.moduleHelp")}
                      </HelpTip>
                    </span>
                  </th>
                  <th scope="col" className="border-b border-borderstrong/60 px-3 py-2 text-start font-semibold text-heading">{t("intro.table.fileType")}</th>
                  <th scope="col" className="border-b border-borderstrong/60 px-3 py-2 text-end font-semibold text-heading">{t("intro.table.points")}</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id}>
                    <td className="border-b border-borderstrong/30 px-3 py-2 align-top">
                      <span className="block text-xs text-mutedtext">{t("workspace.taskN", { n: String(task.number) })}</span>
                      <span className="font-semibold text-ink">{task.title}</span>
                    </td>
                    <td className="border-b border-borderstrong/30 px-3 py-2 align-top">{task.skillName ?? t("intro.skillFallback", { id: String(task.skillAreaId) })}</td>
                    <td className="border-b border-borderstrong/30 px-3 py-2 align-top">
                      {task.moduleCode ? <ModuleChip code={task.moduleCode} name={task.moduleName} /> : <span className="text-mutedtext">{t("intro.noModule")}</span>}
                    </td>
                    <td className="border-b border-borderstrong/30 px-3 py-2 align-top">
                      {isPackage ? t("intro.inZip") : t(`fileTypes.${task.expectedUpload}`)}
                    </td>
                    <td className="border-b border-borderstrong/30 px-3 py-2 text-end align-top font-semibold text-ink">{formatNumber(task.points, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Densities */}
      <section aria-labelledby="cc-test-densities" className="neu space-y-4 p-6 sm:p-8">
        <div className="flex items-center gap-2">
          <Scale aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 text-accent" />
          <h2 id="cc-test-densities" className="text-xl font-extrabold text-heading">
            {t("intro.densitiesTitle")}
          </h2>
          <HelpTip label={t("intro.densityHelpLabel")} learnMoreSlug={HELP_SLUGS.materialDensity}>
            {t("intro.densityHelp")}
          </HelpTip>
        </div>
        {densities.length === 0 ? (
          <p className="text-sm text-body">{t("intro.noDensities")}</p>
        ) : (
          <ul className="flex flex-wrap gap-3">
            {densities.map((d) => (
              <li key={`${d.material}-${d.density}`} className="tile text-sm font-semibold text-ink">
                {d.material} · <Ltr>{formatNumber(d.density, locale)} kg/m³</Ltr>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Module package layout */}
      {isPackage ? (
        <section aria-labelledby="cc-test-package" className="neu space-y-4 p-6 sm:p-8">
          <div className="flex items-center gap-2">
            <FolderTree aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 text-accent" />
            <h2 id="cc-test-package" className="text-xl font-extrabold text-heading">
              {t("intro.package.title")}
            </h2>
            <HelpTip label={t("intro.package.helpLabel")} learnMoreSlug={HELP_SLUGS.resultsFolder}>
              {t("intro.package.help")}
            </HelpTip>
          </div>
          <p className="max-w-2xl text-sm text-body">{t("intro.package.intro")}</p>
          <div className="neu-inset overflow-x-auto p-4">
            <pre dir="ltr" className="text-start font-mono text-xs leading-relaxed text-ink">
              {[
                "<CODE>/",
                "  DAY 01/",
                "    Results/",
                ...RESULTS_FOLDERS.map((f) => `      ${f.name}/   ${f.ext.join(" ")}`),
                "    Workspace/",
              ].join("\n")}
            </pre>
          </div>
          <ol className="list-decimal space-y-1 ps-5 text-sm text-body">
            <li>{t("intro.package.s1")}</li>
            <li>{t("intro.package.s2")}</li>
            <li>{t("intro.package.s3")}</li>
            <li>{t("intro.package.s4")}</li>
          </ol>
          <p className="text-sm text-body">{t("intro.package.limits")}</p>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href="/api/cad-champions/results-template"
              download={TEMPLATE_ZIP_NAME}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-accent-foreground shadow-neu-sm hover:bg-cobalt-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              <Download aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
              {t("intro.package.download")}
            </a>
            <span className="text-xs text-body">
              <Ltr>{TEMPLATE_ZIP_NAME}</Ltr>
            </span>
          </div>
        </section>
      ) : null}

      {/* Rules */}
      <section aria-labelledby="cc-test-rules" className="neu space-y-4 p-6 sm:p-8">
        <div className="flex items-center gap-2">
          <Gavel aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 text-accent" />
          <h2 id="cc-test-rules" className="text-xl font-extrabold text-heading">
            {t("intro.rulesTitle")}
          </h2>
        </div>
        {customRules ? (
          <ArticleBody markdown={customRules} locale={locale} hasVideoId={false} />
        ) : (
          <ul className="list-disc space-y-1.5 ps-5 text-sm text-body">
            {rules.map((r) => (
              <li key={r}>
                {r === "oneFile" && isPackage
                  ? t("rules.oneZip")
                  : t(`rules.${r}`, {
                      minutes: formatNumber(test.time_limit_minutes ?? 0, locale),
                      seconds: formatNumber(test.grace_seconds, locale),
                      days: formatNumber(test.retake_cooldown_days, locale),
                    })}
              </li>
            ))}
          </ul>
        )}
        {competitionRules ? (
          <div className="tile space-y-2">
            <p className="flex items-center gap-2 text-sm font-bold text-ink">
              <ShieldCheck aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 text-accent" />
              {t("rules.conductTitle")}
            </p>
            <ul className="list-disc space-y-1 ps-5 text-sm text-body">
              {CONDUCT_RULES.map((r) => (
                <li key={r}>{t(`rules.conduct.${r}`)}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {/* Before you start */}
      <section aria-labelledby="cc-test-before" className="neu space-y-4 p-6 sm:p-8">
        <h2 id="cc-test-before" className="text-xl font-extrabold text-heading">
          {t("intro.beforeTitle")}
        </h2>
        <p className="max-w-2xl text-sm text-body">{t("intro.beforeIntro")}</p>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {ESSENTIAL_ACTION_KEYS.map((k) => (
            <li key={k} className="tile flex items-start justify-between gap-3">
              <span className="text-sm font-semibold text-ink">{tg(`actions.items.${k}.title`)}</span>
              <HelpTip label={tg(`actions.items.${k}.title`)} learnMoreSlug={ESSENTIAL_ACTIONS[k].helpSlug}>
                {tg(`actions.items.${k}.why`)}
              </HelpTip>
            </li>
          ))}
        </ul>
        <Link href={ccPath(locale, "/get-ready")} className="inline-block text-sm font-semibold text-accent underline-offset-2 hover:underline">
          {t("intro.beforeLink")}
        </Link>
      </section>

      {action ? <div id="cc-test-start">{action}</div> : null}

      {test.admin_only || !test.is_published ? (
        <StatusChip tone="warning">{test.admin_only ? t("list.staffOnly") : t("list.unpublished")}</StatusChip>
      ) : null}
    </div>
  );
}
