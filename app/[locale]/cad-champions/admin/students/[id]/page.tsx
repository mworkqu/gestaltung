import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipboardList, Dumbbell, MessageCircleQuestion, Route, ShieldCheck, Wallet } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { FlagResolveButton } from "@/components/cad-champions/admin/students/flag-resolve-button";
import { NotesPanel } from "@/components/cad-champions/admin/students/notes-panel";
import { StudentActionsPanel } from "@/components/cad-champions/admin/students/student-actions-panel";
import { Alert, EmptyState, HelpTip, PageHeader, StatusChip, type ChipTone } from "@/components/cad-champions/ui";
import { adminDb } from "@/lib/cad-champions/admin/server";
import { activeEnrollmentEnd, buildJourneyTimeline, isUuid } from "@/lib/cad-champions/admin/student-detail";
import { loadStudentDetail } from "@/lib/cad-champions/admin/student-detail-server";
import { requireCcStaff } from "@/lib/cad-champions/auth/server";
import { formatDate, formatDateTime, formatNumber, formatQAR } from "@/lib/cad-champions/format";
import { Ltr } from "@/lib/cad-champions/ltr";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";
import { pick } from "@/lib/cad-champions/training/server";

// One student (Prompt 11 Step D). Staff read everything and add private
// notes; admins also get the actions (unlock level, bypass Get Ready, extend
// enrollment, resend verification, in-person start) and "Mark resolved" on
// integrity flags.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, id } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.admin.students" });
  return ccPageMetadata({ locale, path: `/admin/students/${id}`, title: t("detail.metaTitle") });
}

const ATTEMPT_TONE: Record<string, ChipTone> = {
  in_progress: "info",
  submitted: "neutral",
  grading: "neutral",
  provisional: "warning",
  graded: "success",
  expired: "danger",
};

function Section({ id, title, icon: Icon, children, help }: { id: string; title: string; icon?: typeof Route; children: React.ReactNode; help?: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="neu space-y-4 p-5 sm:p-6">
      <div className="flex items-center gap-2">
        {Icon ? <Icon aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 text-accent" /> : null}
        <h2 id={id} className="title-card">
          {title}
        </h2>
        {help}
      </div>
      {children}
    </section>
  );
}

export default async function CcAdminStudentPage({ params }: Props) {
  const { locale, id } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  const cc = await requireCcStaff(locale, ccPath(locale, `/admin/students/${id}`));
  if (!isUuid(id)) notFound();
  const t = await getTranslations({ locale, namespace: "CC.admin.students" });
  const tc = await getTranslations({ locale, namespace: "CC.admin.common" });
  const tPay = await getTranslations({ locale, namespace: "CC.payments.status" });

  const db = adminDb();
  const loaded = db ? await loadStudentDetail(db, id) : ({ ok: false, reason: "error" } as const);
  if (!loaded.ok && loaded.reason === "not_found") notFound();
  if (!loaded.ok) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("detail.metaTitle")} purpose={t("detail.purpose")} />
        <Alert tone={loaded.reason === "not_set_up" ? "info" : "error"} title={loaded.reason === "not_set_up" ? tc("notSetUp.title") : t("loadError.title")}>
          {loaded.reason === "not_set_up" ? tc("notSetUp.body") : t("loadError.body")}
        </Alert>
      </div>
    );
  }
  const d = loaded.detail;
  const p = d.profile;
  const now = Date.now();
  const name = (locale === "ar" ? p.full_name_ar || p.full_name : p.full_name || p.full_name_ar) || p.email || t("noName");
  const timeline = buildJourneyTimeline({ createdAt: p.created_at, journey: d.journey, steps: d.steps });
  const enrolledUntil = activeEnrollmentEnd(d.enrollments, now);
  const pct = (v: number | null) => (v == null ? "-" : `${formatNumber(Math.round(v), locale)}%`);
  const yesNo = (v: boolean) => (v ? tc("yes") : tc("no"));
  const dash = <span className="text-mutedtext">-</span>;
  const linkCls = "font-semibold text-accent underline-offset-2 hover:underline";

  const rows: { label: string; value: React.ReactNode }[] = [
    { label: t("profile.nameEn"), value: p.full_name || dash },
    { label: t("profile.nameAr"), value: p.full_name_ar ? <span dir="rtl">{p.full_name_ar}</span> : dash },
    { label: t("profile.email"), value: p.email ? <Ltr>{p.email}</Ltr> : dash },
    { label: t("profile.phone"), value: p.phone ? <Ltr>{p.phone}</Ltr> : dash },
    { label: t("profile.institution"), value: p.institution || p.institution_other || dash },
    { label: t("profile.studyLevel"), value: p.study_level ? t(`studyLevels.${p.study_level}`) : dash },
    { label: t("profile.dob"), value: p.date_of_birth ? formatDate(p.date_of_birth, locale) : dash },
    { label: t("profile.minor"), value: p.is_minor ? <StatusChip tone="warning">{t("minor")}</StatusChip> : tc("no") },
    ...(p.is_minor || p.guardian_name || p.guardian_consent
      ? [
          { label: t("profile.guardianName"), value: p.guardian_name || dash },
          { label: t("profile.guardianPhone"), value: p.guardian_phone ? <Ltr>{p.guardian_phone}</Ltr> : dash },
          {
            label: t("profile.guardianConsent"),
            value: p.guardian_consent ? (
              <StatusChip tone="success">{p.guardian_consent_at ? t("profile.consentAt", { date: formatDateTime(p.guardian_consent_at, locale) }) : tc("yes")}</StatusChip>
            ) : (
              <StatusChip tone={p.is_minor ? "danger" : "neutral"}>{tc("no")}</StatusChip>
            ),
          },
        ]
      : []),
    { label: t("profile.track"), value: p.track_software ? t(`software.${p.track_software}`) : dash },
    { label: t("profile.cadUsed"), value: p.cad_software_used ? t(`software.${p.cad_software_used}`) : dash },
    { label: t("profile.experience"), value: p.cad_experience ? t(`experience.${p.cad_experience}`) : dash },
    { label: t("profile.computer"), value: p.has_windows_pc ? t(`computer.${p.has_windows_pc}`) : dash },
    { label: t("profile.locale"), value: p.preferred_locale === "ar" ? tc("arabic") : tc("english") },
    { label: t("profile.marketing"), value: yesNo(!!p.marketing_consent) },
    { label: t("profile.weekly"), value: yesNo(!!p.weekly_progress_email) },
    { label: t("profile.role"), value: t(`roles.${p.role}`) },
    { label: t("profile.getReadyBypass"), value: yesNo(!!p.get_ready_bypass) },
    { label: t("profile.enrollment"), value: enrolledUntil ? t("enrolledUntil", { date: formatDate(enrolledUntil, locale) }) : t("notEnrolled") },
    {
      label: t("profile.verification"),
      value: t(`verification.${d.verification}`),
    },
    { label: t("profile.created"), value: formatDateTime(p.created_at, locale) },
    { label: t("profile.lastActive"), value: p.last_active_at ? formatDateTime(p.last_active_at, locale) : t("never") },
    ...(p.deletion_requested_at ? [{ label: t("profile.deletion"), value: <StatusChip tone="warning">{formatDateTime(p.deletion_requested_at, locale)}</StatusChip> }] : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={name} purpose={t("detail.purpose")} help={<HelpTip label={t("helpLabel")}>{t("detail.help")}</HelpTip>} />

      <Section id="s-profile" title={t("detail.profile")}>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => (
            <div key={r.label} className="min-w-0">
              <dt className="text-xs font-semibold text-mutedtext">{r.label}</dt>
              <dd className="break-words text-sm text-body">{r.value}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section id="s-journey" title={t("detail.journey")} icon={Route}>
        {timeline.length === 0 ? (
          <EmptyState icon={Route} title={t("journey.emptyTitle")} description={t("journey.emptyBody")} />
        ) : (
          <ol className="space-y-2 border-s-2 border-border ps-4">
            {timeline.map((e, i) => (
              <li key={`${e.kind}-${i}`} className="text-sm">
                <span className="font-semibold text-ink">
                  {e.kind === "signed_up" ? t("journey.signed_up") : e.kind === "journey" ? t(`journey.${e.key}`) : t("journey.step", { step: t(`steps.${e.step}`) })}
                </span>
                <span className="ms-2 text-mutedtext">{formatDateTime(e.at, locale)}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section id="s-attempts" title={t("detail.attempts")} icon={ClipboardList}>
        {d.attempts.length === 0 ? (
          <EmptyState icon={ClipboardList} title={t("attempts.emptyTitle")} description={t("attempts.emptyBody")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] border-collapse text-sm">
              <thead className="border-b border-border text-xs text-mutedtext">
                <tr>
                  <th scope="col" className="px-3 py-2 text-start font-semibold">{t("attempts.test")}</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold">{t("attempts.started")}</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold">{t("attempts.status")}</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold">{t("attempts.percent")}</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold">{t("attempts.band")}</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold">{t("attempts.result")}</th>
                </tr>
              </thead>
              <tbody>
                {d.attempts.map((a) => (
                  <tr key={a.id} className="border-b border-border/60 align-top last:border-0">
                    <td className="px-3 py-2 text-body">
                      {pick(locale, a.testTitleEn ?? "-", a.testTitleAr ?? a.testTitleEn ?? "-")}
                      {a.inPerson ? (
                        <span className="ms-2">
                          <StatusChip tone="info">{t("attempts.inPerson")}</StatusChip>
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-body">{formatDateTime(a.startedAt, locale)}</td>
                    <td className="px-3 py-2">
                      <StatusChip tone={ATTEMPT_TONE[a.status] ?? "neutral"}>{t(`attemptStatus.${a.status}`)}</StatusChip>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-body">{pct(a.percent)}</td>
                    <td className="px-3 py-2 text-body">{a.band ? t(`bands.${a.band}`) : "-"}</td>
                    <td className="px-3 py-2">
                      {a.status === "in_progress" ? (
                        <span className="text-mutedtext">-</span>
                      ) : (
                        <Link href={ccPath(locale, `/results/${a.id}`)} className={`${linkCls} inline-flex min-h-11 items-center`}>
                          {t("attempts.viewResult")}
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section id="s-exercises" title={t("detail.exercises")} icon={Dumbbell}>
        {d.exercises.length === 0 ? (
          <EmptyState icon={Dumbbell} title={t("exercises.emptyTitle")} description={t("exercises.emptyBody")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <thead className="border-b border-border text-xs text-mutedtext">
                <tr>
                  <th scope="col" className="px-3 py-2 text-start font-semibold">{t("exercises.exercise")}</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold">{t("exercises.tries")}</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold">{t("exercises.best")}</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold">{t("exercises.passed")}</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold">{t("exercises.last")}</th>
                </tr>
              </thead>
              <tbody>
                {d.exercises.map((e) => (
                  <tr key={e.exerciseId} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-2 text-body">{pick(locale, e.titleEn ?? "-", e.titleAr ?? e.titleEn ?? "-")}</td>
                    <td className="px-3 py-2 tabular-nums text-body">{formatNumber(e.attempts, locale)}</td>
                    <td className="px-3 py-2 tabular-nums text-body">{pct(e.bestPercent)}</td>
                    <td className="px-3 py-2">{e.passed ? <StatusChip tone="success">{tc("yes")}</StatusChip> : <span className="text-mutedtext">{tc("no")}</span>}</td>
                    <td className="px-3 py-2 text-body">
                      {formatDate(e.lastAt, locale)} · {t(`resultStatus.${e.lastStatus}`)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section id="s-payments" title={t("detail.payments")} icon={Wallet}>
        {d.payments.length === 0 && d.enrollments.length === 0 ? (
          <EmptyState icon={Wallet} title={t("payments.emptyTitle")} description={t("payments.emptyBody")} />
        ) : (
          <div className="space-y-4">
            {d.payments.length > 0 ? (
              <ul className="space-y-2">
                {d.payments.map((pay) => (
                  <li key={pay.id} className="tile flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <span className="font-semibold text-ink">{pick(locale, pay.planEn ?? "-", pay.planAr ?? pay.planEn ?? "-")}</span>
                    <span className="tabular-nums text-body">{formatQAR(pay.amount_qar, locale)}</span>
                    <Ltr className="text-mutedtext">{pay.reference_code}</Ltr>
                    <StatusChip tone={pay.status === "paid" ? "success" : pay.status === "proof_submitted" ? "warning" : "neutral"}>{tPay(pay.status)}</StatusChip>
                    <span className="text-mutedtext">{formatDate(pay.created_at, locale)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {d.enrollments.length > 0 ? (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-ink">{t("payments.enrollments")}</h3>
                <ul className="space-y-1 text-sm text-body">
                  {d.enrollments.map((e) => (
                    <li key={e.id}>
                      {formatDate(e.starts_at, locale)} – {formatDate(e.ends_at, locale)} · {t(`enrollmentSource.${e.source}`)} · {t(`enrollmentStatus.${e.status}`)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {cc.isAdmin ? (
              <Link href={ccPath(locale, "/admin/payments")} className={`${linkCls} inline-flex min-h-11 items-center`}>
                {t("payments.open")}
              </Link>
            ) : null}
          </div>
        )}
      </Section>

      <Section id="s-questions" title={t("detail.questions")} icon={MessageCircleQuestion}>
        {d.questions.length === 0 ? (
          <EmptyState icon={MessageCircleQuestion} title={t("questions.emptyTitle")} description={t("questions.emptyBody")} />
        ) : (
          <ul className="space-y-2">
            {d.questions.map((q) => (
              <li key={q.id} className="tile space-y-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip tone={q.status === "open" ? "warning" : "success"}>{t(`questions.status.${q.status}`)}</StatusChip>
                  <span className="text-xs text-mutedtext">
                    {t(`questions.kind.${q.kind}`)} · {formatDateTime(q.created_at, locale)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-body">{q.body}</p>
                {q.answer ? <p className="whitespace-pre-wrap border-s-2 border-accent ps-3 text-mutedtext">{q.answer}</p> : null}
              </li>
            ))}
            <li>
              <Link href={ccPath(locale, "/admin/questions")} className={`${linkCls} inline-flex min-h-11 items-center`}>
                {t("questions.open")}
              </Link>
            </li>
          </ul>
        )}
      </Section>

      <Section id="s-flags" title={t("detail.flags")} icon={ShieldCheck} help={<HelpTip label={t("flags.helpLabel")}>{t("flags.help")}</HelpTip>}>
        {d.flags.length === 0 ? (
          <EmptyState icon={ShieldCheck} title={t("flags.emptyTitle")} description={t("flags.emptyBody")} />
        ) : (
          <ul className="space-y-2">
            {d.flags.map((f) => (
              <li key={f.id} className="tile flex flex-wrap items-center justify-between gap-3 text-sm">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip tone={f.resolved_at ? "neutral" : "danger"}>{t(`flags.kind.${f.kind}`)}</StatusChip>
                    <span className="text-xs text-mutedtext">{formatDateTime(f.created_at, locale)}</span>
                  </div>
                  <p className="text-xs text-mutedtext">
                    {f.resolved_at ? t("flags.resolvedOn", { date: formatDateTime(f.resolved_at, locale) }) : t("flags.open")}
                    {" · "}
                    <Link href={ccPath(locale, `/results/${f.attempt_id}`)} className={linkCls}>
                      {t("flags.attempt")}
                    </Link>
                  </p>
                </div>
                {!f.resolved_at && cc.isAdmin ? <FlagResolveButton studentId={p.id} flagId={f.id} /> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="s-notes" title={t("detail.notes")}>
        <NotesPanel locale={locale} studentId={p.id} initial={d.notes} />
      </Section>

      {cc.isAdmin ? (
        <Section id="s-actions" title={t("detail.actions")} help={<HelpTip label={t("actions.helpLabel")}>{t("actions.help")}</HelpTip>}>
          <StudentActionsPanel
            locale={locale}
            studentId={p.id}
            levels={d.levels.map((l) => ({ id: l.id, label: locale === "ar" ? l.label.ar : l.label.en, unlocked: l.unlocked }))}
            bypass={!!p.get_ready_bypass}
            enrollments={d.enrollments}
            verification={d.verification}
            tests={d.inPersonTests.map((x) => ({ id: x.id, title: pick(locale, x.title_en, x.title_ar) }))}
          />
        </Section>
      ) : null}
    </div>
  );
}
