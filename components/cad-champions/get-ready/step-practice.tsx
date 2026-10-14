"use client";

import * as React from "react";
import { Box, PartyPopper } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { UploadBox, type UploadedFile } from "@/components/cad-champions/upload/upload-box";
import { Alert, Button, Spinner, Term } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import type { CcTrackSoftware } from "@/lib/cad-champions/db/types";
import { gradePracticeAction, type PracticeResult } from "@/lib/cad-champions/get-ready/actions";
import { EXPORT_STEP_HELP, PRACTICE_BUCKET, PRACTICE_PASS_RULES, actionSoftwareFor } from "@/lib/cad-champions/get-ready/content";

import { HelpLink, SubHeading } from "./shared";

type View =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "passed"; basicOnly?: boolean }
  | { kind: "failed"; message: string; helpSlug: string | null }
  | { kind: "unavailable"; path: string }
  | { kind: "error" };

export function StepPractice({
  userId,
  track,
  done,
  onResult,
}: {
  userId: string;
  track: CcTrackSoftware | null;
  done: boolean;
  /** Called with every server answer (the hub updates progress, toasts on errors). */
  onResult: (result: PracticeResult) => void;
}) {
  const t = useTranslations("CC.get-ready");
  const locale = useLocale() as Locale;
  const [view, setView] = React.useState<View>(done ? { kind: "passed" } : { kind: "idle" });

  async function grade(path: string) {
    setView({ kind: "checking" });
    try {
      const result = await gradePracticeAction(path, locale);
      onResult(result);
      if (result.ok && result.outcome === "passed") setView({ kind: "passed", basicOnly: result.basicCheckOnly });
      else if (result.ok && result.outcome === "failed") setView({ kind: "failed", message: result.message, helpSlug: result.helpSlug });
      else if (!result.ok && result.reason === "unavailable") setView({ kind: "unavailable", path });
      else setView({ kind: "error" });
    } catch (e) {
      console.error("[cc-get-ready] practice grade failed:", e instanceof Error ? e.message : e);
      setView({ kind: "error" });
    }
  }

  function onUploaded(file: UploadedFile) {
    void grade(file.path);
  }

  return (
    <div className="space-y-5">
      <div className="tile space-y-3">
        <div className="flex items-center gap-2">
          <Box aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 text-accent" />
          <SubHeading>{t("practice.taskTitle")}</SubHeading>
        </div>
        <p className="text-base font-bold text-ink">{t("practice.task")}</p>
        <p className="text-sm text-body">{t("practice.untimed")}</p>
        <div>
          <p className="text-sm font-semibold text-ink">{t("practice.rulesTitle")}</p>
          <ul className="mt-1 list-disc space-y-1 ps-5 text-sm text-body">
            {PRACTICE_PASS_RULES.map((r) => (
              <li key={r}>
                {t(`practice.rules.${r}`)}
                {r === "single" ? (
                  <>
                    {" "}
                    <Term id="solid-body" />
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-body">{t("practice.stubNote")}</p>
      </div>

      <UploadBox
        accept="step"
        bucket={PRACTICE_BUCKET}
        pathPrefix={`${userId}/practice/`}
        onUploaded={onUploaded}
        disabled={view.kind === "checking"}
        stepHelpSlug={EXPORT_STEP_HELP[actionSoftwareFor(track)]}
      />

      {view.kind === "checking" ? <Spinner label={t("practice.checking")} /> : null}

      {view.kind === "passed" ? (
        <div role="status" className="flex items-start gap-3 rounded-2xl border border-buy/20 bg-buy-bg p-4">
          <PartyPopper aria-hidden="true" strokeWidth={1.75} className="mt-0.5 h-6 w-6 shrink-0 text-buy rtl:-scale-x-100" />
          <div>
            <p className="text-base font-extrabold text-ink">{t("practice.passTitle")}</p>
            <p className="mt-1 text-sm text-body">{t("practice.passBody")}</p>
            {view.basicOnly ? <p className="mt-1 text-xs text-body">{t("practice.basicCheckOnly")}</p> : null}
          </div>
        </div>
      ) : null}

      {view.kind === "failed" ? (
        <Alert tone="error" title={t("practice.failTitle")}>
          <p>{view.message}</p>
          <p className="mt-1">{t("practice.tryAgain")}</p>
          {view.helpSlug ? <HelpLink slug={view.helpSlug}>{t("practice.failHelp")}</HelpLink> : null}
        </Alert>
      ) : null}

      {view.kind === "unavailable" ? (
        <Alert
          tone="warning"
          title={t("practice.unavailableTitle")}
          action={
            <Button type="button" variant="secondary" size="sm" onClick={() => void grade(view.path)}>
              {t("practice.retryCheck")}
            </Button>
          }
        >
          {t("practice.unavailableBody")}
        </Alert>
      ) : null}

      {view.kind === "error" ? (
        <Alert tone="error" title={t("practice.errorTitle")}>
          {t("practice.errorBody")}
        </Alert>
      ) : null}
    </div>
  );
}
