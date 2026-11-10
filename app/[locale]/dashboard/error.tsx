"use client";

import { RouteError } from "@/components/route-state/route-error";

export default function DashboardError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} />;
}
