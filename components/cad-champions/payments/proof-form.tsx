"use client";

// "I've made the transfer" (Prompt 10 Step D): payer name, bank (Qatar banks +
// Other), transfer reference, date/time and the screenshot (UploadBox ->
// private bucket cc-payment-proofs/{user}/{payment}/...). A ConfirmDialog
// before sending; the server re-checks everything and moves the payment to
// proof_submitted.

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { UploadBox, type UploadedFile } from "@/components/cad-champions/upload/upload-box";
import { Alert, Button, ConfirmDialog, HelpTip, useToast } from "@/components/cad-champions/ui";
import { submitProofAction } from "@/lib/cad-champions/payments/actions";
import { QATAR_BANKS } from "@/lib/cad-champions/payments/banks";

const field = "min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-base text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** "2026-10-14T09:30" in the browser's local time (the student's phone is in Qatar time). */
function nowLocalInput(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
}

export function ProofForm({ paymentId, userId, onSent }: { paymentId: string; userId: string; onSent?: () => void }) {
  const t = useTranslations("CC.payments.proof");
  const tBanks = useTranslations("CC.payments.banks");
  const toast = useToast();
  const router = useRouter();
  const [payerName, setPayerName] = React.useState("");
  const [bank, setBank] = React.useState("");
  const [bankOther, setBankOther] = React.useState("");
  const [reference, setReference] = React.useState("");
  const [when, setWhen] = React.useState("");
  const [file, setFile] = React.useState<UploadedFile | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const ids = { name: React.useId(), bank: React.useId(), other: React.useId(), ref: React.useId(), when: React.useId() };

  React.useEffect(() => {
    setWhen(nowLocalInput());
  }, []);

  function precheck(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (payerName.trim().length < 2) return setError(t("errors.invalid_name"));
    if (!bank || (bank === "other" && bankOther.trim().length < 2)) return setError(t("errors.invalid_bank"));
    if (!reference.trim()) return setError(t("errors.invalid_reference"));
    if (!when) return setError(t("errors.invalid_date"));
    if (uploading) return setError(t("waitUpload"));
    if (!file) return setError(t("needFile"));
    setConfirmOpen(true);
  }

  async function send() {
    if (!file) return;
    const res = await submitProofAction({
      paymentId,
      proofPath: file.path,
      payerName,
      payerBank: bank,
      payerBankOther: bank === "other" ? bankOther : null,
      transferReference: reference,
      transferredAt: new Date(when).toISOString(),
    });
    setConfirmOpen(false);
    if (!res.ok) {
      setError(t(`errors.${res.error}`));
      return;
    }
    toast.success(t("sent"), t("sentBody"));
    onSent?.();
    router.refresh();
  }

  return (
    <form onSubmit={precheck} className="space-y-4" noValidate>
      <div className="space-y-1">
        <div className="flex items-center gap-1">
          <label htmlFor={ids.name} className="text-sm font-semibold text-ink">
            {t("payerName")}
          </label>
          <HelpTip label={t("payerName")}>{t("payerNameHelp")}</HelpTip>
        </div>
        <input id={ids.name} className={field} value={payerName} onChange={(e) => setPayerName(e.target.value)} autoComplete="name" maxLength={120} required />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor={ids.bank} className="text-sm font-semibold text-ink">
            {t("bank")}
          </label>
          <select id={ids.bank} className={field} value={bank} onChange={(e) => setBank(e.target.value)} required>
            <option value="">{t("bankPlaceholder")}</option>
            {QATAR_BANKS.map((b) => (
              <option key={b} value={b}>
                {tBanks(b)}
              </option>
            ))}
          </select>
        </div>
        {bank === "other" ? (
          <div className="space-y-1">
            <label htmlFor={ids.other} className="text-sm font-semibold text-ink">
              {t("bankOther")}
            </label>
            <input id={ids.other} className={field} value={bankOther} onChange={(e) => setBankOther(e.target.value)} maxLength={80} required />
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <label htmlFor={ids.ref} className="text-sm font-semibold text-ink">
              {t("reference")}
            </label>
            <HelpTip label={t("reference")}>{t("referenceHelp")}</HelpTip>
          </div>
          <input id={ids.ref} dir="ltr" className={field} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} required />
        </div>
        <div className="space-y-1">
          <label htmlFor={ids.when} className="text-sm font-semibold text-ink">
            {t("date")}
          </label>
          <input id={ids.when} type="datetime-local" dir="ltr" className={field} value={when} onChange={(e) => setWhen(e.target.value)} required />
        </div>
      </div>

      <div className="space-y-1">
        <UploadBox
          accept="proof"
          maxBytes={10 * 1024 * 1024}
          bucket="cc-payment-proofs"
          pathPrefix={`${userId}/${paymentId}/`}
          label={t("screenshot")}
          onUploaded={(f) => setFile(f)}
          onBusyChange={setUploading}
        />
        <p className="text-xs text-body">{t("screenshotHelp")}</p>
      </div>

      {error ? <Alert tone="error" title={error} /> : null}

      <Button type="submit" disabled={uploading}>
        {t("submit")}
      </Button>

      <ConfirmDialog open={confirmOpen} onOpenChange={setConfirmOpen} title={t("confirmTitle")} consequence={t("confirmBody")} confirmLabel={t("confirmButton")} onConfirm={send} />
    </form>
  );
}
