import { centreDistance, gearDims, gearOutline, HERO_GEARS, meshPhase, outlineToPath } from "@/lib/cad-champions/landing/gear";

// Static drawing of the hero assembly (gear pair on shafts in front of a
// bracket). Shown before the 3D model loads, and instead of it for reduced
// motion, Save-Data, slow or low-memory devices. Pure SVG, no JS.

const SCALE = 60;
const { driver, driven } = HERO_GEARS;
const CX1 = 150;
const CY = 205;
const CX2 = CX1 + centreDistance(driver, driven) * SCALE;

const scaled = (pts: [number, number][]) => pts.map(([x, y]) => [x * SCALE, -y * SCALE] as [number, number]);
const DRIVER_PATH = outlineToPath(scaled(gearOutline(driver)), CX1, CY);
const DRIVEN_PATH = outlineToPath(scaled(gearOutline(driven, meshPhase(driven))), CX2, CY);
const R1 = gearDims(driver);
const R2 = gearDims(driven);

export function HeroStatic({ label, className }: { label: string; className?: string }) {
  return (
    <svg viewBox="0 0 400 400" role="img" aria-label={label} className={className} preserveAspectRatio="xMidYMid meet">
      <defs>
        <pattern id="cc-hero-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0H0V20" fill="none" stroke="#d3dbe6" strokeWidth="0.6" />
        </pattern>
        <linearGradient id="cc-hero-steel" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e2e8f0" />
          <stop offset="1" stopColor="#94a3b8" />
        </linearGradient>
        <linearGradient id="cc-hero-cobalt" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#0e59c5" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="400" height="400" fill="url(#cc-hero-grid)" opacity="0.7" />
      {/* bracket plate */}
      <rect x="40" y="290" width="330" height="26" rx="6" fill="#cbd5e1" stroke="#64748b" strokeWidth="1.5" />
      <rect x="62" y="150" width="22" height="146" rx="5" fill="#cbd5e1" stroke="#64748b" strokeWidth="1.5" />
      {/* centre lines */}
      <g stroke="#0e59c5" strokeWidth="0.8" strokeDasharray="10 3 2 3" opacity="0.55">
        <line x1={CX1 - R1.outer * SCALE - 14} y1={CY} x2={CX2 + R2.outer * SCALE + 10} y2={CY} />
        <line x1={CX1} y1={CY - R1.outer * SCALE - 14} x2={CX1} y2={CY + R1.outer * SCALE + 14} />
        <line x1={CX2} y1={CY - R2.outer * SCALE - 14} x2={CX2} y2={CY + R2.outer * SCALE + 14} />
      </g>
      {/* gears */}
      <path d={DRIVER_PATH} fill="url(#cc-hero-cobalt)" stroke="#0a3f8f" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={CX1} cy={CY} r={R1.root * SCALE * 0.62} fill="none" stroke="#bfd6f6" strokeWidth="1.2" opacity="0.8" />
      <path d={DRIVEN_PATH} fill="url(#cc-hero-steel)" stroke="#475569" strokeWidth="1.5" strokeLinejoin="round" />
      {/* shafts */}
      <circle cx={CX1} cy={CY} r="17" fill="#1c2434" />
      <circle cx={CX1} cy={CY} r="6" fill="#64748b" />
      <circle cx={CX2} cy={CY} r="13" fill="#1c2434" />
      <circle cx={CX2} cy={CY} r="5" fill="#64748b" />
      {/* dimension */}
      <g stroke="#475569" strokeWidth="1" fill="#475569">
        <line x1={CX1} y1="352" x2={CX2} y2="352" />
        <line x1={CX1} y1="344" x2={CX1} y2="360" />
        <line x1={CX2} y1="344" x2={CX2} y2="360" />
      </g>
    </svg>
  );
}
