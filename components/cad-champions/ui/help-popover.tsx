"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { ArrowRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import type { Locale } from "@/i18n/routing";
import { ccPath } from "@/lib/cad-champions/routes";

/** Shared popover body used by HelpTip and Term. */
export function HelpPopoverContent({
  title,
  children,
  learnMoreSlug,
}: {
  title?: string;
  children: React.ReactNode;
  learnMoreSlug?: string;
}) {
  const t = useTranslations("CC.ui");
  const locale = useLocale() as Locale;
  return (
    <Popover.Portal>
      <Popover.Content
        sideOffset={8}
        collisionPadding={12}
        className="z-[60] w-[min(20rem,calc(100vw-1.5rem))] rounded-2xl border border-border bg-card p-4 text-start shadow-neu-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {title ? <p className="mb-1 text-sm font-bold text-ink">{title}</p> : null}
        <div className="text-sm leading-relaxed text-body">{children}</div>
        {learnMoreSlug ? (
          <a
            href={ccPath(locale, `/help/${learnMoreSlug}`)}
            className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-md text-sm font-semibold text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            {t("learnMore")}
            <ArrowRight aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 rtl:-scale-x-100" />
          </a>
        ) : null}
      </Popover.Content>
    </Popover.Portal>
  );
}
