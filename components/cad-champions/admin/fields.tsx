"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

// Shared form pieces for the CAD Champions admin (Prompt 11). Every content
// form edits English and Arabic side by side: BilingualField renders two
// inputs (EN dir=ltr, AR dir=rtl) with the same label. Plain controlled or
// uncontrolled inputs; the page owns the state / server action.

export const inputCls =
  "min-h-11 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-mutedtext focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
export const textareaCls =
  "min-h-24 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm leading-relaxed text-ink placeholder:text-mutedtext focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
export const labelCls = "flex flex-col gap-1 text-sm font-semibold text-ink";
export const hintCls = "text-xs font-normal text-mutedtext";

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn(labelCls, className)}>
      <span>{label}</span>
      {children}
      {hint ? <span className={hintCls}>{hint}</span> : null}
    </label>
  );
}

type Side = { name?: string; value?: string; defaultValue?: string; onChange?: (v: string) => void; placeholder?: string };

/**
 * One label, two inputs: English (ltr) and Arabic (rtl), side by side from
 * md up, stacked on phones. Pass `name`s for form posts or `value`/`onChange`
 * for controlled state. `multiline` renders textareas.
 */
export function BilingualField({
  label,
  hint,
  en,
  ar,
  multiline = false,
  rows = 4,
  required = false,
  maxLength,
  mono = false,
}: {
  label: string;
  hint?: string;
  en: Side;
  ar: Side;
  multiline?: boolean;
  rows?: number;
  required?: boolean;
  maxLength?: number;
  mono?: boolean;
}) {
  const t = useTranslations("CC.admin.common");
  const id = React.useId();
  const one = (side: Side, lang: "en" | "ar") => {
    const props = {
      id: `${id}-${lang}`,
      name: side.name,
      lang,
      dir: lang === "ar" ? "rtl" : "ltr",
      placeholder: side.placeholder,
      required,
      maxLength,
      "aria-label": `${label} (${lang === "ar" ? t("arabic") : t("english")})`,
      ...(side.onChange ? { value: side.value ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => side.onChange!(e.target.value) } : { defaultValue: side.defaultValue ?? side.value ?? "" }),
    } as const;
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-mutedtext rtl:normal-case rtl:tracking-normal">
          {lang === "ar" ? t("arabic") : t("english")}
        </span>
        {multiline ? (
          <textarea {...props} rows={rows} className={cn(textareaCls, mono && "font-mono")} />
        ) : (
          <input {...props} type="text" className={cn(inputCls, mono && "font-mono")} />
        )}
      </div>
    );
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-semibold text-ink">{label}</legend>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {one(en, "en")}
        {one(ar, "ar")}
      </div>
      {hint ? <p className={hintCls}>{hint}</p> : null}
    </fieldset>
  );
}

/** A 44px checkbox row. */
export function CheckboxField({
  label,
  hint,
  name,
  checked,
  defaultChecked,
  onChange,
}: {
  label: string;
  hint?: string;
  name?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (v: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 items-start gap-3 text-sm font-semibold text-ink">
      <input
        type="checkbox"
        name={name}
        className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent,#0e59c5)]"
        {...(onChange ? { checked: !!checked, onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.checked) } : { defaultChecked })}
      />
      <span className="flex flex-col gap-0.5">
        <span>{label}</span>
        {hint ? <span className={hintCls}>{hint}</span> : null}
      </span>
    </label>
  );
}
