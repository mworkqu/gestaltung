"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { DELIVERY_AREAS } from "@/lib/parts/constants";
import { cn } from "@/lib/utils";
import { fillEmpty, type CheckoutPrefill } from "@/lib/store/checkout-prefill";

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
  prefill,
}: {
  isRtl: boolean;
  /** Bank transfer needs an email (the details are emailed). */
  bankTransfer: boolean;
  emailError: string | null;
  /** Typing in the email field clears its error. */
  onEmailInput: () => void;
  /** Signed-in customer's details; filled into empty fields only. */
  prefill?: CheckoutPrefill;
}) {
  const t = useTranslations("Checkout");
  const tPay = useTranslations("PayMethods");
  const [areaOther, setAreaOther] = useState(false);
  // The inputs are uncontrolled, so a late profile read is written in through
  // refs, and only into fields still empty (a guest typing is never overwritten).
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!prefill || !nameRef.current || !phoneRef.current || !emailRef.current) return;
    const next = fillEmpty(
      { name: nameRef.current.value, phone: phoneRef.current.value, email: emailRef.current.value },
      prefill
    );
    nameRef.current.value = next.name;
    phoneRef.current.value = next.phone;
    emailRef.current.value = next.email;
  }, [prefill]);
  const label = (htmlFor: string, text: string, required = false) => (
    <FieldLabel htmlFor={htmlFor} text={text} required={required} isRtl={isRtl} />
  );

  return (
    <>
      <div className="space-y-2">
        {label("customer_name", t("nameLabel"), true)}
        <input ref={nameRef} id="customer_name" name="customer_name" required className={fieldClass} />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          {label("customer_phone", t("phoneLabel"), true)}
          <input
            ref={phoneRef}
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
            ref={emailRef}
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
