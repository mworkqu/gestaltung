"use client";

import { useEffect } from "react";

import { trackDemand, type DemandKind } from "@/lib/store/demand-client";

// Records one demand signal when mounted (a product view, a search that found
// nothing). Renders nothing.
export function DemandBeacon({ kind, partId, searchTerm }: { kind: DemandKind; partId?: string; searchTerm?: string }) {
  useEffect(() => {
    trackDemand(kind, { partId, searchTerm });
  }, [kind, partId, searchTerm]);
  return null;
}
