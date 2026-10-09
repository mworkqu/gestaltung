"use client";

// Fires `pricing_viewed` once when /pricing is shown (the page is a server
// page). Renders nothing.

import { useEffect } from "react";

import { track } from "@/lib/analytics";

export function PricingViewed() {
  useEffect(() => {
    track("pricing_viewed");
  }, []);
  return null;
}
