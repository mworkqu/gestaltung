"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";
import { useTranslations } from "next-intl";

import { startInPersonAction } from "@/app/[locale]/cad-champions/admin/students/actions";
import { inputCls } from "@/components/cad-champions/admin/fields";
import { Alert, Button, ConfirmDialog, EmptyState, useToast } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { IN_PERSON_MAX_STUDENTS, type InPersonSkipReason } from "@/lib/cad-champions/admin/in-person";
import { formatDateTime, formatNumber } from "@/lib/cad-champions/format";
import { Ltr } from "@/lib/cad-champions/ltr";

// Pick students for an in-person session and start the timer for all of
// them at once (admin). Students who cannot start (attempt in progress,
// retake cooldown, Get Ready not done) are skipped and listed with the reason.

export type StarterStudent = { id: string; name: string; email: string | null; institution: string | null; getReadyPercent: number; getReadyBypass: boolean };

type Outcome = { started: { name: string }[]; skipped: { name: string; reason: InPersonSkipReason }[]; deadlineAt: string | null };

export function InPersonStarter({
  locale,
  testId,
  testTitle,
  minutes,
  students,
}: {
  locale: Locale;
  testId: string;
  testTitle: string;
  minutes: number | null;
  students: StarterStudent[];
}) {
  const t = useTranslations("CC.admin.students");
  const tc = useTranslations("CC.admin.common");
  const toast = useToast();
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [open, setOpen] = React.useState(false);
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);

  const needle = q.trim().toLowerCase();
  const visible = needle
    ? students.filter((s) => [s.name, s.email, s.institution].filter(Boolean).join(" ").toLowerCase().includes(needle))
    : students;
  const byId = new Map(students.map((s) => [s.id, s]));
  const tooMany = picked.size > IN_PERSON_MAX_STUDENTS;

  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const pickVisible = () => setPicked((cur) => new Set([...cur, ...visible.map((s) => s.id)]));

  async function start() {
    try {
      const res = await startInPersonAction({ testId, studentIds: [...picked] });
      if (!res.ok) {
        toast.error(t("inPerson.failed"), res.detail ? t(`inPerson.detail.${res.detail}`) : tc(`errors.${res.error}`));
        return;
      }
      const nameOf = (id: string) => byId.get(id)?.name ?? id;
      setOutcome({
        started: res.data.started.map((s) => ({ name: nameOf(s.studentId) })),
        skipped: res.data.skipped.map((s) => ({ name: nameOf(s.studentId), reason: s.reason })),
        deadlineAt: res.data.deadlineAt,
      });
      if (res.data.started.length > 0) toast.success(t("inPerson.startedMany", { count: formatNumber(res.data.started.length, locale) }), t("inPerson.startedManyBody"));
      else toast.error(t("inPerson.notStarted"), t("inPerson.noneStarted"));
      setPicked(new Set());
      setOpen(false);
      router.refresh();
    } catch (e) {
      console.error("[cc-admin] in-person start failed", e);
      toast.error(t("inPerson.failed"), tc("errors.error"));
    }
  }

  return (
    <div className="space-y-4">
      {outcome ? (
        <Alert tone={outcome.started.length > 0 ? "success" : "warning"} title={t("inPerson.resultTitle", { started: formatNumber(outcome.started.length, locale), skipped: formatNumber(outcome.skipped.length, locale) })}>
          {outcome.deadlineAt ? <p>{t("inPerson.resultDeadline", { date: formatDateTime(outcome.deadlineAt, locale) })}</p> : null}
          {outcome.skipped.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 ps-5">
              {outcome.skipped.map((s, i) => (
                <li key={i}>
                  {s.name}: {t(`inPerson.skip.${s.reason}`)}
                </li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}

      {students.length === 0 ? (
        <EmptyState icon={Users} title={t("empty.title")} description={t("empty.body")} />
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex flex-1 flex-col gap-1 text-sm font-semibold text-ink">
              {tc("search")}
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchPlaceholder")} className={inputCls} />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={pickVisible} disabled={visible.length === 0}>
                {t("inPerson.pickVisible", { count: formatNumber(visible.length, locale) })}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())} disabled={picked.size === 0}>
                {tc("clear")}
              </Button>
            </div>
          </div>

          {visible.length === 0 ? (
            <p className="text-sm text-mutedtext">{t("noMatch.title")}</p>
          ) : (
            <ul className="max-h-[28rem] space-y-1 overflow-y-auto rounded-2xl border border-border p-2" aria-label={t("inPerson.pickLabel")}>
              {visible.map((s) => (
                <li key={s.id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 py-1 hover:bg-panel">
                    <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} className="h-5 w-5 shrink-0 accent-[var(--accent,#0e59c5)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{s.name}</span>
                      <span className="block truncate text-xs text-mutedtext">
                        {s.email ? <Ltr>{s.email}</Ltr> : null}
                        {s.institution ? ` · ${s.institution}` : ""}
                      </span>
                    </span>
                    {s.getReadyPercent < 100 && !s.getReadyBypass ? <span className="shrink-0 text-xs text-[#a1231f]">{t("inPerson.getReadyNotDone")}</span> : null}
                  </label>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-body" aria-live="polite">
              {t("inPerson.picked", { count: formatNumber(picked.size, locale) })}
              {tooMany ? <span className="ms-2 text-[#a1231f]">{t("inPerson.detail.too_many")}</span> : null}
            </p>
            <Button disabled={picked.size === 0 || tooMany} disabledReason={t("inPerson.pickFirst")} onClick={() => setOpen(true)}>
              {t("inPerson.startButton")}
            </Button>
          </div>
        </>
      )}

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("inPerson.confirmTitle")}
        consequence={
          minutes
            ? t("inPerson.confirmBody", { count: formatNumber(picked.size, locale), test: testTitle, minutes: formatNumber(minutes, locale) })
            : t("inPerson.confirmBodyUntimed", { count: formatNumber(picked.size, locale), test: testTitle })
        }
        confirmLabel={t("inPerson.startButton")}
        cancelLabel={tc("cancel")}
        onConfirm={start}
      />
    </div>
  );
}
