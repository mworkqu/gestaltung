import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarClock, School } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { InPersonStarter, type StarterStudent } from "@/components/cad-champions/admin/students/in-person-starter";
import { PartCollectedButton } from "@/components/cad-champions/admin/students/part-collected-button";
import { Alert, EmptyState, HelpTip, PageHeader, StatusChip } from "@/components/cad-champions/ui";
import { listInPersonTests, loadInPersonSessions } from "@/lib/cad-champions/admin/in-person";
import { adminDb } from "@/lib/cad-champions/admin/server";
import { loadStudentRows } from "@/lib/cad-champions/admin/students-server";
import { requireCcAdmin } from "@/lib/cad-champions/auth/server";
import { formatDateTime, formatNumber } from "@/lib/cad-champions/format";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";
import { pick } from "@/lib/cad-champions/training/server";

// In-person session (COMPETITION_ALIGNMENT G, Prompt 11 Task 11). Admin
// only. Pick a module_package test (published or admin-only), tick the
// students in the room and start everyone's timer at once (one shared
// session id). Below: the sessions of the last 7 days with each attempt's
// status and, for M4 tests, the "Physical part collected" marker.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ test?: string | string[] }> };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.admin.students" });
  return ccPageMetadata({ locale, path: "/admin/students/in-person", title: t("inPerson.title") });
}

const selectCls = "min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export default async function CcAdminInPersonPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  await requireCcAdmin(locale, ccPath(locale, "/admin/students/in-person"));
  const t = await getTranslations({ locale, namespace: "CC.admin.students" });
  const tc = await getTranslations({ locale, namespace: "CC.admin.common" });
  const sp = await searchParams;
  const slug = (Array.isArray(sp.test) ? sp.test[0] : sp.test) ?? "";

  const db = adminDb();
  const tests = db ? await listInPersonTests(db) : ({ ok: false, reason: "error" } as const);
  const list = tests.ok ? tests.tests : [];
  const test = list.find((x) => x.slug === slug) ?? null;

  let students: StarterStudent[] = [];
  let names = new Map<string, string>();
  let sessions: Awaited<ReturnType<typeof loadInPersonSessions>> = [];
  if (db && test) {
    const [rows, s] = await Promise.all([loadStudentRows(db), loadInPersonSessions(db, test.id)]);
    sessions = s;
    if (rows.ok) {
      students = rows.rows
        .map((r) => ({
          id: r.id,
          name: (locale === "ar" ? r.nameAr || r.name : r.name || r.nameAr) || r.email || t("noName"),
          email: r.email,
          institution: r.institution,
          getReadyPercent: r.getReadyPercent,
          getReadyBypass: r.getReadyBypass,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      names = new Map(students.map((x) => [x.id, x.name]));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("inPerson.title")}
        purpose={t("inPerson.purpose")}
        help={
          <HelpTip label={t("inPerson.helpLabel")}>
            {t("inPerson.help")}
          </HelpTip>
        }
      />

      {!tests.ok ? (
        <Alert tone={tests.reason === "not_set_up" ? "info" : "error"} title={tests.reason === "not_set_up" ? tc("notSetUp.title") : t("loadError.title")}>
          {tests.reason === "not_set_up" ? tc("notSetUp.body") : t("loadError.body")}
        </Alert>
      ) : list.length === 0 ? (
        <EmptyState icon={School} title={t("inPerson.noTestsTitle")} description={t("inPerson.noTests")} />
      ) : (
        <form method="get" action={ccPath(locale, "/admin/students/in-person")} className="neu flex flex-col gap-3 p-5 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1 text-sm font-semibold text-ink">
            <span>{t("inPerson.test")}</span>
            <span className="text-xs font-normal text-mutedtext">{t("inPerson.testHint")}</span>
            <select name="test" defaultValue={test?.slug ?? ""} className={selectCls}>
              <option value="">{t("inPerson.chooseTest")}</option>
              {list.map((x) => (
                <option key={x.id} value={x.slug}>
                  {pick(locale, x.title_en, x.title_ar)}
                  {x.is_published ? "" : ` (${t("inPerson.adminOnly")})`}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-5 text-sm font-semibold text-accent-foreground shadow-neu-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            {tc("open")}
          </button>
        </form>
      )}

      {test ? (
        <>
          {test.taskCount === 0 ? <Alert tone="warning" title={t("inPerson.noTasks")} /> : null}
          {test.hasM4 ? (
            <Alert tone="info" title={t("inPerson.m4Title")}>
              {t("inPerson.m4Body")}
            </Alert>
          ) : null}

          <section className="neu space-y-4 p-5 sm:p-6" aria-labelledby="ip-pick">
            <h2 id="ip-pick" className="title-card">
              {t("inPerson.pickTitle")}
            </h2>
            <p className="text-sm text-body">{t("inPerson.pickText")}</p>
            <InPersonStarter
              locale={locale}
              testId={test.id}
              testTitle={pick(locale, test.title_en, test.title_ar)}
              minutes={test.time_limit_minutes}
              students={students}
            />
          </section>

          <section className="neu space-y-4 p-5 sm:p-6" aria-labelledby="ip-sessions">
            <h2 id="ip-sessions" className="title-card">
              {t("inPerson.sessionsTitle")}
            </h2>
            {sessions.length === 0 ? (
              <EmptyState icon={CalendarClock} title={t("inPerson.noSessionsTitle")} description={t("inPerson.noSessionsBody")} />
            ) : (
              <ul className="space-y-4">
                {sessions.map((s) => {
                  const pending = s.attempts.filter((a) => a.status === "in_progress" && !a.partCollectedAt).map((a) => a.id);
                  return (
                    <li key={s.sessionId} className="tile space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-ink">
                          {t("inPerson.sessionStarted", { date: formatDateTime(s.startedAt, locale), count: formatNumber(s.attempts.length, locale) })}
                        </p>
                        {test.hasM4 ? <PartCollectedButton locale={locale} attemptIds={pending} /> : null}
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[36rem] border-collapse text-sm">
                          <thead className="border-b border-border text-xs text-mutedtext">
                            <tr>
                              <th scope="col" className="px-3 py-2 text-start font-semibold">{t("cols.name")}</th>
                              <th scope="col" className="px-3 py-2 text-start font-semibold">{t("attempts.status")}</th>
                              <th scope="col" className="px-3 py-2 text-start font-semibold">{t("inPerson.deadline")}</th>
                              {test.hasM4 ? <th scope="col" className="px-3 py-2 text-start font-semibold">{t("inPerson.partCollected")}</th> : null}
                            </tr>
                          </thead>
                          <tbody>
                            {s.attempts.map((a) => (
                              <tr key={a.id} className="border-b border-border/60 last:border-0">
                                <td className="px-3 py-2 text-body">{names.get(a.userId) ?? t("noName")}</td>
                                <td className="px-3 py-2">
                                  <StatusChip tone={a.status === "in_progress" ? "info" : "neutral"}>{t(`attemptStatus.${a.status}`)}</StatusChip>
                                </td>
                                <td className="px-3 py-2 text-body">{a.deadlineAt ? formatDateTime(a.deadlineAt, locale) : t("inPerson.untimed")}</td>
                                {test.hasM4 ? (
                                  <td className="px-3 py-2 text-body">{a.partCollectedAt ? formatDateTime(a.partCollectedAt, locale) : <span className="text-mutedtext">{t("inPerson.notYet")}</span>}</td>
                                ) : null}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
