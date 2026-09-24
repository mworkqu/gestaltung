"use client";

// "Request this item" (Task 18b, strongest demand signal): email, optional
// quantity and note. Free to press, on every product.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { BellPlus, Check, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const field =
  "w-full rounded-xl border border-white/60 bg-panel px-3 py-2 text-sm text-heading shadow-neu-inset focus:outline-none focus:ring-2 focus:ring-cobalt/60";

export function RequestItemButton({
  partId,
  partName,
  variant = "outline",
  size = "lg",
  className,
}: {
  partId: string;
  partName: string;
  variant?: "outline" | "default";
  size?: "sm" | "default" | "lg";
  className?: string;
}) {
  const t = useTranslations("Delivery");
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error" | "email">("idle");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setState("sending");
    const res = await fetch("/api/demand", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "request",
        partId,
        email: String(f.get("email") ?? "").trim(),
        quantity: Number(f.get("quantity") || 1),
        note: String(f.get("note") ?? ""),
        sourcePage: window.location.pathname,
      }),
    }).catch(() => null);
    if (res?.ok) setState("sent");
    else setState(res?.status === 400 ? "email" : "error");
  }

  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={() => setOpen(true)} className={cn("rounded-full", className)}>
        <BellPlus className="h-4 w-4" />
        {t("requestItem")}
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("requestTitle")}
            className="neu w-full max-w-md space-y-4 bg-surface p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-heading">{t("requestTitle")}</h2>
                <p className="mt-1 text-sm text-mutedtext">{partName}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label={t("close")} className="text-mutedtext hover:text-heading">
                <X className="h-5 w-5" />
              </button>
            </div>
            {state === "sent" ? (
              <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
                <Check className="h-4 w-4" />
                {t("requestSent")}
              </p>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                <p className="text-xs text-mutedtext">{t("requestHelp")}</p>
                <input name="email" type="email" required autoFocus placeholder={t("requestEmail")} className={field} dir="ltr" />
                <input name="quantity" type="number" min={1} defaultValue={1} placeholder={t("requestQty")} className={field} />
                <textarea name="note" rows={3} placeholder={t("requestNote")} className={cn(field, "resize-y")} />
                {state === "email" && <p className="text-sm text-destructive">{t("requestEmailError")}</p>}
                {state === "error" && <p className="text-sm text-destructive">{t("requestError")}</p>}
                <Button type="submit" disabled={state === "sending"} className="w-full rounded-full">
                  {state === "sending" && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t("requestSubmit")}
                </Button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
