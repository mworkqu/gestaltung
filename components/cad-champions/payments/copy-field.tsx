"use client";

// One "label: value [Copy]" row on the Pay step. Same pattern as the site's
// components/payment/payment-instructions.tsx copy button, plus a "Copied"
// toast. The value stays left-to-right inside Arabic text.

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";

import { useToast } from "@/components/cad-champions/ui";
import { Ltr } from "@/lib/cad-champions/ltr";
import { cn } from "@/lib/utils";

export function CopyField({ label, value, large = false, className }: { label: string; value: string; large?: boolean; className?: string }) {
  const t = useTranslations("CC.payments.pay");
  const toast = useToast();
  const [done, setDone] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value.replace(/\s+/g, " ").trim());
      setDone(true);
      toast.success(t("copied"), t("copiedBody", { what: label }));
      window.setTimeout(() => setDone(false), 1500);
    } catch {
      toast.error(t("copyFailed"));
    }
  }

  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-panel px-4 py-3", className)}>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-mutedtext">{label}</p>
        <Ltr className={cn("block break-all font-mono font-bold text-ink", large ? "text-2xl tracking-wider" : "text-sm")}>{value}</Ltr>
      </div>
      <button
        type="button"
        onClick={copy}
        aria-label={t("copy", { what: label })}
        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-semibold text-accent hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {done ? <Check aria-hidden="true" className="h-4 w-4 text-buy" /> : <Copy aria-hidden="true" className="h-4 w-4" />}
        <span>{done ? t("copied") : t("copy", { what: "" }).trim()}</span>
      </button>
    </div>
  );
}
