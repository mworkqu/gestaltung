"use client";

// One payment in the admin queue (Prompt 10 Step D): zoomable proof (signed
// URL), payer, bank, reference code, transfer reference, expected amount,
// Approve (ConfirmDialog with the amount) / Reject (preset reasons + free
// text in both languages, shown to the student). Double approval is refused
// by the cc_payment_transition RPC; the UI shows "already handled".

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FileText, X, ZoomIn } from "lucide-react";

import { Alert, Button, ConfirmDialog, StatusChip, useToast, type ChipTone } from "@/components/cad-champions/ui";
import { approvePaymentAction, rejectPaymentAction } from "@/lib/cad-champions/payments/actions";
import { Ltr } from "@/lib/cad-champions/ltr";

export interface AdminPaymentCardData {
  id: string;
  status: string;
  statusLabel: string;
  tone: ChipTone;
  studentName: string;
  studentEmail: string | null;
  studentPhone: string | null;
  plan: string;
  cohort: string | null;
  amount: string;
  referenceCode: string;
  payerName: string | null;
  payerBank: string | null;
  transferReference: string | null;
  transferredAt: string | null;
  created: string;
  expires: string | null;
  rejectReason: string | null;
  proofUrl: string | null;
  proofIsPdf: boolean;
}

const PRESETS = ["not_received", "amount_wrong", "unreadable", "wrong_account", "no_code"] as const;
const field = "min-h-11 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function AdminPaymentCard({ p }: { p: AdminPaymentCardData }) {
  const t = useTranslations("CC.payments.admin");
  const toast = useToast();
  const router = useRouter();
  const [approveOpen, setApproveOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [showReject, setShowReject] = React.useState(false);
  const [preset, setPreset] = React.useState<string>("");
  const [reasonEn, setReasonEn] = React.useState("");
  const [reasonAr, setReasonAr] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const ids = { preset: React.useId(), en: React.useId(), ar: React.useId() };
  const actionable = p.status === "proof_submitted";

  function pickPreset(v: string) {
    setPreset(v);
    if (v && v !== "custom") {
      setReasonEn(t(`presets.${v}.en`));
      setReasonAr(t(`presets.${v}.ar`));
    }
  }

  async function approve() {
    setError(null);
    const res = await approvePaymentAction({ paymentId: p.id });
    setApproveOpen(false);
    if (!res.ok) {
      setError(t(`errors.${res.error}`));
      router.refresh();
      return;
    }
    toast.success(t("approved"), t("approvedBody"));
    router.refresh();
  }

  async function reject() {
    setError(null);
    const res = await rejectPaymentAction({ paymentId: p.id, reasonEn, reasonAr });
    setRejectOpen(false);
    if (!res.ok) {
      setError(t(`errors.${res.error}`));
      router.refresh();
      return;
    }
    toast.success(t("rejected"), t("rejectedBody"));
    setShowReject(false);
    router.refresh();
  }

  const facts: [string, React.ReactNode][] = [
    [t("expected"), <Ltr key="a" className="text-lg font-extrabold text-heading">{p.amount}</Ltr>],
    [t("reference"), <Ltr key="r" className="font-mono font-bold">{p.referenceCode}</Ltr>],
    [t("payer"), p.payerName ?? "-"],
    [t("bank"), p.payerBank ?? "-"],
    [t("transferRef"), p.transferReference ? <Ltr key="tr" className="font-mono">{p.transferReference}</Ltr> : "-"],
    [t("transferredAt"), p.transferredAt ?? "-"],
    [t("plan"), p.plan],
    ...(p.cohort ? ([[t("cohort"), p.cohort]] as [string, React.ReactNode][]) : []),
    [t("created"), p.created],
    ...(p.expires && p.status === "awaiting_transfer" ? ([[t("expires"), p.expires]] as [string, React.ReactNode][]) : []),
  ];

  return (
    <article className="neu grid grid-cols-1 gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]" aria-label={`${p.studentName} ${p.referenceCode}`}>
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-bold text-ink">{p.studentName}</p>
            <p className="text-sm text-body">
              {p.studentEmail ? <Ltr>{p.studentEmail}</Ltr> : null}
              {p.studentPhone ? (
                <>
                  {" · "}
                  <Ltr>{p.studentPhone}</Ltr>
                </>
              ) : null}
            </p>
          </div>
          <StatusChip tone={p.tone}>{p.statusLabel}</StatusChip>
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {facts.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-xs font-semibold text-mutedtext">{k}</dt>
              <dd className="break-words text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        {p.rejectReason ? <p className="text-sm text-body">{p.rejectReason}</p> : null}

        {error ? <Alert tone="error" title={error} /> : null}

        {actionable ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => setApproveOpen(true)}>{t("approve")}</Button>
              <Button variant="secondary" onClick={() => setShowReject((v) => !v)} aria-expanded={showReject}>
                {t("reject")}
              </Button>
            </div>
            {showReject ? (
              <div className="tile space-y-3">
                <div className="space-y-1">
                  <label htmlFor={ids.preset} className="text-sm font-semibold text-ink">
                    {t("reasonPreset")}
                  </label>
                  <select id={ids.preset} className={field} value={preset} onChange={(e) => pickPreset(e.target.value)}>
                    <option value="">{t("reasonPick")}</option>
                    {PRESETS.map((k) => (
                      <option key={k} value={k}>
                        {t(`presets.${k}.en`)}
                      </option>
                    ))}
                    <option value="custom">{t("reasonCustom")}</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label htmlFor={ids.en} className="text-sm font-semibold text-ink">
                    {t("reasonEn")}
                  </label>
                  <textarea id={ids.en} dir="ltr" rows={2} className={field} value={reasonEn} onChange={(e) => setReasonEn(e.target.value)} maxLength={500} />
                </div>
                <div className="space-y-1">
                  <label htmlFor={ids.ar} className="text-sm font-semibold text-ink">
                    {t("reasonAr")}
                  </label>
                  <textarea id={ids.ar} dir="rtl" lang="ar" rows={2} className={field} value={reasonAr} onChange={(e) => setReasonAr(e.target.value)} maxLength={500} />
                </div>
                <Button
                  variant="danger"
                  onClick={() => {
                    if (!reasonEn.trim() && !reasonAr.trim()) {
                      setError(t("reasonRequired"));
                      return;
                    }
                    setError(null);
                    setRejectOpen(true);
                  }}
                >
                  {t("reject")}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="min-w-0">
        <p className="mb-2 text-xs font-semibold text-mutedtext">{t("proof")}</p>
        {!p.proofUrl ? (
          <div className="neu-inset flex min-h-32 items-center justify-center p-4 text-sm text-body">{t("noProof")}</div>
        ) : p.proofIsPdf ? (
          <a href={p.proofUrl} target="_blank" rel="noopener noreferrer" className="tile flex min-h-11 items-center gap-2 font-semibold text-accent">
            <FileText aria-hidden="true" className="h-5 w-5" />
            {t("openPdf")}
          </a>
        ) : (
          <Dialog.Root>
            <Dialog.Trigger asChild>
              <button type="button" className="group relative block w-full overflow-hidden rounded-xl border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
                <img src={p.proofUrl} alt={t("zoomTitle")} className="max-h-72 w-full object-contain bg-panel" loading="lazy" />
                <span className="absolute bottom-2 end-2 inline-flex items-center gap-1 rounded-full bg-ink/80 px-2 py-1 text-xs font-semibold text-white">
                  <ZoomIn aria-hidden="true" className="h-3.5 w-3.5" />
                  {t("zoom")}
                </span>
              </button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-[70] bg-ink/70" />
              <Dialog.Content className="fixed inset-2 z-[80] flex flex-col gap-2 rounded-2xl bg-surface p-3 focus-visible:outline-none sm:inset-8">
                <div className="flex items-center justify-between gap-2">
                  <Dialog.Title className="font-bold text-ink">{t("zoomTitle")}</Dialog.Title>
                  <Dialog.Close asChild>
                    <button type="button" aria-label={t("close")} className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                      <X aria-hidden="true" className="h-5 w-5" />
                    </button>
                  </Dialog.Close>
                </div>
                <Dialog.Description className="sr-only">{p.referenceCode}</Dialog.Description>
                <div className="min-h-0 flex-1 overflow-auto">
                  {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
                  <img src={p.proofUrl} alt={t("zoomTitle")} className="mx-auto max-w-none" />
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        )}
      </div>

      <ConfirmDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        title={t("approveTitle")}
        consequence={t("approveBody", { amount: p.amount, code: p.referenceCode })}
        confirmLabel={t("approveConfirm")}
        onConfirm={approve}
      />
      <ConfirmDialog open={rejectOpen} onOpenChange={setRejectOpen} title={t("rejectTitle")} consequence={t("rejectBody")} confirmLabel={t("rejectConfirm")} tone="danger" onConfirm={reject} />
    </article>
  );
}
