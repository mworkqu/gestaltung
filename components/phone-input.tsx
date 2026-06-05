"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

const DEFAULT_CODE = "+974"; // Qatar — pre-filled but editable

// Two-part phone field: an editable country-code box (defaults to +974) and the
// rest of the number. A hidden input named `name` submits the combined E.164
// value (e.g. +97430012345, or +12025550123 for a US number), so form handlers
// just read FormData[name]. Always LTR — numbers read left-to-right even on the
// Arabic/RTL pages.
export function PhoneInput({
  id,
  name,
  required = true,
  placeholder,
  codeAriaLabel = "Country code",
  className,
}: {
  id: string;
  name: string;
  required?: boolean;
  placeholder?: string;
  codeAriaLabel?: string;
  className?: string;
}) {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [number, setNumber] = useState("");

  function handleCode(e: React.ChangeEvent<HTMLInputElement>) {
    // Keep digits, force a single leading "+", cap at "+" plus 4 digits.
    const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
    setCode(`+${digits}`);
  }

  function handleNumber(e: React.ChangeEvent<HTMLInputElement>) {
    // Digits only; E.164 allows up to ~15 total, leave room for the code.
    setNumber(e.target.value.replace(/\D/g, "").slice(0, 14));
  }

  const fullValue = number ? `${code}${number}` : "";

  return (
    <div
      dir="ltr"
      className={cn(
        "flex w-full items-center overflow-hidden rounded-xl border border-white/60 bg-panel text-sm text-heading shadow-neu-inset transition focus-within:ring-2 focus-within:ring-cobalt/60",
        className
      )}
    >
      <input
        type="tel"
        inputMode="tel"
        aria-label={codeAriaLabel}
        required={required}
        pattern="\+[0-9]{1,4}"
        value={code}
        onChange={handleCode}
        className="w-16 shrink-0 border-r border-white/60 bg-transparent py-3 text-center font-medium text-mutedtext focus:outline-none"
      />
      <input
        id={id}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        required={required}
        pattern="[0-9]{6,14}"
        maxLength={14}
        value={number}
        onChange={handleNumber}
        placeholder={placeholder}
        className="w-full bg-transparent px-4 py-3 placeholder:text-faint focus:outline-none"
      />
      {/* Submitted value: full international number. */}
      <input type="hidden" name={name} value={fullValue} />
    </div>
  );
}
