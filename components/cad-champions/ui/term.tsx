"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { useLocale, useTranslations } from "next-intl";

import type { Locale } from "@/i18n/routing";
import { getGlossaryEntry, type GlossaryId } from "@/lib/cad-champions/glossary";

import { HelpPopoverContent } from "./help-popover";

/** Inline glossary term: dotted underline, popover with the definition. */
export function Term({ id, children }: { id: GlossaryId; children?: React.ReactNode }) {
  const t = useTranslations("CC.ui");
  const locale = useLocale() as Locale;
  const entry = getGlossaryEntry(id, locale) as
    | { term: string; definition: string; helpSlug?: string }
    | undefined;
  if (!entry) return <>{children ?? id}</>;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={t("termLabel", { term: entry.term })}
          className="inline cursor-help rounded-sm border-b border-dotted border-accent bg-transparent p-0 font-semibold text-ink hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          {children ?? entry.term}
        </button>
      </Popover.Trigger>
      <HelpPopoverContent title={entry.term} learnMoreSlug={entry.helpSlug}>
        {entry.definition}
      </HelpPopoverContent>
    </Popover.Root>
  );
}
