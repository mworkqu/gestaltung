"use client";

// W7 (first-load JS budget): the signed-in "Your work" strip (P3-05) renders
// nothing for visitors without a session, so its code (queries, reorder, tiles)
// is loaded only once useAuth() reports a signed-in user. Same behaviour as
// before; the home's first-load JS no longer carries it.

import { lazy, Suspense } from "react";

import { useAuth } from "@/components/auth/auth-provider";

const Strip = lazy(() => import("./your-work-strip"));

export function YourWorkStrip() {
  const { ready, user } = useAuth();
  if (!ready || !user) return null;
  return (
    <Suspense fallback={null}>
      <Strip />
    </Suspense>
  );
}
