"use client";

import dynamic from "next/dynamic";

// TEST-ONLY: the home hero's live enclosure, standing still, for the poster capture.
const Live = dynamic(() => import("@/components/home/hero-enclosure-live"), { ssr: false });

export function HeroPosterClient() {
  return (
    <div data-testid="hero-poster-box" style={{ width: 640, height: 480 }}>
      <Live still />
    </div>
  );
}
