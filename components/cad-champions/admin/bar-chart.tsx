import * as React from "react";

// Simple horizontal bar chart as inline SVG (Prompt 11 insights + the pilot
// report). No chart library. Labels are passed in already formatted (Western
// digits). Bars grow from the start edge (the SVG is flipped in RTL; the
// labels are HTML, so text stays readable).

export interface Bar {
  label: string;
  value: number;
  /** Text shown after the bar, e.g. "42 %" or "12". */
  display: string;
  /** Optional highlight (e.g. the weakest skill). */
  highlight?: boolean;
}

export function BarChart({ bars, max, title, emptyText }: { bars: Bar[]; max?: number; title: string; emptyText: string }) {
  const top = Math.max(max ?? 0, ...bars.map((b) => b.value), 0);
  if (bars.length === 0 || top <= 0) {
    return <p className="text-sm text-mutedtext">{emptyText}</p>;
  }
  return (
    <figure className="space-y-2" aria-label={title}>
      <ul className="space-y-2">
        {bars.map((b, i) => {
          const pct = Math.max(0, Math.min(100, (b.value / top) * 100));
          return (
            <li key={i} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm">
              <span className="truncate text-body" title={b.label}>
                {b.label}
              </span>
              <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="h-4 w-full rtl:-scale-x-100" role="img" aria-label={`${b.label}: ${b.display}`}>
                <rect x="0" y="0" width="100" height="10" rx="3" className="fill-panel" />
                <rect x="0" y="0" width={pct} height="10" rx="3" className={b.highlight ? "fill-amber-500" : "fill-[var(--accent,#0e59c5)]"} />
              </svg>
              <span className="tabular-nums font-semibold text-ink">{b.display}</span>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
