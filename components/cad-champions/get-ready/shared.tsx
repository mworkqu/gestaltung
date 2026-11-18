"use client";

import * as React from "react";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { useLocale } from "next-intl";

import type { Locale } from "@/i18n/routing";
import { ccPath } from "@/lib/cad-champions/routes";
import { cn } from "@/lib/utils";

/** Link to a Help Center article (opens in the same tab; progress is saved). */
export function HelpLink({ slug, children, className }: { slug: string; children: React.ReactNode; className?: string }) {
  const locale = useLocale() as Locale;
  return (
    <Link
      href={ccPath(locale, `/help/${slug}`)}
      className={cn(
        "inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        className
      )}
    >
      <BookOpen aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 shrink-0" />
      {children}
    </Link>
  );
}

/** A 44px-tall checkbox row. */
export function CheckRow({
  id,
  checked,
  disabled,
  onChange,
  children,
  className,
}: {
  id: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex min-h-[44px] cursor-pointer items-start gap-3 rounded-xl px-2 py-2 hover:bg-panel",
        disabled && "cursor-not-allowed opacity-70",
        className
      )}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
      <span className="text-sm text-ink">{children}</span>
    </label>
  );
}

/** Small bold heading inside a step. */
export function SubHeading({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h4 className={cn("text-sm font-extrabold text-heading", className)}>{children}</h4>;
}

/** Ordered list of short steps. */
export function StepsList({ items, className }: { items: string[]; className?: string }) {
  return (
    <ol className={cn("list-decimal space-y-1.5 ps-5 text-sm text-body marker:font-semibold marker:text-ink", className)}>
      {items.map((text, i) => (
        <li key={i}>{text}</li>
      ))}
    </ol>
  );
}
