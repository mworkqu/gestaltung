import { readFile } from "node:fs/promises";
import path from "node:path";

import { ImageResponse } from "next/og";

import { routing } from "@/i18n/routing";

// Default share card (Open Graph + Twitter): 1200x630, the light "precision"
// look from DESIGN.md (canvas #eef2f7, ink #1c2434, cobalt #0e59c5) with the
// brand "G" mark and the tagline. Generated, never a file in /public.
//
// /en: the English card, drawn entirely by ImageResponse (satori).
// /ar: a mirrored RTL card (motif left, content right). Satori ships no Arabic
// font, and even with one it measures and orders Arabic runs wrongly (words in
// left-to-right order, boxes wider than the drawn text, so nothing sits flush
// right). So the Arabic text (brand name, tagline, three paths: the strings
// from messages/ar.json Brand.* / Nav.path*) is pre-rendered with headless
// Chrome by `node scripts/make-og-ar.mjs` into assets/og/ar-text.png (a
// transparent 1200x630 PNG, ~16 KB, outside /public) and embedded here as a
// data URL <img>; the G mark, rings and domain are still drawn by satori. Re-run
// the script after editing that Arabic copy. If the PNG cannot be read the route
// falls back to the English card, never a 500.

export const alt = "Gestaltung360 | Shop parts. Get a part made. Plan a product.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

const INK = "#1c2434";
const BODY = "#475569";
const MUTED = "#64748b";
const COBALT = "#0e59c5";
const CANVAS = "#eef2f7";
const HAIRLINE = "#d3dbe6";

async function loadArabicText(): Promise<string | null> {
  try {
    const png = await readFile(path.join(process.cwd(), "assets", "og", "ar-text.png"));
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}

export default async function OpengraphImage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (locale === "ar") {
    const text = await loadArabicText();
    if (text) return arabicCard(text);
  }
  return englishCard();
}

function arabicCard(textPng: string) {
  // Mirror of the English card: motif on the left, content right-aligned.
  const ring = (d: number, color: string, width = 2) => (
    <div
      style={{
        position: "absolute",
        display: "flex",
        width: d,
        height: d,
        left: 240 - d / 2,
        top: 315 - d / 2,
        borderRadius: 9999,
        border: `${width}px solid ${color}`,
      }}
    />
  );
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: CANVAS,
          fontFamily: "sans-serif",
        }}
      >
        {ring(620, HAIRLINE)}
        {ring(440, HAIRLINE)}
        {ring(260, COBALT, 3)}
        <div
          style={{
            position: "absolute",
            display: "flex",
            width: 24,
            height: 24,
            left: 240 - 12,
            top: 315 - 12,
            borderRadius: 9999,
            background: COBALT,
          }}
        />
        {/* Arabic text, pre-rendered by scripts/make-og-ar.mjs (transparent, full size) */}
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
        <img src={textPng} width={1200} height={630} style={{ position: "absolute", left: 0, top: 0 }} />
        {/* Logo mark, top right */}
        <svg width="96" height="96" viewBox="0 0 48 48" fill="none" style={{ position: "absolute", left: 1024, top: 72 }}>
          <rect x="3" y="3" width="42" height="42" rx="11" stroke={COBALT} strokeWidth="2.4" />
          <path
            d="M33 17 L19 17 L19 31 L33 31 L33 24 L26 24"
            stroke="#3b82f6"
            strokeWidth="3"
            strokeLinejoin="miter"
            strokeLinecap="square"
          />
        </svg>
        <div style={{ position: "absolute", display: "flex", right: 80, bottom: 72, fontSize: 30, color: BODY }}>
          gestaltung360.com
        </div>
      </div>
    ),
    { ...size }
  );
}

function englishCard() {
  const ring = (d: number, color: string, width = 2) => (
    <div
      style={{
        position: "absolute",
        display: "flex",
        width: d,
        height: d,
        left: 960 - d / 2,
        top: 315 - d / 2,
        borderRadius: 9999,
        border: `${width}px solid ${color}`,
      }}
    />
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: CANVAS,
          fontFamily: "sans-serif",
        }}
      >
        {/* Blueprint motif: concentric circles on the right */}
        {ring(620, HAIRLINE)}
        {ring(440, HAIRLINE)}
        {ring(260, COBALT, 3)}
        <div
          style={{
            position: "absolute",
            display: "flex",
            width: 24,
            height: 24,
            left: 960 - 12,
            top: 315 - 12,
            borderRadius: 9999,
            background: COBALT,
          }}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "72px 80px",
            width: "100%",
            height: "100%",
          }}
        >
          {/* Logo mark + name */}
          <div style={{ display: "flex", alignItems: "center" }}>
            <svg width="96" height="96" viewBox="0 0 48 48" fill="none">
              <rect x="3" y="3" width="42" height="42" rx="11" stroke={COBALT} strokeWidth="2.4" />
              <path
                d="M33 17 L19 17 L19 31 L33 31 L33 24 L26 24"
                stroke="#3b82f6"
                strokeWidth="3"
                strokeLinejoin="miter"
                strokeLinecap="square"
              />
            </svg>
            <div style={{ display: "flex", marginLeft: 28, fontSize: 64, color: INK, letterSpacing: -1 }}>
              Gestaltung360
            </div>
          </div>

          {/* Tagline */}
          <div style={{ display: "flex", flexDirection: "column", maxWidth: 700 }}>
            <div style={{ display: "flex", fontSize: 76, lineHeight: 1.1, color: INK, letterSpacing: -2 }}>
              Shop parts.
            </div>
            <div style={{ display: "flex", fontSize: 76, lineHeight: 1.1, color: INK, letterSpacing: -2 }}>
              Get a part made.
            </div>
            <div style={{ display: "flex", fontSize: 76, lineHeight: 1.1, color: COBALT, letterSpacing: -2 }}>
              Plan a product.
            </div>
          </div>

          <div style={{ display: "flex", fontSize: 30, color: MUTED }}>
            <span style={{ display: "flex", color: BODY }}>gestaltung360.com</span>
            <span style={{ display: "flex", margin: "0 16px" }}>·</span>
            <span style={{ display: "flex" }}>Lusail, Qatar</span>
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
