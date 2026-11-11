"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { UserX } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { approveDeletionAction, cleanFilesAction, rejectDeletionAction } from "@/app/[locale]/cad-champions/admin/operations/deletions/actions";
import { textareaCls } from "@/components/cad-champions/admin/fields";
import { Alert, Button, ConfirmDialog, EmptyState, StatusChip, useToast, type ChipTone } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import type { DeletionView } from "@/lib/cad-champions/admin/deletion-server";
import { formatDateTime, formatNumber } from "@/lib/cad-champions/format";
import { Ltr } from "@/lib/cad-champions/ltr";

const TONE: Record<DeletionView["status"], ChipTone> = { pending: "warning", approved: "success", rejected: "neutral" };

export function DeletionList({ pending, processed }: { pending: DeletionView[]; processed: DeletionView[] }) {
  const t = useTranslations("CC.admin.operations.deletions");
  const tc = useTranslations("CC.admin.common");
  const locale = useLocale() as Locale;
  const toast = useToast();
  const router = useRouter();
  const [notes, setNotes] = React.useState<Record<string, string>>({});
  const [confirm, setConfirm] = React.useState<DeletionView | null>(null);
  const [rejecting, setRejecting] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [alert, setAlert] = React.useState<{ tone: "success" | "warning"; text: string } | null>(null);

  const who = (r: DeletionView) => r.name || r.email || r.userId.slice(0, 8);

  function filesMessage(r: { deleted: number; incomplete: boolean }, key: "approved" | "filesRetried") {
    return r.incomplete ? t("result.partial", { deleted: formatNumber(r.deleted, locale) }) : t(`result.${key}`, { deleted: formatNumber(r.deleted, locale) });
  }

  async function approve(row: DeletionView) {
    const res = await approveDeletionAction({ id: row.id, note: notes[row.id] });
    setConfirm(null);
    if (!res.ok) {
      toast.error(tc(`errors.${res.error}`));
      return;
    }
    const msg = filesMessage(res.data, "approved");
    setAlert({ tone: res.data.incomplete ? "warning" : "success", text: msg });
    toast.success(msg);
    router.refresh();
  }

  async function reject(row: DeletionView) {
    const note = (notes[row.id] ?? "").trim();
    if (!note) {
      toast.error(t("reject.noteRequired"));
      return;
    }
    setBusy(row.id);
    try {
      const res = await rejectDeletionAction({ id: row.id, note });
      if (!res.ok) {
        toast.error(tc(`errors.${res.error}`));
        return;
      }
      toast.success(t("result.rejected"));
      setRejecting(null);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function retryFiles(row: DeletionView) {
    setBusy(row.id);
    try {
      const res = await cleanFilesAction({ id: row.id });
      if (!res.ok) {
        toast.error(tc(`errors.${res.error}`));
        return;
      }
      const msg = filesMessage(res.data, "filesRetried");
      setAlert({ tone: res.data.incomplete ? "warning" : "success", text: msg });
      toast.success(msg);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-8">
      <Alert tone="info" title={t("gap.title")}>
        {t("gap.body")}
      </Alert>
      {alert ? <Alert tone={alert.tone} title={alert.text} /> : null}

      <section aria-labelledby="pending-heading" className="space-y-3">
        <h2 id="pending-heading" className="title-section">
          {t("pending.heading")}
        </h2>
        {pending.length === 0 ? (
          <EmptyState icon={UserX} title={t("pending.empty.title")} description={t("pending.empty.body")} />
        ) : (
          <ul className="space-y-4">
            {pending.map((r) => (
              <li key={r.id} className="neu space-y-4 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-base font-bold text-ink">{who(r)}</p>
                    {r.email ? (
                      <p className="text-sm text-body">
                        <Ltr>{r.email}</Ltr>
                      </p>
                    ) : null}
                    <p className="text-xs text-mutedtext">{t("requested", { date: formatDateTime(r.createdAt, locale) })}</p>
                  </div>
                  <StatusChip tone={TONE[r.status]}>{t(`status.${r.status}`)}</StatusChip>
                </div>
                <div>
                  <p className="text-xs font-semibold text-mutedtext">{t("reason")}</p>
                  <p className="whitespace-pre-wrap text-sm text-ink" dir="auto">
                    {r.reason || t("noReason")}
                  </p>
                </div>
                <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
                  {rejecting === r.id ? t("reject.note") : t("approve.note")}
                  <textarea
                    value={notes[r.id] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                    rows={2}
                    maxLength={1000}
                    className={textareaCls}
                    dir="auto"
                  />
                  <span className="text-xs font-normal text-mutedtext">{rejecting === r.id ? t("reject.noteHint") : t("approve.noteHint")}</span>
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="danger" onClick={() => setConfirm(r)} disabled={busy === r.id}>
                    {t("approve.button")}
                  </Button>
                  <span className="text-xs text-mutedtext">{t("retentionTodo")}</span>
                  {rejecting === r.id ? (
                    <>
                      <Button variant="secondary" onClick={() => reject(r)} loading={busy === r.id} loadingText={t("reject.working")}>
                        {t("reject.confirm")}
                      </Button>
                      <Button variant="ghost" onClick={() => setRejecting(null)}>
                        {tc("cancel")}
                      </Button>
                    </>
                  ) : (
                    <Button variant="secondary" onClick={() => setRejecting(r.id)}>
                      {t("reject.button")}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="processed-heading" className="space-y-3">
        <h2 id="processed-heading" className="title-section">
          {t("processed.heading")}
        </h2>
        {processed.length === 0 ? (
          <p className="text-sm text-mutedtext">{t("processed.empty")}</p>
        ) : (
          <ul className="space-y-3">
            {processed.map((r) => (
              <li key={r.id} className="neu-inset flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-bold text-ink">
                    {who(r)} <StatusChip tone={TONE[r.status]}>{t(`status.${r.status}`)}</StatusChip>
                  </p>
                  <p className="text-xs text-mutedtext">{r.processedAt ? t("processedAt", { date: formatDateTime(r.processedAt, locale) }) : null}</p>
                  {r.adminNote ? (
                    <p className="whitespace-pre-wrap text-sm text-body" dir="auto">
                      {t("adminNote")}: {r.adminNote}
                    </p>
                  ) : null}
                </div>
                {r.status === "approved" ? (
                  <Button size="sm" variant="ghost" onClick={() => retryFiles(r)} loading={busy === r.id} loadingText={t("processed.retrying")}>
                    {t("processed.retryFiles")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => (o ? undefined : setConfirm(null))}
        title={t("approve.confirmTitle", { name: confirm ? who(confirm) : "" })}
        consequence={t("approve.confirmBody")}
        confirmLabel={t("approve.confirmAction")}
        cancelLabel={tc("cancel")}
        tone="danger"
        onConfirm={() => (confirm ? approve(confirm) : undefined)}
      />
    </div>
  );
}
