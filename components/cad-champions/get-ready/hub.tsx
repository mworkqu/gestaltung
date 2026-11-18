"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, ChevronDown, Circle, CircleDot, PartyPopper } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Alert, Button, StatusChip, useToast } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import type { CcComputerAccess, CcTrackSoftware } from "@/lib/cad-champions/db/types";
import {
  markGetReadyStepAction,
  setGetReadyTickAction,
  type GetReadyActionResult,
  type PracticeResult,
} from "@/lib/cad-champions/get-ready/actions";
import { STEP_HELP_SLUG } from "@/lib/cad-champions/get-ready/content";
import {
  GET_READY_STEPS,
  MANUALLY_MARKABLE,
  computeGetReady,
  subItemKey,
  tickedSubItems,
  type GetReadyStepKey,
} from "@/lib/cad-champions/get-ready/steps";
import { ccPath } from "@/lib/cad-champions/routes";
import { cn } from "@/lib/utils";

import { HelpLink } from "./shared";
import { StepActions } from "./step-actions";
import { StepChecklist } from "./step-checklist";
import { StepComputer } from "./step-computer";
import { StepDemo } from "./step-demo";
import { StepPractice } from "./step-practice";
import { StepSoftware } from "./step-software";
import { StepWelcome } from "./step-welcome";

export interface GetReadyHubProps {
  userId: string;
  initialKeys: string[];
  loadState: "ok" | "error" | "not_set_up";
  track: CcTrackSoftware | null;
  hasWindowsPc: CcComputerAccess | null;
  bypass: boolean;
  noComputerWhatsappUrl: string | null;
  solidworksWhatsappUrl: string | null;
}

type FailReason = "signed_out" | "not_allowed" | "not_set_up" | "error" | "unavailable";

export function GetReadyHub({
  userId,
  initialKeys,
  loadState,
  track,
  hasWindowsPc,
  bypass,
  noComputerWhatsappUrl,
  solidworksWhatsappUrl,
}: GetReadyHubProps) {
  const t = useTranslations("CC.get-ready");
  const locale = useLocale() as Locale;
  const toast = useToast();

  const [keys, setKeys] = React.useState<string[]>(initialKeys);
  const keysRef = React.useRef(keys);
  React.useEffect(() => {
    keysRef.current = keys;
  }, [keys]);
  const status = React.useMemo(() => computeGetReady(keys), [keys]);

  const [openKey, setOpenKey] = React.useState<GetReadyStepKey | null>(() => computeGetReady(initialKeys).nextStep);
  const [saving, setSaving] = React.useState<GetReadyStepKey | null>(null);
  const inflightTicks = React.useRef(0);
  const headerRefs = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const scrollTo = React.useRef<GetReadyStepKey | null>(null);
  const celebrationRef = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    const key = scrollTo.current;
    if (!key) return;
    scrollTo.current = null;
    const el = headerRefs.current[key];
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    el.focus({ preventScroll: true });
  }, [openKey]);

  function reportFailure(reason: FailReason) {
    if (reason === "signed_out") toast.error(t("toast.signedOut"), t("toast.signedOutBody"));
    else if (reason === "not_set_up") toast.error(t("toast.notSetUp"), t("toast.notSetUpBody"));
    else toast.error(t("toast.saveFailed"), t("toast.saveFailedBody"));
  }

  function afterSave(prev: string[], next: string[], step: GetReadyStepKey, justCompleted: boolean) {
    const before = computeGetReady(prev);
    const after = computeGetReady(next);
    if (justCompleted) {
      toast.success(t("toast.allDone"), t("toast.allDoneBody"));
      setOpenKey(null);
      window.setTimeout(() => celebrationRef.current?.focus(), 50);
      return;
    }
    if (!before.done.has(step) && after.done.has(step)) {
      toast.success(t("toast.stepDone"), t("toast.stepDoneBody"));
      if (after.nextStep) scrollTo.current = after.nextStep;
      setOpenKey(after.nextStep);
    }
  }

  function applyResult(prev: string[], step: GetReadyStepKey, res: GetReadyActionResult) {
    if (res.ok) {
      setKeys(res.keys);
      afterSave(prev, res.keys, step, res.justCompleted);
    } else {
      reportFailure(res.reason);
    }
  }

  async function markDone(step: GetReadyStepKey) {
    if (saving) return;
    setSaving(step);
    const prev = keysRef.current;
    try {
      applyResult(prev, step, await markGetReadyStepAction(step));
    } catch (e) {
      console.error("[cc-get-ready] mark failed:", e instanceof Error ? e.message : e);
      reportFailure("error");
    } finally {
      setSaving(null);
    }
  }

  async function tick(step: GetReadyStepKey, sub: string, checked: boolean) {
    const k = subItemKey(step, sub);
    const prev = keysRef.current;
    setKeys((cur) => (checked ? [...new Set([...cur, k])] : cur.filter((x) => x !== k && x !== step)));
    inflightTicks.current += 1;
    try {
      const res = await setGetReadyTickAction(step, sub, checked);
      inflightTicks.current -= 1;
      if (!res.ok) {
        setKeys((cur) => (checked ? cur.filter((x) => x !== k) : [...new Set([...cur, k])]));
        reportFailure(res.reason);
        return;
      }
      // Only the last answer wins while several ticks are in flight.
      if (inflightTicks.current === 0) {
        setKeys(res.keys);
        afterSave(prev, res.keys, step, res.justCompleted);
      }
    } catch (e) {
      inflightTicks.current -= 1;
      console.error("[cc-get-ready] tick failed:", e instanceof Error ? e.message : e);
      setKeys((cur) => (checked ? cur.filter((x) => x !== k) : [...new Set([...cur, k])]));
      reportFailure("error");
    }
  }

  function onPractice(result: PracticeResult) {
    if (result.ok && result.outcome === "passed") {
      const prev = keysRef.current;
      setKeys(result.keys);
      afterSave(prev, result.keys, "practice_upload", result.justCompleted);
    } else if (!result.ok && (result.reason === "signed_out" || result.reason === "not_set_up")) {
      reportFailure(result.reason);
    }
  }

  const testHref = ccPath(locale, "/test/diagnostic-v1");
  const remaining = status.remainingRequired.length;

  function stepBody(step: GetReadyStepKey, done: boolean) {
    switch (step) {
      case "welcome_video":
        return <StepWelcome done={done} saving={saving === step} onDone={() => void markDone(step)} />;
      case "check_computer":
        return <StepComputer hasWindowsPc={hasWindowsPc} noComputerWhatsappUrl={noComputerWhatsappUrl} />;
      case "install_software":
        return <StepSoftware track={track} solidworksWhatsappUrl={solidworksWhatsappUrl} />;
      case "essential_actions":
        return (
          <StepActions
            track={track}
            ticked={tickedSubItems(step, keys)}
            disabled={loadState === "not_set_up"}
            onTick={(sub, c) => void tick(step, sub, c)}
          />
        );
      case "practice_upload":
        return <StepPractice userId={userId} track={track} done={done} onResult={onPractice} />;
      case "try_test_screen":
        return <StepDemo done={done} onDone={() => void markDone(step)} />;
      case "test_day_checklist":
        return (
          <StepChecklist
            ticked={tickedSubItems(step, keys)}
            disabled={loadState === "not_set_up"}
            onTick={(sub, c) => void tick(step, sub, c)}
          />
        );
    }
  }

  return (
    <div className="space-y-6">
      {loadState === "error" ? (
        <Alert tone="warning" title={t("errors.loadTitle")}>
          {t("errors.loadBody")}
        </Alert>
      ) : null}
      {loadState === "not_set_up" ? (
        <Alert tone="info" title={t("errors.notSetUpTitle")}>
          {t("errors.notSetUpBody")}
        </Alert>
      ) : null}

      {status.complete ? (
        <section className="neu space-y-4 p-6 sm:p-8" aria-labelledby="cc-get-ready-done">
          <div className="flex items-start gap-3">
            <PartyPopper aria-hidden="true" strokeWidth={1.5} className="h-10 w-10 shrink-0 text-buy rtl:-scale-x-100" />
            <div>
              <h2 id="cc-get-ready-done" ref={celebrationRef} tabIndex={-1} className="text-2xl font-extrabold text-heading focus-visible:outline-none">
                {t("celebration.title")}
              </h2>
              <p className="mt-1 max-w-2xl text-base text-body">{t("celebration.body")}</p>
              {!status.done.has("try_test_screen") ? <p className="mt-2 text-sm text-body">{t("celebration.optionalLeft")}</p> : null}
            </div>
          </div>
          <Button asChild>
            <Link href={testHref}>
              {t("celebration.cta")}
              <ArrowRight aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 rtl:-scale-x-100" />
            </Link>
          </Button>
        </section>
      ) : bypass ? (
        <Alert
          tone="info"
          title={t("gate.bypassed")}
          action={
            <Button asChild size="sm">
              <Link href={testHref}>{t("celebration.bypassedCta")}</Link>
            </Button>
          }
        >
          {t("celebration.bypassed")}
        </Alert>
      ) : null}

      <section className="neu space-y-3 p-6" aria-labelledby="cc-get-ready-progress">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="cc-get-ready-progress" className="kicker">
            {t("progress.label")}
          </h2>
          <p className="text-2xl font-extrabold text-heading">{t("progress.percent", { percent: String(status.percent) })}</p>
        </div>
        <div
          role="progressbar"
          aria-label={t("progress.aria")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={status.percent}
          className="h-3 w-full overflow-hidden rounded-full bg-panel"
        >
          <div className="h-full rounded-full bg-accent transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${status.percent}%` }} />
        </div>
        <p className="text-sm text-body">{t("progress.remaining", { count: remaining })}</p>
      </section>

      <ol aria-label={t("list.label")} className="space-y-3">
        {GET_READY_STEPS.map((def, index) => {
          const done = status.done.has(def.key);
          const open = openKey === def.key;
          const ticks = def.subItems.length > 0 ? tickedSubItems(def.key, keys).size : 0;
          const inProgress = !done && ticks > 0;
          const panelId = `cc-gr-panel-${def.key}`;
          const Icon = done ? CheckCircle2 : open ? CircleDot : Circle;
          const showMarkDone = !done && MANUALLY_MARKABLE.includes(def.key) && def.key !== "welcome_video";
          return (
            <li key={def.key} className={cn("neu overflow-hidden", open && "ring-1 ring-accent")}>
              <h3>
                <button
                  ref={(el) => {
                    headerRefs.current[def.key] = el;
                  }}
                  type="button"
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => setOpenKey(open ? null : def.key)}
                  className="flex w-full items-start gap-3 p-5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent sm:p-6"
                >
                  <Icon
                    aria-hidden="true"
                    strokeWidth={1.75}
                    className={cn("mt-0.5 h-6 w-6 shrink-0", done ? "text-buy" : open ? "text-accent" : "text-mutedtext")}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-body">{t("list.stepNumber", { n: String(index + 1) })}</span>
                    <span className="block text-base font-extrabold text-heading sm:text-lg">{t(`steps.${def.key}.title`)}</span>
                    <span className="mt-1 block text-sm text-body">{t(`steps.${def.key}.purpose`)}</span>
                    <span className="mt-2 flex flex-wrap gap-2">
                      {done ? (
                        <StatusChip tone="success">{t("list.done")}</StatusChip>
                      ) : inProgress ? (
                        <StatusChip tone="info">{t("list.inProgress")}</StatusChip>
                      ) : (
                        <StatusChip tone="neutral">{t("list.notStarted")}</StatusChip>
                      )}
                      <StatusChip tone={def.required ? "warning" : "neutral"}>{def.required ? t("list.required") : t("list.optional")}</StatusChip>
                      <StatusChip tone="neutral">{t("list.estimate", { minutes: String(def.minutes) })}</StatusChip>
                    </span>
                  </span>
                  <ChevronDown
                    aria-hidden="true"
                    strokeWidth={1.75}
                    className={cn("mt-1 h-5 w-5 shrink-0 text-body transition-transform motion-reduce:transition-none", open && "rotate-180")}
                  />
                  <span className="sr-only">{open ? t("list.close") : t("list.open")}</span>
                </button>
              </h3>
              {open ? (
                <div id={panelId} className="space-y-5 border-t border-border px-5 pb-6 pt-5 sm:px-6">
                  {stepBody(def.key, done)}
                  <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <HelpLink slug={STEP_HELP_SLUG[def.key]}>{t("list.helpLink")}</HelpLink>
                    {showMarkDone ? (
                      <Button type="button" onClick={() => void markDone(def.key)} loading={saving === def.key} loadingText={t("list.saving")}>
                        {t("list.markDone")}
                      </Button>
                    ) : !done && !MANUALLY_MARKABLE.includes(def.key) ? (
                      <p className="text-sm text-body">{t("list.auto")}</p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
