"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { DELIVERY_AREAS } from "@/lib/parts/constants";
import { cn } from "@/lib/utils";

export const fieldClass =
  "w-full rounded-xl border border-white/60 bg-panel px-4 py-3 text-sm text-heading shadow-neu-inset transition placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-cobalt/60";

/** The small caps label style of the checkout form (Arabic has no caps). */
export function monoClass(isRtl: boolean, extra = ""): string {
  return cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);
}

export function FieldLabel({
  htmlFor,
  text,
  required = false,
  isRtl,
}: {
  htmlFor: string;
  text: string;
  required?: boolean;
  isRtl: boolean;
}) {
  return (
    <label htmlFor={htmlFor} className={monoClass(isRtl, "block text-[10px] text-mutedtext")}>
      {text}
      {required && <span className="text-destructive"> *</span>}
    </label>
  );
}

/** Name, phone, email and delivery area (uncontrolled; the form reads them on submit). */
export function CustomerFields({
  isRtl,
  bankTransfer,
  emailError,
  onEmailInput,
}: {
  isRtl: boolean;
  /** Bank transfer needs an email (the details are emailed). */
  bankTransfer: boolean;
  emailError: string | null;
  /** Typing in the email field clears its error. */
  onEmailInput: () => void;
}) {
  const t = useTranslations("Checkout");
  const tPay = useTranslations("PayMethods");
  const [areaOther, setAreaOther] = useState(false);
  const label = (htmlFor: string, text: string, required = false) => (
    <FieldLabel htmlFor={htmlFor} text={text} required={required} isRtl={isRtl} />
  );

  return (
    <>
      <div className="space-y-2">
        {label("customer_name", t("nameLabel"), true)}
        <input id="customer_name" name="customer_name" required className={fieldClass} />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          {label("customer_phone", t("phoneLabel"), true)}
          <input
            id="customer_phone"
            name="customer_phone"
            required
            inputMode="tel"
            dir="ltr"
            placeholder={t("phonePlaceholder")}
            className={fieldClass}
          />
        </div>
        <div className="space-y-2">
          {bankTransfer
            ? label("customer_email", t("emailLabelRequired"), true)
            : label("customer_email", t("emailLabel"))}
          <input
            id="customer_email"
            name="customer_email"
            type="email"
            dir="ltr"
            required={bankTransfer}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? "customer_email_error" : bankTransfer ? "customer_email_hint" : undefined}
            onChange={() => emailError && onEmailInput()}
            className={cn(fieldClass, emailError && "ring-2 ring-destructive/60")}
          />
          {emailError && (
            <p id="customer_email_error" role="alert" className="text-[12px] font-medium text-destructive">
              {emailError}
            </p>
          )}
          {bankTransfer && (
            <p id="customer_email_hint" className="text-[11px] text-mutedtext">
              {tPay("emailForBank")}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {label("delivery_area", t("areaLabel"), true)}
        <select
          id="delivery_area"
          name="delivery_area"
          required
          defaultValue=""
          onChange={(e) => setAreaOther(e.target.value === "other")}
          aria-describedby={areaOther ? "delivery_area_hint" : undefined}
          className={cn(fieldClass, isRtl && "text-right")}
        >
          <option value="" disabled>
            {t("areaPlaceholder")}
          </option>
          {DELIVERY_AREAS.map((a) => (
            <option key={a} value={a}>
              {t(`area_${a}`)}
            </option>
          ))}
        </select>
        {areaOther && (
          <p id="delivery_area_hint" className="text-[11px] text-mutedtext">
            {t("areaOtherHint")}
          </p>
        )}
      </div>
    </>
  );
}
