"use client";

// Buy ideation tokens or the Maker Pass with Fawran (owner, 2026-10-18):
// pick a pack / the pass → POST /api/billing/checkout (the server sets the
// amount) → FawranCheckout (send, upload the screenshot, checked automatically).

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { FawranCheckout, type OpenPayment } from "@/components/payments/fawran-checkout";
import { cn } from "@/lib/utils";

type Pack = { id: string; tokens: number; qar: number };

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
  const [open, setOpen] = useState<OpenPayment | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const label = (id: string) =>
    id === pass.id
      ? t("product_maker_pass", { days: String(pass.days) })
      : t("product_tokens", { n: String(packs.find((p) => p.id === id)?.tokens ?? "") });

  async function start(product: string) {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ product }),
      });
      const body = (await res.json().catch(() => ({}))) as { payment?: OpenPayment; error?: string };
      if (!res.ok || !body.payment) setProblem(body.error === "not_configured" ? t("notConfigured") : t("failed"));
      else setOpen(body.payment);
    } catch {
      setProblem(t("failed"));
    }
    setBusy(false);
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
      {open && <FawranCheckout payment={open} productLabel={label(open.product)} onClose={() => setOpen(null)} />}
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
