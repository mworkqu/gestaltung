// The Studio's loading animation: a little printer nozzle laying a part down
// layer by layer. CSS + SVG only (no JS, no deps); neu colours + the step accent;
// symmetric, so it reads the same in Arabic; reduced motion = one still frame.

import { cn } from "@/lib/utils";

const CSS = `.sl-n{animation:sl-n 1.6s ease-in-out infinite alternate}.sl-l{transform-box:fill-box;transform-origin:center;animation:sl-l 3.2s ease-out infinite both}@keyframes sl-n{from{transform:translateX(-22px)}to{transform:translateX(22px)}}@keyframes sl-l{0%{transform:scaleX(0);opacity:0}12%{opacity:1}30%,82%{transform:scaleX(1);opacity:1}100%{transform:scaleX(1);opacity:0}}@media (prefers-reduced-motion:reduce){.sl-n,.sl-l{animation:none}}`;

/** Bottom layer first; each one starts a little later. */
const LAYERS = [58, 50, 42, 34];

export function LoaderArt({ accent, className }: { accent: string; className?: string }) {
  return (
    <svg viewBox="0 0 120 80" aria-hidden="true" className={cn("h-16 w-24", className)}>
      <style>{CSS}</style>
      <rect x="18" y="66" width="84" height="5" rx="2.5" fill="#dde4ee" />
      {LAYERS.map((y, i) => (
        <rect
          key={y}
          className="sl-l"
          x={32 + i * 2}
          y={y}
          width={56 - i * 4}
          height="7"
          rx="3.5"
          fill={accent}
          opacity={1 - i * 0.15}
          style={{ animationDelay: `${i * 0.45}s` }}
        />
      ))}
      <rect x="10" y="12" width="100" height="3" rx="1.5" fill="#d3dbe6" />
      <g className="sl-n">
        <rect x="52" y="9" width="16" height="12" rx="3" fill="#c3cddb" />
        <path d="M56 21h8l-2.5 6h-3z" fill="#9aa6b7" />
      </g>
    </svg>
  );
}

/**
 * A loading panel: the animation over one short line. `status` = announce the line
 * (leave it off when the caller already has a live status line).
 */
export function StudioLoader({
  label,
  accent,
  ink = accent,
  status = true,
  className,
  testId,
}: {
  label: string;
  accent: string;
  /** Text colour (the step's darker ink); defaults to the accent. */
  ink?: string;
  status?: boolean;
  className?: string;
  testId?: string;
}) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-2 p-4 text-center", className)}
      role={status ? "status" : undefined}
      aria-live={status ? "polite" : undefined}
      data-testid={testId ?? "studio-loader"}
    >
      <LoaderArt accent={accent} />
      <p className="text-sm font-semibold" style={{ color: ink }}>
        {label}
      </p>
    </div>
  );
}
