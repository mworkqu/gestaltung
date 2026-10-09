import { getTranslations } from "next-intl/server";
import { Check, Circle, X } from "lucide-react";

import type { TimelineStep } from "@/lib/orders/status";
import { cn } from "@/lib/utils";

// Server component: the order's steps (confirmed → paid → sourcing → shipped →
// delivered, or ending in cancelled), reached ones ticked and dated.
export async function OrderTimeline({ steps, locale }: { steps: TimelineStep[]; locale: string }) {
  const t = await getTranslations("Orders");
  const date = new Intl.DateTimeFormat(locale === "ar" ? "ar-QA-u-nu-latn" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Qatar",
  });

  return (
    <ol className="space-y-0">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const cancelled = s.status === "cancelled";
        return (
          <li key={s.status} className="relative flex gap-3 pb-5 last:pb-0" aria-current={s.current ? "step" : undefined}>
            {!last && (
              <span
                aria-hidden
                className={cn(
                  "absolute start-[13px] top-7 h-[calc(100%-1.5rem)] w-0.5",
                  steps[i + 1]?.reached ? "bg-cobalt/60" : "bg-borderstrong/60"
                )}
              />
            )}
            <span
              aria-hidden
              className={cn(
                "relative z-10 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                cancelled
                  ? "bg-slate-600 text-white"
                  : s.reached
                    ? "bg-cobalt text-white"
                    : "bg-panel text-faint shadow-neu-inset"
              )}
            >
              {cancelled ? <X className="h-4 w-4" /> : s.reached ? <Check className="h-4 w-4" /> : <Circle className="h-2.5 w-2.5" />}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className={cn("text-sm font-semibold", s.reached ? "text-heading" : "text-mutedtext", s.current && "text-cobalt")}>
                {t(`status_${s.status}`)}
              </p>
              {s.reached && s.at && <p className="text-[12px] text-mutedtext">{date.format(new Date(s.at))}</p>}
              {s.note && (
                <p className="mt-1 whitespace-pre-line rounded-lg bg-panel px-3 py-2 text-sm text-body shadow-neu-inset">
                  <span className="font-semibold text-heading">{t("noteLabel")}: </span>
                  {s.note}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
