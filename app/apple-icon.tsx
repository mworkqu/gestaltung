import { ImageResponse } from "next/og";

import { BRAND_MARK_PATH } from "@/lib/brand-mark";

// iOS home-screen icon (180x180), generated at build time like the share card:
// the light "G" on the ink colour from DESIGN.md, nothing stored in /public.
// iOS rounds the corners itself, so the square is full-bleed.

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1c2434",
        }}
      >
        <svg width="180" height="180" viewBox="212 177 600 600" xmlns="http://www.w3.org/2000/svg">
          <path fill="#dbe7f8" fillRule="evenodd" d={BRAND_MARK_PATH} />
        </svg>
      </div>
    ),
    { ...size }
  );
}
