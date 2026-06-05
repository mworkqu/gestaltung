"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

const COUNTRY_CODE = "+974"; // Qatar

// Phone field with a fixed +974 prefix. The user types only the 8 local digits;
// a hidden input named `name` submits the full E.164 value (e.g. +97433001122),
// so form handlers just read FormData[name] as usual. Always LTR (numbers read
// left-to-right) even on the Arabic/RTL pages.
export function PhoneInput({
  id,
  name,
  required = true,
  placeholder,
  className,
}: {
  id: string;
  name: string;
  required?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [digits, setDigits] = useState("");

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    // Keep digits only, Qatar local numbers are 8 digits.
    setDigits(e.target.value.replace(/\D/g, "").slice(0, 8));
  }

  const fullValue = digits ? `${COUNTRY_CODE}${digits}` : "";

  return (
    <div
      dir="ltr"
      className={cn(
        "flex w-full items-center overflow-hidden rounded-xl border border-white/60 bg-panel text-sm text-heading shadow-neu-inset transition focus-within:ring-2 focus-within:ring-cobalt/60",
        className
      )}
    >
      <span className="select-none border-r border-white/60 px-3.5 py-3 font-medium text-mutedtext">
        {COUNTRY_CODE}
      </span>
      <input
        id={id}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        required={required}
        pattern="[0-9]{8}"
        maxLength={8}
        value={digits}
        onChange={handleChange}
        placeholder={placeholder}
        className="w-full bg-transparent px-4 py-3 placeholder:text-faint focus:outline-none"
      />
      {/* Submitted value: full international number. */}
      <input type="hidden" name={name} value={fullValue} />
    </div>
  );
}
