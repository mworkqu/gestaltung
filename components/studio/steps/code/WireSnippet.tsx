"use client";

// A tiny "Wiring snippet" for the code preview (P5-17): two rounded part boxes
// with their names and pin labels, joined by a curved wire in the wire's
// colour; a series resistor is a small zigzag in the middle. Drawn here (no 3D,
// no shared drawing module) so the Code step stays light. Loaded on demand.

import { partName, WIRE_HEX, WIRE_OUTLINE, type Connection } from "@/lib/studio/connections";
import type { GetPart, Locale } from "@/lib/studio/netlist";

const W = 320;
const H = 116;
const BOX_W = 112;
const BOX_H = 64;
const Y = 26;
const MID = Y + BOX_H / 2;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function PartBox({ x, name, pin, pinSide }: { x: number; name: string; pin: string; pinSide: "start" | "end" }) {
  const px = pinSide === "end" ? x + BOX_W : x;
  return (
    <g>
      <rect x={x} y={Y} width={BOX_W} height={BOX_H} rx={14} fill="#f8fafc" stroke="#cbd5e1" strokeWidth={1.5} />
      <text x={x + BOX_W / 2} y={Y + 26} textAnchor="middle" fontSize={11} fill="#475569">
        {clip(name, 18)}
      </text>
      <text x={x + BOX_W / 2} y={Y + 46} textAnchor="middle" fontSize={13} fontWeight={700} fill="#1c2434">
        {clip(pin, 12)}
      </text>
      <circle cx={px} cy={MID} r={4.5} fill="#1c2434" />
    </g>
  );
}

export default function WireSnippet({ c, getPart, locale }: { c: Connection; getPart: GetPart; locale: Locale }) {
  const rtl = locale === "ar";
  // The board end sits at the reading start: left in English, right in Arabic.
  const [left, right] = rtl ? [c.to, c.from] : [c.from, c.to];
  const name = (e: Connection["from"]) => partName(getPart(e.partId), locale, e.part);
  const x1 = 8 + BOX_W;
  const x2 = W - 8 - BOX_W;
  const hex = WIRE_HEX[c.wireColour];
  const outline = WIRE_OUTLINE[c.wireColour];
  const mx = (x1 + x2) / 2;
  const d = c.viaPart
    ? `M${x1} ${MID} C${x1 + 14} ${MID - 22} ${mx - 30} ${MID - 22} ${mx - 20} ${MID} l4 -8 l8 16 l8 -16 l8 16 l8 -16 l4 8 C${mx + 30} ${MID + 22} ${x2 - 14} ${MID + 22} ${x2} ${MID}`
    : `M${x1} ${MID} C${mx - 10} ${MID - 34} ${mx + 10} ${MID + 34} ${x2} ${MID}`;
  const via = c.viaPartId ? partName(getPart(c.viaPartId), locale, c.viaPart) : null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-hidden className="block" data-testid="studio-wire-snippet">
      <PartBox x={8} name={name(left)} pin={left.label} pinSide="end" />
      <PartBox x={W - 8 - BOX_W} name={name(right)} pin={right.label} pinSide="start" />
      {outline && <path d={d} fill="none" stroke={outline} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />}
      <path d={d} fill="none" stroke={hex} strokeWidth={outline ? 3.5 : 4} strokeLinecap="round" strokeLinejoin="round" />
      {via && (
        <text x={mx} y={MID + 34} textAnchor="middle" fontSize={10} fill="#64748b">
          {clip(via, 26)}
        </text>
      )}
    </svg>
  );
}
