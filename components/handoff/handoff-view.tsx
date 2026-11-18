"use client";

// Presentational states of the handoff page (no network, no router), so the
// e2e fixture can render each one statically. handoff-claim.tsx drives it.

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { Skeleton } from "@/components/ui/skeleton";

export type HandoffViewState = "loading" | "expired" | "limit" | "error" | "notReady" | "phone";

export type HandoffPhoneProps = {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onSkip: () => void;
  busy?: boolean;
  /** Show the "Phone.invalid" message. */
  invalid?: boolean;
  /** The save failed for a reason other than the number. */
  failed?: boolean;
};

const button =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-cobalt px-6 text-sm font-semibold text-white transition-colors hover:bg-cobalt-hover active:scale-[0.98] disabled:opacity-60";
const field =
  "w-full min-h-11 rounded-xl border border-white/60 bg-panel px-3 py-2 text-base text-heading shadow-neu-inset outline-none placeholder:text-faint focus:ring-2 focus:ring-cobalt/60";

export function HandoffView({
  state,
  onRetry,
  phone,
}: {
  state: HandoffViewState;
  onRetry?: () => void;
  phone?: HandoffPhoneProps;
}) {
  const t = useTranslations("Handoff");
  const tp = useTranslations("Phone");

  return (
    <div className="neu mx-auto w-full max-w-lg space-y-4 p-5 sm:p-8" data-testid="handoff-card" data-state={state}>
      {state === "loading" && (
        <div role="status" aria-live="polite" className="space-y-4" data-testid="handoff-loading">
          <h1 className="text-xl font-black tracking-tight text-heading">{t("title")}</h1>
          <p className="text-sm text-mutedtext">{t("loading")}</p>
          <div className="space-y-3 pt-1">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-11 w-full rounded-xl" />
          </div>
        </div>
      )}

      {state === "expired" && (
        <div role="alert" className="space-y-3" data-testid="handoff-expired">
          <h1 className="text-xl font-black tracking-tight text-heading">{t("expired")}</h1>
        </div>
      )}

      {state === "limit" && (
        <div role="alert" className="space-y-3" data-testid="handoff-limit">
          <h1 className="text-xl font-black tracking-tight text-heading">{t("limitTitle")}</h1>
          <p className="text-sm text-body">{t("limitText")}</p>
          <Link
            href="/projects"
            className="inline-flex min-h-11 items-center text-sm font-semibold text-cobalt underline-offset-2 hover:underline"
          >
            {t("limitLink")}
          </Link>
        </div>
      )}

      {(state === "error" || state === "notReady") && (
        <div role="alert" className="space-y-3" data-testid={state === "error" ? "handoff-error" : "handoff-not-ready"}>
          <h1 className="text-xl font-black tracking-tight text-heading">{state === "error" ? t("error") : t("notReady")}</h1>
          {state === "error" && onRetry && (
            <button type="button" onClick={onRetry} className={button}>
              {t("retry")}
            </button>
          )}
        </div>
      )}

      {state === "phone" && phone && (
        <form
          className="space-y-4"
          data-testid="handoff-phone"
          onSubmit={(e) => {
            e.preventDefault();
            phone.onSave();
          }}
        >
          <h1 className="text-xl font-black tracking-tight text-heading">{t("phoneTitle")}</h1>
          <p className="text-sm text-mutedtext">{t("phoneHint")}</p>
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-mutedtext">{t("phoneLabel")}</span>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              dir="ltr"
              value={phone.value}
              onChange={(e) => phone.onChange(e.target.value)}
              placeholder="+974 5555 1234"
              aria-invalid={phone.invalid || undefined}
              className={`${field} text-start`}
            />
          </label>
          {phone.invalid && <p className="text-sm font-medium text-destructive">{tp("invalid")}</p>}
          {phone.failed && <p className="text-sm font-medium text-destructive">{t("error")}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={phone.busy} className={button}>
              {phone.busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {t("phoneSave")}
            </button>
            <button
              type="button"
              onClick={phone.onSkip}
              disabled={phone.busy}
              className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-cobalt underline-offset-2 hover:underline disabled:opacity-60"
            >
              {t("phoneSkip")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
