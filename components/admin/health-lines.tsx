import { getTranslations } from "next-intl/server";

import type { HealthItem, HealthLevel } from "@/lib/admin/health-status";
import { cn } from "@/lib/utils";

// AI usage & pricing: one status line per item (D5). Server component; the
// items carry booleans and env var NAMES only, never a secret value.

const GLYPH: Record<HealthLevel, string> = { ok: "✅", action: "⚠️", off: "⏸" };
const TONE: Record<HealthLevel, string> = {
  ok: "text-emerald-700",
  action: "text-destructive",
  off: "text-mutedtext",
};

export async function HealthLines({ items }: { items: HealthItem[] }) {
  const t = await getTranslations("AiUsage.health");
  return (
    <section className="neu space-y-4 p-6" aria-labelledby="health-title">
      <div>
        <h2 id="health-title" className="text-base font-bold text-heading">
          {t("title")}
        </h2>
        <p className="text-[12px] text-mutedtext">{t("intro")}</p>
      </div>
      <ul className="divide-y divide-borderstrong/40">
        {items.map((it) => (
          <li key={it.id} className="space-y-1.5 py-3 first:pt-0 last:pb-0">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span aria-hidden>{GLYPH[it.level]}</span>
              <span className="font-semibold text-heading">{t(`name_${it.id}`)}</span>
              <span className={cn("text-[11px] font-semibold uppercase tracking-wider rtl:tracking-normal rtl:normal-case", TONE[it.level])}>
                {t(it.level)}
              </span>
            </p>
            <p className="max-w-[75ch] text-[13px] leading-relaxed text-body">{t(`${it.id}_${it.state}`)}</p>
            {it.envVars.length > 0 && (
              <details className="text-[12px] text-mutedtext">
                <summary className="min-h-6 cursor-pointer font-medium text-cobalt">{t("howToFix")}</summary>
                <p className="mt-1.5">{t("fixIntro")}</p>
                <ul className="mt-1 space-y-0.5" dir="ltr">
                  {it.envVars.map((v) => (
                    <li key={v}>
                      <code className="rounded bg-panel px-1.5 py-0.5 font-mono text-[11px] text-heading shadow-neu-inset">{v}</code>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
