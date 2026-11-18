"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Download, ExternalLink, FileText, Keyboard, Languages, Minus, Plus, RotateCcw, XCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { finalizeReviewAction, translateCommentAction } from "@/app/[locale]/cad-champions/admin/review/actions";
import { Alert, Button, ConfirmDialog, HelpTip, StatusChip, useToast } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import type { ReviewAspectView, ReviewItemView } from "@/lib/cad-champions/drawing/review-server";
import { COMMENT_MAX, isDecided, prefill, type Decision } from "@/lib/cad-champions/drawing/review";
import { AI_CONFIDENCE_MIN } from "@/lib/cad-champions/drawing/ai-schema";
import { formatNumber } from "@/lib/cad-champions/format";
import { aspectPoints } from "@/lib/cad-champions/scoring/core";
import { Ltr } from "@/lib/cad-champions/ltr";
import { ccPath } from "@/lib/cad-champions/routes";
import { cn } from "@/lib/utils";

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

function isTyping(el: EventTarget | null): boolean {
  const n = el as HTMLElement | null;
  if (!n) return false;
  const tag = n.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || n.isContentEditable;
}

export function ReviewWorkspace({ view, aiAvailable }: { view: ReviewItemView; aiAvailable: boolean }) {
  const t = useTranslations("CC.review.screen");
  const locale = useLocale() as Locale;
  const toast = useToast();
  const router = useRouter();

  const [decisions, setDecisions] = React.useState<Record<string, Decision>>(() =>
    Object.fromEntries(view.aspects.map((a) => [a.id, prefill({ id: a.id, type: a.type, method: a.method, max_points: a.maxPoints }, a.existing ? { passed: a.existing.passed, judgement_score: a.existing.score } : null)]))
  );
  const [active, setActive] = React.useState(0);
  const [page, setPage] = React.useState(1);

  const [writeLang, setWriteLang] = React.useState<"en" | "ar">(() => (view.comment.ar && !view.comment.en ? "ar" : view.comment.machine === "en" ? "ar" : "en"));
  const [main, setMain] = React.useState(() => (writeLang === "ar" ? view.comment.ar : view.comment.en));
  const [other, setOther] = React.useState(() => (writeLang === "ar" ? view.comment.en : view.comment.ar));
  const [otherMachine, setOtherMachine] = React.useState(view.comment.machine != null);
  const [translating, startTranslate] = React.useTransition();
  const [finalizing, startFinalize] = React.useTransition();
  const [done, setDone] = React.useState<{ emailed: boolean; graded: boolean } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const rowRefs = React.useRef<(HTMLLIElement | null)[]>([]);
  const undecided = view.aspects.filter((a) => !isDecided(a, decisions[a.id]));
  const canFinalize = undecided.length === 0 && !finalizing && !done;
  const nextHref = view.nextId ? ccPath(locale, `/admin/review/${view.nextId}`) : null;

  const setPassed = React.useCallback((aspect: ReviewAspectView, passed: boolean) => {
    if (aspect.type !== "measurement") return;
    setDecisions((d) => ({ ...d, [aspect.id]: { aspectId: aspect.id, passed } }));
  }, []);
  const setScore = (aspect: ReviewAspectView, score: number) => setDecisions((d) => ({ ...d, [aspect.id]: { aspectId: aspect.id, score } }));

  const finalize = React.useCallback(() => {
    if (undecided.length > 0) {
      setError(t("finalize.missing", { count: formatNumber(undecided.length, locale) }));
      const i = view.aspects.findIndex((a) => a.id === undecided[0].id);
      if (i >= 0) setActive(i);
      return;
    }
    setError(null);
    const commentEn = writeLang === "en" ? main : other;
    const commentAr = writeLang === "ar" ? main : other;
    const machine = otherMachine && other.trim() ? (writeLang === "en" ? "ar" : "en") : null;
    startFinalize(async () => {
      const res = await finalizeReviewAction({ taskResultId: view.id, decisions: Object.values(decisions), commentEn, commentAr, machineTranslated: machine });
      if (res.ok) {
        setDone({ emailed: res.emailed, graded: res.attemptStatus === "graded" });
        toast.success(t("finalize.toast"), res.attemptStatus === "graded" ? t("finalize.toastGraded") : t("finalize.toastProvisional"));
        router.refresh();
        return;
      }
      const code = "error" in res ? res.error : "error";
      setError(t(`finalize.errors.${code === "forbidden" || code === "not_found" || code === "not_reviewable" || code === "incomplete" || code === "too_long" || code === "unavailable" ? code : "error"}`));
    });
  }, [decisions, locale, main, other, otherMachine, router, t, toast, undecided, view.aspects, view.id, writeLang]);

  // Finalizing saves the score and emails the student, so ask first. Missing decisions skip the dialog (finalize jumps to the first one).
  const askFinalize = React.useCallback(() => {
    if (undecided.length > 0) finalize();
    else setConfirmOpen(true);
  }, [finalize, undecided.length]);

  // Keyboard: J/K items, P/F pass/fail, 0-3 judgement, Enter finalize, N next submission.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target)) return;
      const key = e.key.toLowerCase();
      const a = view.aspects[active];
      if (key === "j") {
        e.preventDefault();
        setActive((i) => Math.min(view.aspects.length - 1, i + 1));
      } else if (key === "k") {
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
      } else if ((key === "p" || key === "f") && a) {
        e.preventDefault();
        setPassed(a, key === "p");
        if (a.type === "measurement") setActive((i) => Math.min(view.aspects.length - 1, i + 1));
      } else if (/^[0-3]$/.test(key) && a?.type === "judgement") {
        e.preventDefault();
        setDecisions((d) => ({ ...d, [a.id]: { aspectId: a.id, score: Number(key) } }));
      } else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLAnchorElement)) {
        e.preventDefault();
        askFinalize();
      } else if (key === "n" && nextHref) {
        e.preventDefault();
        router.push(nextHref);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, askFinalize, nextHref, router, setPassed, view.aspects]);

  React.useEffect(() => {
    rowRefs.current[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function translate() {
    const text = main.trim();
    if (!text) return;
    const to = writeLang === "en" ? "ar" : "en";
    startTranslate(async () => {
      const res = await translateCommentAction({ taskResultId: view.id, text, to });
      if (res.ok) {
        setOther(res.text);
        setOtherMachine(true);
        toast.info(t("comment.translated"));
      } else {
        toast.error(res.reason === "not_configured" ? t("comment.notConfigured") : t("comment.translateError"));
      }
    });
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        <Viewer url={view.pdfUrl} page={page} setPage={setPage} upload={view.upload} />
        <Files view={view} />
      </div>

      <div className="space-y-6">
        <section aria-labelledby="cc-rubric-title" className="neu space-y-4 p-5">
          <div className="flex items-center gap-2">
            <h2 id="cc-rubric-title" className="text-lg font-extrabold text-heading">
              {t("rubric.title")}
            </h2>
            <HelpTip label={t("rubric.helpLabel")}>{t("rubric.help")}</HelpTip>
          </div>
          {view.aspects.length === 0 ? (
            <p className="text-sm text-body">{t("rubric.empty")}</p>
          ) : (
            <ol className="space-y-3">
              {view.aspects.map((a, i) => (
                <li
                  key={a.id}
                  ref={(el) => {
                    rowRefs.current[i] = el;
                  }}
                  onClick={() => setActive(i)}
                  className={cn("tile space-y-3 transition-shadow", i === active ? "ring-2 ring-accent" : "")}
                  aria-current={i === active ? "true" : undefined}
                >
                  <AspectRow aspect={a} decision={decisions[a.id]} onPass={(p) => setPassed(a, p)} onScore={(s) => setScore(a, s)} onPage={setPage} />
                </li>
              ))}
            </ol>
          )}
        </section>

        <section aria-labelledby="cc-comment-title" className="neu space-y-3 p-5">
          <h2 id="cc-comment-title" className="text-lg font-extrabold text-heading">
            {t("comment.title")}
          </h2>
          <p className="text-xs text-body">{t("comment.hint")}</p>
          <fieldset className="flex flex-wrap items-center gap-3 text-sm">
            <legend className="sr-only">{t("comment.lang")}</legend>
            <span className="font-semibold text-ink" aria-hidden="true">
              {t("comment.lang")}
            </span>
            {(["en", "ar"] as const).map((l) => (
              <label key={l} className="inline-flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name="cc-comment-lang"
                  value={l}
                  checked={writeLang === l}
                  onChange={() => {
                    if (l === writeLang) return;
                    setWriteLang(l);
                    setMain(other);
                    setOther(main);
                    setOtherMachine(false);
                  }}
                  className="h-4 w-4"
                />
                {t(`comment.${l}`)}
              </label>
            ))}
          </fieldset>
          <textarea
            aria-label={t("comment.label", { lang: t(`comment.${writeLang}`) })}
            dir={writeLang === "ar" ? "rtl" : "ltr"}
            lang={writeLang}
            value={main}
            onChange={(e) => setMain(e.target.value)}
            rows={4}
            maxLength={COMMENT_MAX}
            className="w-full rounded-xl border border-border bg-surface p-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={translate}
            loading={translating}
            loadingText={t("comment.translating")}
            disabled={!main.trim() || !aiAvailable}
            disabledReason={!aiAvailable ? t("comment.notConfigured") : t("comment.writeFirst")}
          >
            <Languages aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
            {t("comment.translate")}
          </Button>
          {other || otherMachine ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-ink">{t("comment.label", { lang: t(`comment.${writeLang === "en" ? "ar" : "en"}`) })}</span>
                {otherMachine ? <StatusChip tone="info">{t("comment.machine")}</StatusChip> : null}
              </div>
              <textarea
                aria-label={t("comment.label", { lang: t(`comment.${writeLang === "en" ? "ar" : "en"}`) })}
                dir={writeLang === "en" ? "rtl" : "ltr"}
                lang={writeLang === "en" ? "ar" : "en"}
                value={other}
                onChange={(e) => setOther(e.target.value)}
                rows={4}
                maxLength={COMMENT_MAX}
                className="w-full rounded-xl border border-border bg-surface p-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
              {otherMachine ? <p className="text-xs text-body">{t("comment.machineHint")}</p> : null}
            </div>
          ) : null}
        </section>

        <section aria-labelledby="cc-finalize-title" className="neu space-y-3 p-5">
          <h2 id="cc-finalize-title" className="text-lg font-extrabold text-heading">
            {t("finalize.title")}
          </h2>
          {done ? (
            <Alert tone="success" title={t("finalize.doneTitle")}>
              {done.graded ? (done.emailed ? t("finalize.doneEmailed") : t("finalize.doneGraded")) : t("finalize.doneProvisional")}
            </Alert>
          ) : (
            <p className="text-sm text-body">{undecided.length > 0 ? t("finalize.remaining", { count: formatNumber(undecided.length, locale) }) : t("finalize.ready")}</p>
          )}
          {error ? (
            <p className="text-sm font-semibold text-[#a1231f]" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {!done ? (
              <Button type="button" onClick={askFinalize} loading={finalizing} loadingText={t("finalize.finalizing")} disabled={!canFinalize} disabledReason={t("finalize.remaining", { count: formatNumber(undecided.length, locale) })}>
                {view.finalized ? t("finalize.again") : t("finalize.button")}
              </Button>
            ) : null}
            {!done ? (
              <ConfirmDialog
                open={confirmOpen}
                onOpenChange={setConfirmOpen}
                title={t("finalize.confirmTitle")}
                consequence={t("finalize.confirmBody")}
                confirmLabel={t("finalize.button")}
                onConfirm={() => {
                  setConfirmOpen(false);
                  finalize();
                }}
              />
            ) : null}
            {nextHref ? (
              <Button asChild variant={done ? "primary" : "secondary"}>
                <Link href={nextHref}>{t("finalize.next")}</Link>
              </Button>
            ) : done ? (
              <Button asChild variant="secondary">
                <Link href={ccPath(locale, "/admin/review")}>{t("finalize.backToQueue")}</Link>
              </Button>
            ) : null}
          </div>
        </section>

        <section aria-labelledby="cc-keys-title" className="neu-inset space-y-2 p-4 text-sm">
          <h2 id="cc-keys-title" className="flex items-center gap-2 font-bold text-ink">
            <Keyboard aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
            {t("keys.title")}
          </h2>
          <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {(["j", "k", "p", "f", "digits", "enter", "n"] as const).map((k) => (
              <li key={k} className="flex items-center gap-2 text-body">
                <kbd className="min-w-[2rem] rounded-md border border-border bg-surface px-1.5 py-0.5 text-center font-mono text-xs text-ink">{t(`keys.${k}Key`)}</kbd>
                {t(`keys.${k}`)}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function AspectRow({
  aspect,
  decision,
  onPass,
  onScore,
  onPage,
}: {
  aspect: ReviewAspectView;
  decision: Decision | undefined;
  onPass: (passed: boolean) => void;
  onScore: (score: number) => void;
  onPage: (page: number) => void;
}) {
  const t = useTranslations("CC.review.screen.rubric");
  const locale = useLocale() as Locale;
  const ai = aspect.ai;
  const low = ai != null && (ai.status === "unclear" || ai.confidence < AI_CONFIDENCE_MIN);
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-ink">{aspect.description}</p>
          <p className="text-xs text-body">
            {aspect.type === "judgement" ? t("judgement") : aspect.method === "ai_drawing" ? t("measurementAi") : t("measurementTrainer")}
            {" · "}
            {t("points", { points: formatNumber(aspect.maxPoints, locale) })}
          </p>
        </div>
        {ai ? (
          <StatusChip tone={low ? "warning" : ai.status === "pass" ? "success" : ai.status === "fail" ? "danger" : "warning"}>
            {t(`ai.${ai.status}`)} · {t("confidence", { value: formatNumber(Math.round(ai.confidence * 100), locale) })}
          </StatusChip>
        ) : aspect.method === "ai_drawing" ? (
          <StatusChip tone="neutral">{t("noAi")}</StatusChip>
        ) : null}
      </div>
      {ai?.evidence ? (
        <p className="text-xs text-body">
          <span className="font-semibold text-ink">{t("evidence")}</span> <Ltr>{ai.evidence}</Ltr>
          {ai.page > 0 ? (
            <button type="button" onClick={() => onPage(ai.page)} className="ms-2 inline-flex min-h-8 items-center font-semibold text-accent underline-offset-2 hover:underline">
              {t("page", { n: formatNumber(ai.page, locale) })}
            </button>
          ) : null}
        </p>
      ) : null}
      {aspect.type === "measurement" ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("decide", { item: aspect.description })}>
          <button
            type="button"
            aria-pressed={decision?.passed === true}
            onClick={() => onPass(true)}
            className={cn(
              "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              decision?.passed === true ? "border-buy bg-buy text-white" : "border-border bg-surface text-ink hover:bg-panel"
            )}
          >
            <CheckCircle2 aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
            {t("pass")}
          </button>
          <button
            type="button"
            aria-pressed={decision?.passed === false}
            onClick={() => onPass(false)}
            className={cn(
              "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              decision?.passed === false ? "border-[#a1231f] bg-[#a1231f] text-white" : "border-border bg-surface text-ink hover:bg-panel"
            )}
          >
            <XCircle aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
            {t("fail")}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t("decide", { item: aspect.description })}>
          {[0, 1, 2, 3].map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={decision?.score === s}
              onClick={() => onScore(s)}
              className={cn(
                "flex min-h-11 items-start gap-2 rounded-xl border px-3 py-2 text-start text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                decision?.score === s ? "border-accent bg-accent text-accent-foreground" : "border-border bg-surface text-ink hover:bg-panel"
              )}
            >
              <span className="font-extrabold">{formatNumber(s, locale)}</span>
              <span className="text-xs leading-snug">{t(`scale.${s}`)}</span>
            </button>
          ))}
          {typeof decision?.score === "number" ? (
            <p className="text-sm font-semibold text-ink sm:col-span-2" aria-live="polite">
              {t("earned", {
                points: formatNumber(aspectPoints({ type: "judgement", max_points: aspect.maxPoints, partial_rule: null }, { aspect_id: aspect.id, passed: null, judgement_score: decision.score }), locale),
                max: formatNumber(aspect.maxPoints, locale),
              })}
            </p>
          ) : null}
        </div>
      )}
    </>
  );
}

function Viewer({ url, page, setPage, upload }: { url: string | null; page: number; setPage: (n: number) => void; upload: ReviewItemView["upload"] }) {
  const t = useTranslations("CC.review.screen.viewer");
  const locale = useLocale() as Locale;
  const [zoom, setZoom] = React.useState(1);
  const [pageInput, setPageInput] = React.useState(String(page));
  React.useEffect(() => setPageInput(String(page)), [page]);

  if (!url) {
    return (
      <section className="neu space-y-3 p-5" aria-labelledby="cc-viewer-title">
        <h2 id="cc-viewer-title" className="text-lg font-extrabold text-heading">
          {t("title")}
        </h2>
        <Alert tone="info" title={t("noPdfTitle")}>
          {t("noPdf")}
        </Alert>
        {upload ? (
          <a href={upload.url} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-accent underline-offset-2 hover:underline">
            <Download aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
            <Ltr>{upload.name}</Ltr>
          </a>
        ) : null}
      </section>
    );
  }
  const idx = ZOOM_STEPS.indexOf(zoom);
  const src = `${url}#page=${page}&view=FitH`;
  return (
    <section className="neu space-y-3 p-4" aria-labelledby="cc-viewer-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="cc-viewer-title" className="flex items-center gap-2 text-lg font-extrabold text-heading">
          <FileText aria-hidden="true" strokeWidth={1.75} className="h-5 w-5" />
          {t("title")}
          <HelpTip label={t("helpLabel")}>{t("help")}</HelpTip>
        </h2>
        <div className="flex flex-wrap items-center gap-1">
          <button type="button" aria-label={t("zoomOut")} disabled={idx <= 0} onClick={() => setZoom(ZOOM_STEPS[Math.max(0, idx - 1)])} className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-panel disabled:opacity-50">
            <Minus aria-hidden="true" className="h-4 w-4" />
          </button>
          <span className="min-w-[3.5rem] text-center text-sm font-semibold text-ink" aria-live="polite">
            <Ltr>{formatNumber(Math.round(zoom * 100), locale)}%</Ltr>
          </span>
          <button type="button" aria-label={t("zoomIn")} disabled={idx >= ZOOM_STEPS.length - 1} onClick={() => setZoom(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, idx + 1)])} className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-panel disabled:opacity-50">
            <Plus aria-hidden="true" className="h-4 w-4" />
          </button>
          <button type="button" aria-label={t("fitWidth")} title={t("fitWidth")} onClick={() => setZoom(1)} className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-panel">
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
          </button>
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Math.max(1, Math.min(999, Math.floor(Number(pageInput)) || 1));
              setPage(n);
            }}
          >
            <label className="flex items-center gap-1 text-sm text-body">
              {t("page")}
              <input value={pageInput} onChange={(e) => setPageInput(e.target.value)} inputMode="numeric" className="h-11 w-14 rounded-lg border border-border bg-surface px-2 text-center text-sm text-ink" />
            </label>
            <button type="submit" className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-accent hover:bg-panel">
              {t("go")}
            </button>
          </form>
          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm font-semibold text-accent hover:bg-panel">
            <ExternalLink aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 rtl:-scale-x-100" />
            {t("openNew")}
          </a>
        </div>
      </div>
      <div className="neu-inset h-[70vh] min-h-[420px] overflow-auto" dir="ltr">
        <div style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%`, minWidth: "100%", minHeight: "100%" }}>
          <iframe key={src} src={src} title={t("frameTitle")} className="h-full w-full rounded-xl bg-white" />
        </div>
      </div>
    </section>
  );
}

function Files({ view }: { view: ReviewItemView }) {
  const t = useTranslations("CC.review.screen.files");
  const hasAny = !!view.upload || view.packageFiles.length > 0 || view.unmatchedFiles.length > 0;
  return (
    <section className="neu space-y-3 p-5" aria-labelledby="cc-files-title">
      <div className="flex items-center gap-2">
        <h2 id="cc-files-title" className="text-lg font-extrabold text-heading">
          {t("title")}
        </h2>
        <HelpTip label={t("helpLabel")}>{t("help")}</HelpTip>
      </div>
      {!hasAny ? <p className="text-sm text-body">{t("none")}</p> : null}
      {view.upload ? (
        <div>
          <h3 className="text-sm font-bold text-ink">{view.packageFiles.length || view.unmatchedFiles.length ? t("package") : t("upload")}</h3>
          <FileLink file={view.upload} />
        </div>
      ) : null}
      {view.packageFiles.length > 0 ? (
        <div>
          <h3 className="text-sm font-bold text-ink">{t("taskFiles")}</h3>
          <ul className="space-y-1">
            {view.packageFiles.map((f) => (
              <li key={f.name}>
                <FileLink file={f} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {view.unmatchedFiles.length > 0 ? (
        <div>
          <h3 className="text-sm font-bold text-ink">{t("unmatched")}</h3>
          <ul className="space-y-1">
            {view.unmatchedFiles.map((f) => (
              <li key={f.name}>
                <FileLink file={f} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function FileLink({ file }: { file: { name: string; url: string } }) {
  return (
    <a href={file.url} className="inline-flex min-h-11 max-w-full items-center gap-2 text-sm font-semibold text-accent underline-offset-2 hover:underline">
      <Download aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 shrink-0" />
      <Ltr className="truncate">{file.name}</Ltr>
    </a>
  );
}
