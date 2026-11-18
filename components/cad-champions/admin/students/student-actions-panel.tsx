"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import {
  extendEnrollmentAction,
  resendVerificationAction,
  setGetReadyBypassAction,
  startInPersonAction,
  unlockLevelAction,
} from "@/app/[locale]/cad-champions/admin/students/actions";
import { Field, inputCls } from "@/components/cad-champions/admin/fields";
import { Button, ConfirmDialog, useToast } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { EXTEND_DAYS_MAX, EXTEND_DAYS_MIN, parseExtendDays, planEnrollmentExtension, type EnrollmentLite } from "@/lib/cad-champions/admin/student-detail";
import { formatDate } from "@/lib/cad-champions/format";

// Admin actions on one student (Prompt 11 Step D): unlock a level, bypass
// Get Ready, extend enrollment, resend the verification email, start an
// in-person session. Each irreversible step asks first (ConfirmDialog); the
// server action re-checks the admin role and writes the audit log.

type Level = { id: string; label: string; unlocked: boolean };
type TestOption = { id: string; title: string };
type Pending = null | "unlock" | "bypass" | "extend" | "inPerson";

const box = "tile space-y-3";
const selectCls = inputCls;

export function StudentActionsPanel({
  locale,
  studentId,
  levels,
  bypass,
  enrollments,
  verification,
  tests,
}: {
  locale: Locale;
  studentId: string;
  levels: Level[];
  bypass: boolean;
  enrollments: EnrollmentLite[];
  verification: "unconfirmed" | "confirmed" | "no_email" | "unknown";
  tests: TestOption[];
}) {
  const t = useTranslations("CC.admin.students");
  const tc = useTranslations("CC.admin.common");
  const toast = useToast();
  const router = useRouter();
  const [pending, setPending] = React.useState<Pending>(null);
  const [levelId, setLevelId] = React.useState(levels.find((l) => !l.unlocked)?.id ?? "");
  const [days, setDays] = React.useState("30");
  const [testId, setTestId] = React.useState(tests[0]?.id ?? "");
  const [sending, setSending] = React.useState(false);
  const [verifyState, setVerifyState] = React.useState(verification);

  const fail = (title: string, code: string) => toast.error(title, tc(`errors.${code}`));
  const level = levels.find((l) => l.id === levelId) ?? null;
  const n = parseExtendDays(days);
  const plan = n == null ? null : planEnrollmentExtension(enrollments, n, Date.now());
  const test = tests.find((x) => x.id === testId) ?? null;

  async function run(kind: Exclude<Pending, null>) {
    try {
      if (kind === "unlock") {
        const res = await unlockLevelAction({ studentId, levelId });
        if (res.ok) toast.success(t("actions.unlocked"), t("actions.unlockedBody", { level: level?.label ?? "" }));
        else if (res.error === "conflict") toast.info(t("actions.alreadyUnlocked"));
        else return fail(t("actions.failed"), res.error);
      } else if (kind === "bypass") {
        const res = await setGetReadyBypassAction({ studentId, bypass: !bypass });
        if (res.ok) toast.success(!bypass ? t("actions.bypassOn") : t("actions.bypassOff"), !bypass ? t("actions.bypassOnBody") : t("actions.bypassOffBody"));
        else return fail(t("actions.failed"), res.error);
      } else if (kind === "extend") {
        const res = await extendEnrollmentAction({ studentId, days });
        if (res.ok) toast.success(res.data.created ? t("actions.enrollmentCreated") : t("actions.enrollmentExtended"), t("actions.enrollmentEnds", { date: formatDate(res.data.endsAt, locale) }));
        else if (res.error === "conflict") return fail(t("actions.failed"), "conflict");
        else return fail(t("actions.failed"), res.error);
      } else {
        const res = await startInPersonAction({ testId, studentIds: [studentId] });
        if (!res.ok) return fail(t("inPerson.failed"), res.error);
        if (res.data.started.length > 0) toast.success(t("inPerson.startedOne"), t("inPerson.startedOneBody"));
        else {
          const reason = res.data.skipped[0]?.reason ?? "error";
          toast.error(t("inPerson.notStarted"), t(`inPerson.skip.${reason}`));
        }
      }
      setPending(null);
      router.refresh();
    } catch (e) {
      console.error("[cc-admin] student action failed", e);
      fail(t("actions.failed"), "error");
    }
  }

  async function resend() {
    setSending(true);
    try {
      const res = await resendVerificationAction({ studentId });
      if (!res.ok) {
        if (res.detail === "rate_limited") toast.error(t("actions.failed"), t("actions.verifyRateLimited"));
        else fail(t("actions.failed"), res.error);
        return;
      }
      if (res.data.state === "sent") toast.success(t("actions.verifySent"), t("actions.verifySentBody"));
      else if (res.data.state === "confirmed") toast.info(t("actions.verifyAlready"));
      else toast.info(t("actions.verifyNoEmail"));
      setVerifyState(res.data.state === "sent" ? "unconfirmed" : res.data.state);
    } catch (e) {
      console.error("[cc-admin] resend failed", e);
      fail(t("actions.failed"), "error");
    } finally {
      setSending(false);
    }
  }

  const extendConsequence =
    plan == null
      ? ""
      : plan.kind === "extend"
        ? t("actions.extendConfirmBody", { days: String(n), from: formatDate(plan.fromEndsAt, locale), to: formatDate(plan.endsAt, locale) })
        : t("actions.createConfirmBody", { days: String(n), to: formatDate(plan.endsAt, locale) });

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* Unlock level */}
      <div className={box}>
        <h3 className="title-card">{t("actions.unlockTitle")}</h3>
        <p className="text-sm text-body">{t("actions.unlockText")}</p>
        {levels.length === 0 ? (
          <p className="text-sm text-mutedtext">{t("actions.noLevels")}</p>
        ) : (
          <>
            <Field label={t("actions.level")}>
              <select value={levelId} onChange={(e) => setLevelId(e.target.value)} className={selectCls}>
                <option value="">{t("actions.chooseLevel")}</option>
                {levels.map((l) => (
                  <option key={l.id} value={l.id} disabled={l.unlocked}>
                    {l.unlocked ? `${l.label} (${t("actions.unlockedTag")})` : l.label}
                  </option>
                ))}
              </select>
            </Field>
            <Button size="sm" disabled={!level || level.unlocked} disabledReason={t("actions.chooseLevel")} onClick={() => setPending("unlock")}>
              {t("actions.unlockButton")}
            </Button>
          </>
        )}
      </div>

      {/* Get Ready bypass */}
      <div className={box}>
        <h3 className="title-card">{t("actions.bypassTitle")}</h3>
        <p className="text-sm text-body">{bypass ? t("actions.bypassStateOn") : t("actions.bypassStateOff")}</p>
        <Button size="sm" variant={bypass ? "secondary" : "primary"} onClick={() => setPending("bypass")}>
          {bypass ? t("actions.bypassTurnOff") : t("actions.bypassTurnOn")}
        </Button>
      </div>

      {/* Extend enrollment */}
      <div className={box}>
        <h3 className="title-card">{t("actions.extendTitle")}</h3>
        <p className="text-sm text-body">{t("actions.extendText")}</p>
        <Field label={t("actions.days")} hint={t("actions.daysHint", { min: String(EXTEND_DAYS_MIN), max: String(EXTEND_DAYS_MAX) })}>
          <input
            type="number"
            inputMode="numeric"
            min={EXTEND_DAYS_MIN}
            max={EXTEND_DAYS_MAX}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className={inputCls}
            dir="ltr"
            aria-invalid={n == null}
          />
        </Field>
        <Button size="sm" disabled={n == null} disabledReason={t("actions.daysHint", { min: String(EXTEND_DAYS_MIN), max: String(EXTEND_DAYS_MAX) })} onClick={() => setPending("extend")}>
          {plan?.kind === "create" ? t("actions.createButton") : t("actions.extendButton")}
        </Button>
      </div>

      {/* Verification email */}
      <div className={box}>
        <h3 className="title-card">{t("actions.verifyTitle")}</h3>
        <p className="text-sm text-body">
          {verifyState === "confirmed"
            ? t("actions.verifyStateConfirmed")
            : verifyState === "unconfirmed"
              ? t("actions.verifyStateUnconfirmed")
              : verifyState === "no_email"
                ? t("actions.verifyNoEmail")
                : t("actions.verifyStateUnknown")}
        </p>
        <p className="text-xs text-mutedtext">{t("actions.verifyNote")}</p>
        <Button size="sm" variant="secondary" loading={sending} loadingText={t("actions.verifySending")} disabled={verifyState === "confirmed" || verifyState === "no_email"} onClick={resend}>
          {t("actions.verifyButton")}
        </Button>
      </div>

      {/* In-person session for this student */}
      <div className={`${box} lg:col-span-2`}>
        <h3 className="title-card">{t("inPerson.oneTitle")}</h3>
        <p className="text-sm text-body">{t("inPerson.oneText")}</p>
        {tests.length === 0 ? (
          <p className="text-sm text-mutedtext">{t("inPerson.noTests")}</p>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field label={t("inPerson.test")} className="sm:flex-1">
              <select value={testId} onChange={(e) => setTestId(e.target.value)} className={selectCls}>
                {tests.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.title}
                  </option>
                ))}
              </select>
            </Field>
            <Button size="sm" disabled={!test} onClick={() => setPending("inPerson")}>
              {t("inPerson.startOne")}
            </Button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pending === "unlock"}
        onOpenChange={(o) => setPending(o ? "unlock" : null)}
        title={t("actions.unlockConfirmTitle")}
        consequence={t("actions.unlockConfirmBody", { level: level?.label ?? "" })}
        confirmLabel={t("actions.unlockButton")}
        cancelLabel={tc("cancel")}
        onConfirm={() => run("unlock")}
      />
      <ConfirmDialog
        open={pending === "bypass"}
        onOpenChange={(o) => setPending(o ? "bypass" : null)}
        title={bypass ? t("actions.bypassTurnOff") : t("actions.bypassTurnOn")}
        consequence={bypass ? t("actions.bypassOffConfirm") : t("actions.bypassOnConfirm")}
        confirmLabel={bypass ? t("actions.bypassTurnOff") : t("actions.bypassTurnOn")}
        cancelLabel={tc("cancel")}
        onConfirm={() => run("bypass")}
      />
      <ConfirmDialog
        open={pending === "extend"}
        onOpenChange={(o) => setPending(o ? "extend" : null)}
        title={plan?.kind === "create" ? t("actions.createButton") : t("actions.extendButton")}
        consequence={extendConsequence}
        confirmLabel={plan?.kind === "create" ? t("actions.createButton") : t("actions.extendButton")}
        cancelLabel={tc("cancel")}
        onConfirm={() => run("extend")}
      />
      <ConfirmDialog
        open={pending === "inPerson"}
        onOpenChange={(o) => setPending(o ? "inPerson" : null)}
        title={t("inPerson.confirmOneTitle")}
        consequence={t("inPerson.confirmOneBody", { test: test?.title ?? "" })}
        confirmLabel={t("inPerson.startOne")}
        cancelLabel={tc("cancel")}
        onConfirm={() => run("inPerson")}
      />
    </div>
  );
}
