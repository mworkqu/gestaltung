"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";

import { track } from "@/lib/cad-champions/analytics";
import { cn } from "@/lib/utils";

export type FaqEntry = { id: string; question: string; answer: string };

/** FAQ accordion: one button per question (aria-expanded / aria-controls), several may be open. */
export function FaqAccordion({ items }: { items: readonly FaqEntry[] }) {
  const [open, setOpen] = React.useState<ReadonlySet<string>>(() => new Set());
  const baseId = React.useId();

  const toggle = (id: string) => {
    const opening = !open.has(id);
    if (opening) track("cc_landing_faq_open", { id });
    setOpen((prev) => {
      const next = new Set(prev);
      if (opening) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  return (
    <ul className="divide-y divide-borderstrong/30 overflow-hidden rounded-2xl border border-border bg-panel">
      {items.map((item) => {
        const isOpen = open.has(item.id);
        const btnId = `${baseId}-${item.id}-q`;
        const panelId = `${baseId}-${item.id}-a`;
        return (
          <li key={item.id}>
            <h3 className="m-0">
              <button
                id={btnId}
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggle(item.id)}
                className="flex min-h-[52px] w-full items-center justify-between gap-4 px-5 py-3 text-start text-base font-semibold text-heading transition-colors hover:bg-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
              >
                <span>{item.question}</span>
                <ChevronDown
                  aria-hidden="true"
                  className={cn("h-5 w-5 shrink-0 text-mutedtext transition-transform motion-reduce:transition-none", isOpen && "rotate-180")}
                />
              </button>
            </h3>
            <div id={panelId} role="region" aria-labelledby={btnId} hidden={!isOpen} className="px-5 pb-5 text-sm leading-relaxed text-body sm:text-base">
              {item.answer}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
