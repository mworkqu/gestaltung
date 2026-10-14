import * as React from "react";

import { cn } from "@/lib/utils";

/** Circular progress (0-100) with the number in the middle. Server-safe. */
export function ProgressRing({ percent, label, size = 64, className }: { percent: number; label: string; size?: number; className?: string }) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <span role="img" aria-label={label} className={cn("relative inline-flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" className="-rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="#dbe3ee" strokeWidth="7" />
        <circle cx="32" cy="32" r={r} fill="none" stroke="#0e59c5" strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(p / 100) * c} ${c}`} />
      </svg>
      <span className="absolute text-xs font-extrabold text-heading" dir="ltr">
        {p}%
      </span>
    </span>
  );
}

const BADGE_COLOURS = ["#0e59c5", "#0f8a5f", "#b45309", "#7c3aed", "#be185d", "#0e7490", "#475569"];

/**
 * A badge for a completed level: a simple inline-SVG hexagon with the level
 * number, coloured per module. `earned` false = grey outline.
 */
export function LevelBadge({ level, moduleIndex = 0, earned = true, label, size = 44 }: { level: number; moduleIndex?: number; earned?: boolean; label: string; size?: number }) {
  const colour = BADGE_COLOURS[Math.abs(moduleIndex) % BADGE_COLOURS.length];
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} role="img" aria-label={label} className="shrink-0">
      <polygon
        points="24,3 42,13.5 42,34.5 24,45 6,34.5 6,13.5"
        fill={earned ? colour : "#eef2f7"}
        stroke={earned ? colour : "#b8c4d4"}
        strokeWidth="2"
        strokeDasharray={earned ? undefined : "4 3"}
      />
      <polygon points="24,9 37,16.5 37,31.5 24,39 11,31.5 11,16.5" fill="none" stroke={earned ? "#ffffff" : "#cbd5e1"} strokeOpacity="0.55" strokeWidth="1.5" />
      <text x="24" y="29.5" textAnchor="middle" fontSize="15" fontWeight="800" fontFamily="Arial, sans-serif" fill={earned ? "#ffffff" : "#94a3b8"}>
        {level}
      </text>
    </svg>
  );
}
