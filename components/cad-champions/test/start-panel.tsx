"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, Lock, PlayCircle, Timer } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Alert, Button, ConfirmDialog, useToast } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { CC_EVENTS, track } from "@/lib/cad-champions/analytics";
import { formatDate, formatDateTime, formatNumber } from "@/lib/cad-champions/format";
import { ccPath } from "@/lib/cad-champions/routes";
import { startAttemptAction, type StartResult } from "@/lib/cad-champions/test/actions";

export type StartPanelState =
  | { kind: "start"; minutes: number | null }
  | { kind: "continue"; secondsLeft: number | null }
  | { kind: "cooldown"; retakeAt: number; days: number }
  | { kind: "locked"; reason: string; remaining: number };

export function StartPanel({
  slug,
  state,
  last,
}: {
  slug: string;
  state: StartPanelState;
  /** The previous finished attempt (shown as a small line with a status link). */
  last: { status: string; submittedAt: string | null } | null;
}) {
  const t = useTranslations("CC.test");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const toast = useToast();
  const attemptHref = ccPath(locale, `/test/${slug}/attempt`);

  const [rulesOk, setRulesOk] = React.useState(false);
  const [honourOk, setHonourOk] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<Exclude<StartResult, { ok: true }>["reason"] | null>(null);
  const [navigating, setNavigating] = React.useState(false);

  async function start() {
    setError(null);
    try {
      const res = await startAttemptAction(slug);
      if (res.ok) {
        track(CC_EVENTS.testStarted, { slug });
        setNavigating(true);
        setOpen(false);
        router.push(attemptHref);
        return;
      }
      setOpen(false);
      setError(res.reason);
      toast.error(t("startErrors.title"), t(`startErrors.${res.reason}`));
      if (res.reason === "cooldown" || res.reason === "locked") router.refresh();
    } catch (e) {
      console.error("[cc-test] start failed:", e instanceof Error ? e.message : e);
      setOpen(false);
      setError("error");
      toast.error(t("startErrors.title"), t("startErrors.error"));
    }
  }

  const lastLine = last ? (
    <p className="text-sm text-body">
      {last.submittedAt ? t("intro.lastSubmitted", { date: formatDateTime(last.submittedAt, locale) }) : t("intro.lastAttempt")}{" "}
      <Link href={attemptHref} className="font-semibold text-accent underline-offset-2 hover:underline">
        {t("intro.viewStatus")}
      </Link>
    </p>
  ) : null;

  if (state.kind === "continue") {
    const minutes = state.secondsLeft == null ? null : Math.ceil(state.secondsLeft / 60);
    return (
      <section className="neu space-y-4 p-6 sm:p-8" aria-labelledby="cc-test-continue">
        <div className="flex items-center gap-2">
          <Timer aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 text-accent" />
          <h2 id="cc-test-continue" className="text-xl font-extrabold text-heading">
            {t("intro.continueTitle")}
          </h2>
        </div>
        {minutes === 0 ? <p className="text-sm text-body">{t("intro.continueGrace")}</p> : null}
        <Button asChild>
          <Link href={attemptHref}>
            {minutes == null || minutes === 0
              ? t("intro.continueUntimed")
              : t("intro.continueTimed", { minutes, count: formatNumber(minutes, locale) })}
          </Link>
        </Button>
      </section>
    );
  }

  if (state.kind === "cooldown") {
    return (
      <section className="space-y-3" aria-label={t("intro.cooldownLabel")}>
        <Alert tone="info" title={t("intro.cooldownTitle", { date: formatDate(state.retakeAt, locale) })}>
          <span className="flex items-start gap-2">
            <CalendarClock aria-hidden="true" strokeWidth={1.75} className="mt-0.5 h-4 w-4 shrink-0" />
            {t("intro.cooldownBody", { days: formatNumber(state.days, locale) })}
          </span>
        </Alert>
        {lastLine}
      </section>
    );
  }

  if (state.kind === "locked") {
    return (
      <section className="space-y-3" aria-label={t("intro.lockedLabel")}>
        <Alert
          tone="warning"
          title={
            state.reason === "no_profile"
              ? t("intro.lockedNoProfile")
              : t("intro.locked", { count: state.remaining, n: formatNumber(state.remaining, locale) })
          }
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href={ccPath(locale, state.reason === "no_profile" ? "/onboarding" : "/get-ready")}>
                {state.reason === "no_profile" ? t("intro.lockedProfileLink") : t("intro.lockedLink")}
              </Link>
            </Button>
          }
        >
          {t("intro.lockedBody")}
        </Alert>
        <Button disabled disabledReason={t("intro.lockedShort", { n: formatNumber(state.remaining, locale) })}>
          <Lock aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
          {t("intro.start")}
        </Button>
      </section>
    );
  }

  const ready = rulesOk && honourOk;
  return (
    <section className="neu space-y-4 p-6 sm:p-8" aria-labelledby="cc-test-start-title">
      <h2 id="cc-test-start-title" className="text-xl font-extrabold text-heading">
        {t("intro.readyTitle")}
      </h2>
      {lastLine}
      <div className="space-y-2">
        <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm text-ink">
          <input
            type="checkbox"
            checked={rulesOk}
            onChange={(e) => setRulesOk(e.target.checked)}
            className="h-5 w-5 shrink-0 cursor-pointer rounded accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          {t("intro.agreeRules")}
        </label>
        <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm text-ink">
          <input
            type="checkbox"
            checked={honourOk}
            onChange={(e) => setHonourOk(e.target.checked)}
            className="h-5 w-5 shrink-0 cursor-pointer rounded accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          {t("intro.agreeHonour")}
        </label>
      </div>
      {error ? (
        <Alert tone="error" title={t("startErrors.title")}>
          {t(`startErrors.${error}`)}
        </Alert>
      ) : null}
      <Button
        onClick={() => setOpen(true)}
        disabled={!ready}
        disabledReason={t("intro.startNeedsChecks")}
        loading={navigating}
        loadingText={t("intro.opening")}
      >
        <PlayCircle aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
        {t("intro.start")}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("intro.startDialogTitle")}
        consequence={
          state.minutes != null
            ? t("intro.startDialogTimed", { minutes: formatNumber(state.minutes, locale) })
            : t("intro.startDialogUntimed")
        }
        confirmLabel={t("intro.startConfirm")}
        onConfirm={start}
      />
    </section>
  );
}
