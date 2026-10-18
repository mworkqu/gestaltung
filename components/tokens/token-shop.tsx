"use client";

// Buy ideation tokens or the Maker Pass with Fawran (owner, 2026-10-18):
//  1. pick a pack / the pass → POST /api/billing/checkout (the server sets the amount)
//  2. send the amount by Fawran with the reference code in the note
//  3. upload the confirmation screenshot (payment-proofs/<userId>/…) →
//     POST /api/billing/proof: checked automatically, granted at once, or
//     "needs review" with the reasons.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCircle2, Clock, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PAYMENT_DETAILS } from "@/lib/company";
import { loadSupabase } from "@/lib/supabase/lazy";
import { cn } from "@/lib/utils";

type Pack = { id: string; tokens: number; qar: number };
type Open = { id: string; reference_code: string; amount_qar: number; product: string };
type Result = { status: "approved" | "needs_review"; reasons: string[] };

const MAX_BYTES = 8 * 1024 * 1024;

export function TokenShop({
  locale,
  hasPass,
  packs,
  pass,
}: {
  locale: string;
  hasPass: boolean;
  packs: Pack[];
  pass: { id: string; qar: number; days: number };
}) {
  const t = useTranslations("Tokens");
  const router = useRouter();
  const [open, setOpen] = useState<Open | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const label = (id: string) =>
    id === pass.id
      ? t("product_maker_pass", { days: String(pass.days) })
      : t("product_tokens", { n: String(packs.find((p) => p.id === id)?.tokens ?? "") });

  async function start(product: string) {
    setBusy(true);
    setProblem(null);
    setResult(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ product }),
      });
      const body = (await res.json().catch(() => ({}))) as { payment?: Open; error?: string };
      if (!res.ok || !body.payment) setProblem(body.error === "not_configured" ? t("notConfigured") : t("failed"));
      else setOpen(body.payment);
    } catch {
      setProblem(t("failed"));
    }
    setBusy(false);
  }

  async function upload(file: File) {
    if (!open) return;
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
      const path = `${auth.user.id}/${open.id}-${Date.now()}.${ext}`;
      const { error } = await db.storage.from("payment-proofs").upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      const res = await fetch("/api/billing/proof", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paymentId: open.id, path }),
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
    <section className="neu space-y-5 p-6" data-testid="token-shop" lang={locale}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <BuyCard
          title={t("passTitle")}
          price={t("passPrice", { qar: String(pass.qar) })}
          action={hasPass ? t("passRenewBuy", { days: String(pass.days) }) : t("passBuy")}
          highlight
          disabled={busy}
          onClick={() => void start(pass.id)}
        />
        {packs.map((p) => (
          <BuyCard
            key={p.id}
            title={t("packLine", { tokens: String(p.tokens) })}
            price={t("packPrice", { qar: String(p.qar) })}
            action={t("packBuy")}
            disabled={busy}
            onClick={() => void start(p.id)}
          />
        ))}
      </div>

      {open && (
        <div className="space-y-4 rounded-2xl bg-panel p-5 shadow-neu-inset" data-testid="fawran-checkout" aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-bold text-heading">{t("checkoutTitle")}</h2>
            <p className="text-sm text-mutedtext">{t("checkoutFor", { product: label(open.product) })}</p>
          </div>
          <ol className="list-decimal space-y-2 ps-5 text-sm leading-relaxed text-body">
            <li>
              {t("step1", { qar: String(Number(open.amount_qar)), alias: PAYMENT_DETAILS.fawranAlias })}
            </li>
            <li>{t("step2", { code: open.reference_code })}</li>
            <li>{t("step3")}</li>
          </ol>
          <p className="inline-block rounded-xl bg-surface px-4 py-2 font-mono text-lg font-bold tracking-wider text-heading shadow-neu-sm" dir="ltr">
            {open.reference_code}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              id="fawran-proof"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
            />
            <Button asChild disabled={busy}>
              <label htmlFor="fawran-proof" className={cn("cursor-pointer", busy && "pointer-events-none opacity-60")}>
                <Upload className="me-2 h-4 w-4" aria-hidden />
                {busy ? t("uploading") : result?.status === "needs_review" ? t("tryAgain") : t("upload")}
              </label>
            </Button>
            <Button variant="ghost" onClick={() => setOpen(null)} disabled={busy}>
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
        </div>
      )}
      {problem && <p className="text-sm font-medium text-destructive">{problem}</p>}
    </section>
  );
}

function BuyCard({
  title,
  price,
  action,
  highlight,
  disabled,
  onClick,
}: {
  title: string;
  price: string;
  action: string;
  highlight?: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className={cn("tile flex flex-col gap-3 p-4", highlight && "ring-2 ring-cobalt/60")}>
      <div>
        <p className="text-sm font-bold text-heading">{title}</p>
        <p className="font-mono text-sm tabular-nums text-mutedtext rtl:font-sans">{price}</p>
      </div>
      <Button size="sm" variant={highlight ? "default" : "outline"} onClick={onClick} disabled={disabled} className="mt-auto">
        {action}
      </Button>
    </div>
  );
}
