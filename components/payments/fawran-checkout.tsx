"use client";

// One open Fawran payment (0089): send the amount with the reference code in
// the note, upload the confirmation screenshot (payment-proofs/<userId>/…) →
// POST /api/billing/proof: checked automatically, granted at once, or "needs
// review" with the reasons. Used for token packs, the Maker Pass and the
// engineer services. Copy: the "Tokens" namespace.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCircle2, Clock, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PAYMENT_DETAILS } from "@/lib/company";
import { loadSupabase } from "@/lib/supabase/lazy";
import { cn } from "@/lib/utils";
import { BUCKETS } from "@/lib/storage/paths";

export type OpenPayment = { id: string; reference_code: string; amount_qar: number; product: string };
type Result = { status: "approved" | "needs_review"; reasons: string[] };

const MAX_BYTES = 8 * 1024 * 1024;

export function FawranCheckout({
  payment,
  productLabel,
  onClose,
  children,
}: {
  payment: OpenPayment;
  productLabel: string;
  onClose: () => void;
  /** Extra lines under the title (e.g. a service's price breakdown). */
  children?: React.ReactNode;
}) {
  const t = useTranslations("Tokens");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    if (!/^image\/(png|jpeg)$/.test(file.type) || file.size > MAX_BYTES) {
      setProblem(t("fileType"));
      return;
    }
    setBusy(true);
    setProblem(null);
    setResult(null);
    try {
      const db = await loadSupabase();
      const { data: auth } = await db.auth.getUser();
      if (!auth.user) throw new Error("sign_in");
      const ext = file.type === "image/png" ? "png" : "jpg";
      const path = `${auth.user.id}/${payment.id}-${Date.now()}.${ext}`;
      const { error } = await db.storage.from(BUCKETS.paymentProofs).upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      const res = await fetch("/api/billing/proof", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paymentId: payment.id, path }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<Result> & { error?: string };
      if (!res.ok || !body.status) setProblem(body.error === "not_configured" ? t("notConfigured") : t("failed"));
      else {
        setResult({ status: body.status, reasons: body.reasons ?? [] });
        router.refresh();
      }
    } catch {
      setProblem(t("failed"));
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="space-y-4 rounded-2xl bg-panel p-5 shadow-neu-inset" data-testid="fawran-checkout" aria-live="polite">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold text-heading">{t("checkoutTitle")}</h2>
        <p className="text-sm text-mutedtext">{t("checkoutFor", { product: productLabel })}</p>
      </div>
      {children}
      <ol className="list-decimal space-y-2 ps-5 text-sm leading-relaxed text-body">
        <li>{t("step1", { qar: String(Number(payment.amount_qar)), alias: PAYMENT_DETAILS.fawranAlias })}</li>
        <li>{t("step2", { code: payment.reference_code })}</li>
        <li>{t("step3")}</li>
      </ol>
      <p className="inline-block rounded-xl bg-surface px-4 py-2 font-mono text-lg font-bold tracking-wider text-heading shadow-neu-sm" dir="ltr">
        {payment.reference_code}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg"
          className="sr-only"
          id={`fawran-proof-${payment.id}`}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
        <Button asChild disabled={busy}>
          <label htmlFor={`fawran-proof-${payment.id}`} className={cn("cursor-pointer", busy && "pointer-events-none opacity-60")}>
            <Upload className="me-2 h-4 w-4" aria-hidden />
            {busy ? t("uploading") : result?.status === "needs_review" ? t("tryAgain") : t("upload")}
          </label>
        </Button>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          {t("cancel")}
        </Button>
      </div>
      {result?.status === "approved" && (
        <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700" role="status">
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          {t("approved")}
        </p>
      )}
      {result?.status === "needs_review" && (
        <div className="space-y-1 text-sm" role="status">
          <p className="flex items-center gap-2 font-semibold text-heading">
            <Clock className="h-4 w-4 text-amber-600" aria-hidden />
            {t("needsReview")}
          </p>
          {result.reasons.length > 0 && (
            <p className="text-mutedtext">{t("reasons", { list: result.reasons.map((r) => t(`reason_${r}`)).join(" · ") })}</p>
          )}
        </div>
      )}
      {problem && <p className="text-sm font-medium text-destructive">{problem}</p>}
    </div>
  );
}
