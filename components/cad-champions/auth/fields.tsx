"use client";

import * as React from "react";
import { Eye, EyeOff, Check, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { HelpTip } from "@/components/cad-champions/ui";
import { checkPassword } from "@/lib/cad-champions/profile/password";
import { cn } from "@/lib/utils";

// Small form building blocks for the CC auth screens: label + optional
// "why we ask" HelpTip, the input, a hint and the error (linked with
// aria-describedby / aria-invalid). Inputs are 16px (no iOS zoom) and 44px tall.

export const ccFieldClass =
  "block w-full min-h-11 rounded-xl border border-white/60 bg-panel px-4 py-3 text-base text-heading shadow-neu-inset transition " +
  "placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent aria-[invalid=true]:border-[#d9534f] aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-[#d9534f]/40";

export function FieldError({ id, children }: { id: string; children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} className="mt-1.5 text-sm font-medium text-[#a1231f]">
      {children}
    </p>
  );
}

export function Field({
  id,
  label,
  why,
  hint,
  error,
  children,
  className,
}: {
  id: string;
  label: string;
  /** "Why we ask" text in a HelpTip next to the label. */
  why?: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <label htmlFor={id} className="text-sm font-semibold text-heading">
          {label}
        </label>
        {why ? <HelpTip label={label}>{why}</HelpTip> : null}
      </div>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-mutedtext">
          {hint}
        </p>
      ) : null}
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </div>
  );
}

/** aria props for an input inside <Field>. */
export function describedBy(id: string, { hint, error }: { hint?: string; error?: string }) {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ");
  return { "aria-describedby": ids || undefined, "aria-invalid": error ? true : undefined } as const;
}

/** Password input with a show/hide toggle and (optionally) the live rules. */
export function PasswordField({
  id,
  name,
  label,
  value,
  onChange,
  error,
  why,
  autoComplete,
  showRules = false,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  why?: string;
  autoComplete: "new-password" | "current-password";
  showRules?: boolean;
}) {
  const t = useTranslations("CC.auth");
  const [visible, setVisible] = React.useState(false);
  const rules = checkPassword(value);
  const rulesId = `${id}-rules`;

  return (
    <Field id={id} label={label} why={why} error={error}>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          required
          autoComplete={autoComplete}
          dir="ltr"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(ccFieldClass, "pe-14 text-start")}
          aria-describedby={[showRules ? rulesId : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined}
          aria-invalid={error ? true : undefined}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t("common.hidePassword") : t("common.showPassword")}
          aria-pressed={visible}
          className="absolute inset-y-0 end-0 inline-flex min-h-11 min-w-11 items-center justify-center rounded-e-xl text-mutedtext hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {visible ? <EyeOff aria-hidden className="h-5 w-5" strokeWidth={1.75} /> : <Eye aria-hidden className="h-5 w-5" strokeWidth={1.75} />}
        </button>
      </div>
      {showRules ? (
        <ul id={rulesId} aria-label={t("signUp.rulesLabel")} className="mt-2 space-y-1 text-sm" aria-live="polite">
          {(["length", "number"] as const).map((rule) => {
            const met = rules[rule];
            const Icon = met ? Check : X;
            return (
              <li key={rule} className={cn("flex items-center gap-2", met ? "text-buy" : "text-mutedtext")}>
                <Icon aria-hidden className="h-4 w-4 shrink-0" strokeWidth={2} />
                <span>{rule === "length" ? t("signUp.ruleLength") : t("signUp.ruleNumber")}</span>
                <span className="sr-only">({met ? t("signUp.ruleMet") : t("signUp.ruleNotMet")})</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </Field>
  );
}

/** Seconds left on a countdown that starts at `seconds` whenever `key` changes (0 = done). */
export function useCountdown(seconds: number, key: number): number {
  const [left, setLeft] = React.useState(0);
  React.useEffect(() => {
    if (key === 0) return;
    setLeft(seconds);
    const started = Date.now();
    const timer = window.setInterval(() => {
      const remain = Math.max(0, seconds - Math.floor((Date.now() - started) / 1000));
      setLeft(remain);
      if (remain === 0) window.clearInterval(timer);
    }, 250);
    return () => {
      window.clearInterval(timer);
    };
  }, [seconds, key]);
  return left;
}
