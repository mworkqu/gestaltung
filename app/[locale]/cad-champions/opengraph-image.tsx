import { ImageResponse } from "next/og";

import { centreDistance, gearOutline, HERO_GEARS, meshPhase, outlineToPath } from "@/lib/cad-champions/landing/gear";

// CAD Champions share card (Open Graph), 1200x630: brand cobalt on the light
// canvas, the gear pair from the landing hero, the English title large.
//
// Arabic: satori ships no Arabic font and orders Arabic words left-to-right
// (see CLAUDE.md "PHASE 3.7"), and this route cannot fetch a font at build
// time. So BOTH locales get the English card; the bilingual line says
// "English and Arabic" in English. An Arabic card needs a pre-rendered text
// PNG like scripts/make-og-ar.mjs makes for the main site (follow-up).
// Applies to every CC page below /cad-champions/{locale} (file convention).

export const alt = "CAD Champions: train for the national CAD skills competition";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#1c2434";
const BODY = "#475569";
const COBALT = "#0e59c5";
const CANVAS = "#eef2f7";
const HAIRLINE = "#d3dbe6";

const SCALE = 80;
const { driver, driven } = HERO_GEARS;
const flip = (pts: [number, number][]) => pts.map(([x, y]) => [x * SCALE, -y * SCALE] as [number, number]);
const DRIVER = outlineToPath(flip(gearOutline(driver)), 0, 0);
const DRIVEN = outlineToPath(flip(gearOutline(driven, meshPhase(driven))), centreDistance(driver, driven) * SCALE, 0);

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: CANVAS, fontFamily: "sans-serif" }}>
        {/* Cobalt band on the start edge */}
        <div style={{ position: "absolute", display: "flex", left: 0, top: 0, width: 18, height: 630, background: COBALT }} />
        {/* Gear pair */}
        <svg
          width="500"
          height="340"
          viewBox="-160 -170 500 340"
          style={{ position: "absolute", left: 660, top: 150 }}
        >
          <circle cx="0" cy="0" r="165" fill="none" stroke={HAIRLINE} strokeWidth="2" />
          <path d={DRIVER} fill={COBALT} stroke="#0a3f8f" strokeWidth="3" />
          <path d={DRIVEN} fill="#aab6c6" stroke="#475569" strokeWidth="3" />
          <circle cx="0" cy="0" r="26" fill={INK} />
          <circle cx={centreDistance(driver, driven) * SCALE} cy="0" r="20" fill={INK} />
        </svg>

        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "70px 80px", width: "100%", height: "100%" }}>
          <div style={{ display: "flex", fontSize: 30, color: COBALT, letterSpacing: 2 }}>CAD CHAMPIONS</div>
          <div style={{ display: "flex", flexDirection: "column", maxWidth: 600 }}>
            <div style={{ display: "flex", fontSize: 68, lineHeight: 1.08, color: INK, letterSpacing: -1.5 }}>
              Train for the national CAD skills competition
            </div>
            <div style={{ display: "flex", marginTop: 24, fontSize: 30, color: BODY }}>
              Free CAD test · Skill report · Training in Lusail
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 26, color: BODY }}>
            <span style={{ display: "flex" }}>gestaltung360.com/cad-champions</span>
            <span style={{ display: "flex", margin: "0 14px" }}>·</span>
            <span style={{ display: "flex" }}>English and Arabic</span>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
