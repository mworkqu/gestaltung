"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { HelpCircle } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

import { HelpPopoverContent } from "./help-popover";

/** A small "?" button that opens a short explanation. Works by tap, Enter/Space, and Esc closes. */
export function HelpTip({
  label,
  children,
  learnMoreSlug,
  className,
}: {
  label: string;
  children: React.ReactNode;
  learnMoreSlug?: string;
  className?: string;
}) {
  const t = useTranslations("CC.ui");
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={t("helpFor", { label })}
          className={cn(
            "relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-mutedtext transition-colors",
            "before:absolute before:-inset-2.5 before:content-['']", // 44px touch area around the 24px icon
            "hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
            className
          )}
        >
          <HelpCircle aria-hidden="true" strokeWidth={1.75} className="h-5 w-5" />
        </button>
      </Popover.Trigger>
      <HelpPopoverContent title={label} learnMoreSlug={learnMoreSlug}>
        {children}
      </HelpPopoverContent>
    </Popover.Root>
  );
}
