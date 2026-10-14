// CAD Champions design tokens, mirrored from DESIGN.md and app/globals.css.
// Components use Tailwind class names; this file is for non-Tailwind consumers
// (charts, canvas, emails). Keep in sync with tailwind.config.ts.
// [TODO-MO: brand colors and logo]

export const ccColors = {
  canvas: "#eef2f7",
  recessed: "#e6ebf2",
  ink: "#1c2434",
  body: "#475569",
  muted: "#5a6677",
  faint: "#94a3b8",
  hairline: "#d3dbe6",
  accent: "#0e59c5",
  accentHover: "#0c4eb0",
  onAccent: "#ffffff",
  success: "#0f6c59",
  successBg: "#e6f4f1",
  warning: "#6e4c12",
  warningBg: "#f6eedf",
  danger: "#c62d28",
  dangerBg: "#fdecec",
} as const;

export const ccRadius = {
  card: "1.75rem",
  inset: "1.25rem",
  tile: "1rem",
  pill: "9999px",
} as const;

export const ccSpacing = {
  stack: "1.5rem",
  cardPad: "2rem",
  touchTarget: "44px",
} as const;

export const ccShadows = {
  neu: "6px 6px 16px rgba(163,177,198,0.5), -6px -6px 16px rgba(255,255,255,0.85)",
  neuLg: "10px 10px 28px rgba(163,177,198,0.55), -10px -10px 28px rgba(255,255,255,0.9)",
  neuSm: "4px 4px 10px rgba(163,177,198,0.45), -4px -4px 10px rgba(255,255,255,0.9)",
  neuInset: "inset 4px 4px 10px rgba(163,177,198,0.45), inset -4px -4px 10px rgba(255,255,255,0.9)",
} as const;
