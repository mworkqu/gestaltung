"use client";

import * as React from "react";
import { CheckCircle2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Alert, Button, ConfirmDialog, StatusChip } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import type { PublishCheckResult, PublishIssue } from "@/lib/cad-champions/admin/publish-check";
import { formatNumber } from "@/lib/cad-champions/format";
import { Ltr } from "@/lib/cad-champions/ltr";

import { setExercisePublishedAction } from "@/app/[locale]/cad-champions/admin/exercises/actions";
import { setTestPublishedAction } from "@/app/[locale]/cad-champions/admin/tests/actions";

import { useAdminAction, type AnyResult } from "./use-admin-action";

// Publish / unpublish with the blocking list (Prompt 11 Step B). The server
// action runs the same checks again; warnings never block.

export function IssueList({ issues, tone }: { issues: PublishIssue[]; tone: "block" | "warn" }) {
  const t = useTranslations("CC.admin.tests");
  const locale = useLocale() as Locale;
  return (
    <ul className="flex list-disc flex-col gap-1 ps-5 text-sm text-ink">
      {issues.map((i, idx) => {
        const params: Record<string, string> = {};
        for (const [k, v] of Object.entries(i.params ?? {})) params[k] = typeof v === "number" ? formatNumber(v, locale, { maximumFractionDigits: 2 }) : String(v);
        const text = t(`issues.${i.code}`, params);
        return (
          <li key={`${tone}-${idx}`}>
            {i.task != null ? <span className="font-semibold">{t("issues.taskPrefix", { n: formatNumber(i.task, locale) })} </span> : null}
            {i.code === "bad_expectation" ? (
              <>
                {text} <Ltr>{String(i.params?.pattern ?? "")}</Ltr>
              </>
            ) : (
              text
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function PublishPanel({ published, checks, noun, id }: { published: boolean; checks: PublishCheckResult; noun: "test" | "exercise"; id: string }) {
  const t = useTranslations("CC.admin.tests");
  const tc = useTranslations("CC.admin.common");
  const { run, busy } = useAdminAction();
  const [confirm, setConfirm] = React.useState(false);

  async function toggle(publish: boolean) {
    const call = (): Promise<AnyResult> => (noun === "test" ? setTestPublishedAction({ testId: id, publish }) : setExercisePublishedAction({ id, publish }));
    const res = await run(call, {
      success: publish ? t(`publish.${noun}Published`) : t(`publish.${noun}Unpublished`),
      successBody: publish ? t(`publish.${noun}PublishedBody`) : t(`publish.${noun}UnpublishedBody`),
    });
    if (res) setConfirm(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <StatusChip tone={published ? "success" : "neutral"}>{published ? tc("published") : tc("draft")}</StatusChip>
        {published ? (
          <Button variant="secondary" onClick={() => setConfirm(true)} loading={busy}>
            {tc("unpublish")}
          </Button>
        ) : (
          <Button onClick={() => toggle(true)} loading={busy} disabled={!checks.canPublish} disabledReason={checks.canPublish ? undefined : t("publish.blockedReason")}>
            {tc("publish")}
          </Button>
        )}
      </div>

      {!published && checks.blocking.length > 0 ? (
        <Alert tone="error" title={t("publish.blockedTitle", { count: checks.blocking.length })}>
          <IssueList issues={checks.blocking} tone="block" />
        </Alert>
      ) : null}
      {!published && checks.blocking.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-buy">
          <CheckCircle2 aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
          {t("publish.ready")}
        </p>
      ) : null}
      {checks.warnings.length > 0 ? (
        <Alert tone="warning" title={t("publish.warningsTitle")}>
          <IssueList issues={checks.warnings} tone="warn" />
        </Alert>
      ) : null}

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t(`publish.${noun}UnpublishTitle`)}
        consequence={t(`publish.${noun}UnpublishBody`)}
        confirmLabel={tc("unpublish")}
        cancelLabel={tc("cancel")}
        tone="danger"
        loading={busy}
        onConfirm={() => toggle(false)}
      />
    </div>
  );
}
