"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Megaphone } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { retryFailedAction } from "@/app/[locale]/cad-champions/admin/operations/actions";
import { Alert, Button, EmptyState, StatusChip, useToast, type ChipTone } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import type { AnnouncementRow } from "@/lib/cad-champions/admin/announcements-server";
import { formatDateTime, formatNumber } from "@/lib/cad-champions/format";

import { runSendLoop } from "./send-loop";

const TONE: Record<AnnouncementRow["status"], ChipTone> = { draft: "neutral", sending: "info", sent: "success", failed: "danger" };

export function AnnouncementHistory({ rows }: { rows: AnnouncementRow[] }) {
  const t = useTranslations("CC.admin.operations.announcements");
  const tc = useTranslations("CC.admin.common");
  const locale = useLocale() as Locale;
  const toast = useToast();
  const router = useRouter();
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [live, setLive] = React.useState<Record<string, { sent: number; failed: number; pending: number }>>({});
  const [note, setNote] = React.useState<string | null>(null);

  async function resume(id: string, retryFirst: boolean) {
    setBusyId(id);
    setNote(null);
    try {
      if (retryFirst) {
        const r = await retryFailedAction(id);
        if (!r.ok) {
          toast.error(tc(`errors.${r.error}`));
          return;
        }
      }
      const out = await runSendLoop(id, (p) => setLive((l) => ({ ...l, [id]: { sent: p.sent, failed: p.failed, pending: p.pending } })), () => false);
      if (out.state === "done") toast.success(t("progress.doneToast", { sent: formatNumber(out.progress.sent, locale) }));
      else if (out.state === "error") setNote(out.error === "no_resend_key" ? t("progress.noKey") : t("progress.error"));
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) return <EmptyState icon={Megaphone} title={t("history.empty.title")} description={t("history.empty.body")} />;

  return (
    <div className="space-y-3">
      {note ? <Alert tone="error" title={note} /> : null}
      <div className="neu-inset overflow-x-auto p-1">
        <table className="w-full min-w-[44rem] border-separate border-spacing-0 text-start text-sm">
          <caption className="sr-only">{t("history.heading")}</caption>
          <thead>
            <tr className="text-xs uppercase tracking-wide text-mutedtext rtl:normal-case rtl:tracking-normal">
              {(["subject", "kind", "status", "recipients", "sent", "failed", "created"] as const).map((c) => (
                <th key={c} scope="col" className="px-3 py-2 text-start font-semibold">
                  {t(`history.cols.${c}`)}
                </th>
              ))}
              <th scope="col" className="px-3 py-2">
                <span className="sr-only">{t("history.cols.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const l = live[r.id];
              const sent = l?.sent ?? r.sent;
              const failed = l?.failed ?? r.failed;
              const pending = l?.pending ?? r.pending;
              const busy = busyId === r.id;
              return (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="max-w-[16rem] px-3 py-3">
                    <p className="truncate font-semibold text-ink" dir="ltr">
                      {r.subjectEn}
                    </p>
                    <p className="truncate text-body" dir="rtl">
                      {r.subjectAr}
                    </p>
                  </td>
                  <td className="px-3 py-3">{t(`history.kind.${r.kind}`)}</td>
                  <td className="px-3 py-3">
                    <StatusChip tone={TONE[r.status]}>{t(`history.status.${r.status}`)}</StatusChip>
                  </td>
                  <td className="px-3 py-3 tabular-nums">{formatNumber(r.recipients, locale)}</td>
                  <td className="px-3 py-3 tabular-nums">{formatNumber(sent, locale)}</td>
                  <td className="px-3 py-3 tabular-nums">{formatNumber(failed, locale)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-body">{formatDateTime(r.createdAt, locale)}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col items-start gap-2">
                      {r.status === "sending" || pending > 0 ? (
                        <Button size="sm" variant="secondary" loading={busy} loadingText={t("actions.sending")} onClick={() => resume(r.id, false)}>
                          {t("history.continue")}
                        </Button>
                      ) : null}
                      {failed > 0 ? (
                        <Button size="sm" variant="ghost" loading={busy} loadingText={t("history.retrying")} onClick={() => resume(r.id, true)}>
                          {t("history.retry", { count: formatNumber(failed, locale) })}
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
