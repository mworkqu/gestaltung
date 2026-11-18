"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Mail, Send } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { countRecipientsAction, sendTestAnnouncementAction, startAnnouncementAction } from "@/app/[locale]/cad-champions/admin/operations/actions";
import { BilingualField, CheckboxField, Field, inputCls } from "@/components/cad-champions/admin/fields";
import { EmailFrame, EmailText } from "@/components/cad-champions/admin/emails/email-frame";
import { Alert, Button, ConfirmDialog, HelpTip, Spinner, useToast } from "@/components/cad-champions/ui";
import { ANNOUNCEMENT_KINDS, renderAnnouncementEmail, validateAnnouncement } from "@/lib/cad-champions/admin/announcements";
import type { Progress } from "@/lib/cad-champions/admin/announcements-server";
import { EMPTY_STUDENT_FILTERS, studentFilterParams, type StudentFilters } from "@/lib/cad-champions/admin/students";
import { CC_BANDS, type CcAnnouncementKind } from "@/lib/cad-champions/db/types";
import { formatNumber } from "@/lib/cad-champions/format";
import type { Locale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

import { runSendLoop } from "./send-loop";

type Counts = { count: number; skipped: { noEmail: number; deletionRequested: number; noConsent: number } };

const selectCls = `${inputCls} pe-8`;

export function AnnouncementComposer({ institutions, adminEmail }: { institutions: string[]; adminEmail: string | null }) {
  const t = useTranslations("CC.admin.operations.announcements");
  const tc = useTranslations("CC.admin.common");
  const toast = useToast();
  const router = useRouter();
  const locale = useLocale() as Locale;
  const n = (x: number) => formatNumber(x, locale);

  const [kind, setKind] = React.useState<CcAnnouncementKind>("marketing");
  const [subjectEn, setSubjectEn] = React.useState("");
  const [subjectAr, setSubjectAr] = React.useState("");
  const [bodyEn, setBodyEn] = React.useState("");
  const [bodyAr, setBodyAr] = React.useState("");
  const [filters, setFilters] = React.useState<StudentFilters>(EMPTY_STUDENT_FILTERS);
  const [counts, setCounts] = React.useState<Counts | null>(null);
  const [countError, setCountError] = React.useState<string | null>(null);
  const [counting, setCounting] = React.useState(false);
  const [showPreview, setShowPreview] = React.useState(false);
  const [previewTab, setPreviewTab] = React.useState<"html" | "text">("html");
  const [testing, setTesting] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [progress, setProgress] = React.useState<Progress | null>(null);
  const [running, setRunning] = React.useState(false);
  const [runNote, setRunNote] = React.useState<"stopped" | "no_key" | "error" | null>(null);
  const stopRef = React.useRef(false);

  const draft = { kind, subjectEn, subjectAr, bodyEn, bodyAr };
  const valid = validateAnnouncement(draft);
  const preview = React.useMemo(() => {
    const v = validateAnnouncement({ kind, subjectEn, subjectAr, bodyEn, bodyAr });
    return v.ok ? renderAnnouncementEmail(v.value) : null;
  }, [kind, subjectEn, subjectAr, bodyEn, bodyAr]);

  const filterKey = JSON.stringify(studentFilterParams(filters));
  React.useEffect(() => {
    let cancelled = false;
    setCounting(true);
    const timer = setTimeout(async () => {
      const r = await countRecipientsAction({ filters: JSON.parse(filterKey) as Record<string, string>, kind });
      if (cancelled) return;
      setCounting(false);
      if (r.ok) {
        setCounts(r.data);
        setCountError(null);
      } else {
        setCounts(null);
        setCountError(r.error);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [filterKey, kind]);

  const setF = <K extends keyof StudentFilters>(k: K, v: StudentFilters[K]) => setFilters((f) => ({ ...f, [k]: v }));

  async function sendTest() {
    setTesting(true);
    try {
      const r = await sendTestAnnouncementAction(draft);
      if (r.ok) toast.success(t("actions.testSent", { email: r.data.email }));
      else toast.error(t("actions.testFailed"), r.error === "invalid" ? t("actions.fillAll") : undefined);
    } finally {
      setTesting(false);
    }
  }

  async function runLoop(id: string) {
    stopRef.current = false;
    setRunning(true);
    setRunNote(null);
    try {
      const out = await runSendLoop(id, setProgress, () => stopRef.current);
      if (out.state === "done") {
        toast.success(t("progress.doneToast", { sent: n(out.progress.sent) }));
        setSubjectEn("");
        setSubjectAr("");
        setBodyEn("");
        setBodyAr("");
      } else if (out.state === "stopped") setRunNote("stopped");
      else setRunNote(out.error === "no_resend_key" ? "no_key" : "error");
      router.refresh();
    } finally {
      setRunning(false);
    }
  }

  async function start() {
    const r = await startAnnouncementAction({ draft, filters: studentFilterParams(filters) });
    setConfirmOpen(false);
    if (!r.ok) {
      toast.error(r.error === "not_found" ? t("errors.noRecipients") : r.error === "invalid" ? t("actions.fillAll") : tc(`errors.${r.error}`));
      return;
    }
    setProgress({ id: r.data.id, status: "sending", recipients: r.data.recipients, pending: r.data.recipients, sent: 0, failed: 0, skipped: 0, lastError: null });
    await runLoop(r.data.id);
  }

  const canSend = valid.ok && !!counts && counts.count > 0 && !running;
  const reason = !valid.ok ? t("actions.fillAll") : !counts || counts.count === 0 ? t("errors.noRecipients") : undefined;
  const done = progress ? progress.sent + progress.failed + progress.skipped : 0;
  const pct = progress && progress.recipients > 0 ? Math.min(100, Math.round((done / progress.recipients) * 100)) : 0;

  return (
    <section aria-labelledby="compose-heading" className="neu space-y-6 p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <h2 id="compose-heading" className="title-card">
          {t("compose.heading")}
        </h2>
        <HelpTip label={t("compose.heading")}>{t("compose.help")}</HelpTip>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-ink">{t("compose.kind")}</legend>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {ANNOUNCEMENT_KINDS.map((k) => (
            <label key={k} className={cn("flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl border p-4 text-sm", kind === k ? "border-accent bg-panel" : "border-border bg-surface")}>
              <input type="radio" name="announcement-kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent,#0e59c5)]" />
              <span className="flex flex-col gap-0.5">
                <span className="font-semibold text-ink">{t(`compose.kinds.${k}`)}</span>
                <span className="text-xs text-mutedtext">{t(`compose.kindHelp.${k}`)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <BilingualField label={t("compose.subject")} en={{ value: subjectEn, onChange: setSubjectEn }} ar={{ value: subjectAr, onChange: setSubjectAr }} maxLength={150} />
      <BilingualField label={t("compose.body")} hint={t("compose.bodyHint")} multiline rows={8} en={{ value: bodyEn, onChange: setBodyEn }} ar={{ value: bodyAr, onChange: setBodyAr }} maxLength={5000} />

      <fieldset className="space-y-3 rounded-2xl border border-border p-4">
        <legend className="px-1 text-sm font-semibold text-ink">{t("compose.recipients")}</legend>
        <p className="text-xs text-mutedtext">{t("compose.recipientsHint")}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t("compose.filters.q")}>
            <input type="search" value={filters.q} onChange={(e) => setF("q", e.target.value)} className={inputCls} maxLength={100} />
          </Field>
          <Field label={t("compose.filters.institution")}>
            <select value={filters.institution} onChange={(e) => setF("institution", e.target.value)} className={selectCls}>
              <option value="">{t("compose.filters.any")}</option>
              {institutions.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("compose.filters.band")}>
            <select value={filters.band} onChange={(e) => setF("band", e.target.value as StudentFilters["band"])} className={selectCls}>
              <option value="">{t("compose.filters.any")}</option>
              <option value="none">{t("compose.filters.bandNone")}</option>
              {CC_BANDS.map((b) => (
                <option key={b} value={b}>
                  {t(`compose.filters.bands.${b}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("compose.filters.enrolled")}>
            <select value={filters.enrolled} onChange={(e) => setF("enrolled", e.target.value as StudentFilters["enrolled"])} className={selectCls}>
              <option value="">{t("compose.filters.any")}</option>
              <option value="yes">{tc("yes")}</option>
              <option value="no">{tc("no")}</option>
            </select>
          </Field>
        </div>
        <div className="flex flex-wrap gap-x-6">
          <CheckboxField label={t("compose.filters.stuck")} hint={t("compose.filters.stuckHint")} checked={filters.stuck} onChange={(v) => setF("stuck", v)} />
          <CheckboxField label={t("compose.filters.flagged")} checked={filters.flagged} onChange={(v) => setF("flagged", v)} />
        </div>
        <div aria-live="polite" className="min-h-6 text-sm">
          {counting && !counts ? (
            <Spinner label={t("count.loading")} size="sm" />
          ) : countError ? (
            <Alert tone={countError === "not_set_up" ? "info" : "error"} title={tc(`errors.${countError === "not_set_up" ? "not_set_up" : "error"}`)} />
          ) : counts ? (
            <div className={cn("space-y-1", counting && "opacity-60")}>
              <p className="font-semibold text-ink">{counts.count === 0 ? t("count.none") : t("count.line", { count: n(counts.count) })}</p>
              <p className="text-xs text-mutedtext">{t("count.skipped", { noEmail: n(counts.skipped.noEmail), deletion: n(counts.skipped.deletionRequested), noConsent: n(counts.skipped.noConsent) })}</p>
            </div>
          ) : null}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => setShowPreview((s) => !s)} aria-expanded={showPreview}>
          <Mail aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
          {showPreview ? tc("hidePreview") : tc("showPreview")}
        </Button>
        <Button variant="secondary" onClick={sendTest} loading={testing} loadingText={t("actions.testing")} disabled={!valid.ok || !adminEmail} disabledReason={!adminEmail ? t("actions.noEmail") : t("actions.fillAll")}>
          {t("actions.test")}
        </Button>
        <Button onClick={() => setConfirmOpen(true)} disabled={!canSend} disabledReason={reason} loading={running} loadingText={t("actions.sending")}>
          <Send aria-hidden="true" className="h-4 w-4 rtl:-scale-x-100" strokeWidth={1.75} />
          {t("actions.send", { count: n(counts?.count ?? 0) })}
        </Button>
      </div>
      {adminEmail ? <p className="text-xs text-mutedtext">{t("actions.testHint", { email: adminEmail })}</p> : null}

      {showPreview ? (
        <div className="space-y-3 rounded-2xl border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="title-card">{t("preview.heading")}</h3>
            <div role="tablist" aria-label={t("preview.heading")} className="flex gap-2">
              {(["html", "text"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={previewTab === tab}
                  onClick={() => setPreviewTab(tab)}
                  className={cn("min-h-11 rounded-full px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent", previewTab === tab ? "bg-accent text-accent-foreground" : "bg-surface text-ink")}
                >
                  {t(`preview.tabs.${tab}`)}
                </button>
              ))}
            </div>
          </div>
          {preview ? (
            <>
              <p className="text-sm text-body">
                <span className="font-semibold text-ink">{t("preview.subject")}: </span>
                <span dir="auto">{preview.subject}</span>
              </p>
              {previewTab === "html" ? <EmailFrame html={preview.html} title={t("preview.frameTitle")} /> : <EmailText text={preview.text} />}
              <p className="text-xs text-mutedtext">{t("preview.note")}</p>
            </>
          ) : (
            <p className="text-sm text-mutedtext">{tc("previewEmpty")}</p>
          )}
        </div>
      ) : null}

      {progress ? (
        <div className="space-y-2 rounded-2xl border border-border p-4" aria-live="polite">
          <div className="flex items-center justify-between gap-3">
            <h3 className="title-card">{t("progress.title")}</h3>
            <p className="text-sm text-body">{t("progress.line", { sent: n(progress.sent), failed: n(progress.failed), pending: n(progress.pending) })}</p>
          </div>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t("progress.title")} className="h-3 overflow-hidden rounded-full bg-panel">
            <div className="h-full bg-accent transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${pct}%` }} />
          </div>
          {running ? (
            <Button variant="ghost" size="sm" onClick={() => (stopRef.current = true)}>
              {t("progress.stop")}
            </Button>
          ) : null}
          {runNote === "no_key" ? <Alert tone="error" title={t("progress.noKey")} /> : null}
          {runNote === "error" ? <Alert tone="error" title={t("progress.error")} /> : null}
          {runNote === "stopped" ? <Alert tone="info" title={t("progress.paused")} /> : null}
          {!running && !runNote && progress.status !== "sending" ? <p className="text-sm font-semibold text-ink">{t("progress.done", { sent: n(progress.sent), failed: n(progress.failed) })}</p> : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("actions.confirmTitle", { count: n(counts?.count ?? 0) })}
        consequence={t(kind === "marketing" ? "actions.confirmBodyMarketing" : "actions.confirmBodyEssential", { count: n(counts?.count ?? 0) })}
        confirmLabel={t("actions.confirmAction")}
        cancelLabel={tc("cancel")}
        onConfirm={start}
      />
    </section>
  );
}
