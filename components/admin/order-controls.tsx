"use client";

import { useEffect, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, Ban, FlaskConical, Loader2 } from "lucide-react";

import {
  advanceOrder,
  cancelOrder,
  setOrderTest,
  type OrderActionError,
  type OrderActionState,
} from "@/app/[locale]/dashboard/store/orders/actions";
import { Button } from "@/components/ui/button";
import { HintTip } from "@/components/ui/hint";
import { canCancel, canMarkTest, nextStepFor, nextStepLabel } from "@/lib/orders/admin-rules";
import { normaliseOrderStatus, type OrderStatus } from "@/lib/orders/status";
import { cn } from "@/lib/utils";

// Owner order controls (D3): status pill with a hint, the next-step button,
// and Mark as test / Cancel order. All writes are server actions that re-check
// super_admin and the rules; this file only shows the buttons.

const PILL: Record<OrderStatus, string> = {
  confirmed: "bg-panel text-heading",
  paid: "bg-inventory-bg text-inventory",
  sourcing: "bg-panel text-cobalt",
  shipped: "bg-panel text-cobalt",
  delivered: "bg-buy-bg text-buy",
  cancelled: "bg-panel text-destructive",
};

/** The status as a pill; hover, tap or focus shows what it means. */
export function OrderStatusPill({ status, className }: { status: string; className?: string }) {
  const t = useTranslations("PartsDashboard");
  const tA = useTranslations("OrdersAdmin");
  const s = normaliseOrderStatus(status) ?? "confirmed";
  return (
    <HintTip label={tA(`hint_${s}`)}>
      <span className={cn("rounded-full px-3 py-1 text-xs font-semibold shadow-neu-inset", PILL[s], className)}>
        {t(`order_status_${s}`)}
      </span>
    </HintTip>
  );
}

const ERROR_KEYS: Record<OrderActionError, string> = {
  bad_status: "err_bad_status",
  bad_transition: "err_bad_transition",
  same_status: "err_same_status",
  not_found: "err_not_found",
  needs_0053: "err_needs_0053",
  failed: "err_failed",
  paid_order: "err_paid_order",
  no_next_step: "err_no_next_step",
};

function useActionRunner() {
  const locale = useLocale();
  const [pending, start] = useTransition();
  const [error, setError] = useState<OrderActionError | null>(null);

  function run(action: (fd: FormData) => Promise<OrderActionState>, fields: Record<string, string>, after?: () => void) {
    const fd = new FormData();
    fd.set("locale", locale);
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    setError(null);
    start(async () => {
      try {
        const res = await action(fd);
        if (res.ok) after?.();
        else setError(res.error);
      } catch {
        setError("failed");
      }
    });
  }
  return { pending, error, run };
}

/**
 * ONE button with the obvious next action ("Start sourcing from Voltaat"). The
 * server decides the target status again; the label is only a promise.
 */
export function OrderNextStep({
  id,
  status,
  paymentMethod,
  supplierNames,
  size = "sm",
}: {
  id: string;
  status: string;
  paymentMethod?: string | null;
  supplierNames: string[];
  size?: "sm" | "default";
}) {
  const t = useTranslations("OrdersAdmin");
  const { pending, error, run } = useActionRunner();
  const step = nextStepFor(status, paymentMethod);
  if (!step) {
    return <span className="text-xs text-mutedtext">{t("next_done")}</span>;
  }
  const label = nextStepLabel(step, supplierNames);
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        size={size}
        disabled={pending}
        onClick={() => run(advanceOrder, { id })}
        className="h-auto min-h-8 whitespace-normal rounded-full py-1.5 text-start leading-tight"
      >
        {pending ? <Loader2 className="animate-spin" /> : <ArrowRight className="rtl:rotate-180" />}
        {t(`next_${label.key}`, label.values)}
      </Button>
      {error && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {t(ERROR_KEYS[error])}
        </p>
      )}
    </div>
  );
}

/** Mark as test / Not a test, and Cancel order (with a confirm). Nothing is deleted. */
export function OrderTestCancel({
  id,
  status,
  isTest,
  shortId,
}: {
  id: string;
  status: string;
  isTest: boolean;
  shortId: string;
}) {
  const t = useTranslations("OrdersAdmin");
  const test = useActionRunner();
  const cancel = useActionRunner();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !cancel.pending) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, cancel.pending]);

  const markable = isTest || canMarkTest(status);
  const cancellable = canCancel(status);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={test.pending || !markable}
          title={markable ? undefined : t("err_paid_order")}
          onClick={() => test.run(setOrderTest, { id, is_test: String(!isTest) })}
          className="rounded-full"
        >
          {test.pending ? <Loader2 className="animate-spin" /> : <FlaskConical />}
          {isTest ? t("unmark_test") : t("mark_test")}
        </Button>
        {cancellable && (
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} className="rounded-full text-destructive">
            <Ban />
            {t("cancel_order")}
          </Button>
        )}
      </div>
      {!markable && <p className="text-xs text-mutedtext">{t("err_paid_order")}</p>}
      {test.error && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {t(ERROR_KEYS[test.error])}
        </p>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`cancel-title-${id}`}
          onClick={() => !cancel.pending && setOpen(false)}
        >
          <div className="neu w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h2 id={`cancel-title-${id}`} className="text-lg font-bold text-heading">
              {t("cancel_title")}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-body">{t("cancel_body", { id: shortId })}</p>
            <label className="mt-4 block space-y-1">
              <span className="text-[11px] text-mutedtext">{t("cancel_note_label")}</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={1000}
                className="w-full rounded-lg border border-white/60 bg-panel px-3 py-2 text-sm text-heading shadow-neu-inset focus:outline-none focus:ring-2 focus:ring-cobalt/60"
              />
            </label>
            {cancel.error && (
              <p role="alert" className="mt-3 text-sm font-medium text-destructive">
                {t(ERROR_KEYS[cancel.error])}
              </p>
            )}
            <div className="mt-6 flex items-center justify-end gap-3">
              <Button type="button" variant="ghost" disabled={cancel.pending} onClick={() => setOpen(false)} className="rounded-full">
                {t("cancel_keep")}
              </Button>
              <Button
                type="button"
                disabled={cancel.pending}
                onClick={() => cancel.run(cancelOrder, { id, note }, () => setOpen(false))}
                className="rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {cancel.pending && <Loader2 className="animate-spin" />}
                {t("cancel_confirm")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
