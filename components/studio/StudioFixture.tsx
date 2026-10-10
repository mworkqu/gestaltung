"use client";

// TEST-ONLY (app/[locale]/e2e-fixtures/studio): the Design Studio on a mock
// StudioApi — no Supabase, no AI, no credit, nothing written.

import { useMemo } from "react";

import { mockStudioApi } from "@/lib/studio/client/mock";
import type { StudioApi } from "@/lib/studio/client/api";
import { StudioShell } from "./StudioShell";

export function StudioFixture() {
  const api = useMemo(() => withDelay(mockStudioApi()), []);
  return <StudioShell projectId={api.projectId} destination="Google Gemini" api={api} />;
}

/** ?delay=<ms> adds that wait to the wiring + enclosure calls, so the e2e can see the skeletons. */
function withDelay(api: StudioApi): StudioApi {
  let ms = 0;
  try {
    ms = Math.min(5000, Math.max(0, Number(new URLSearchParams(window.location.search).get("delay")) || 0));
  } catch {
    /* no window */
  }
  if (!ms) return api;
  const wait = () => new Promise((r) => setTimeout(r, ms));
  const slow = ["wiring", "enclosure"] as const;
  const out = { ...api } as StudioApi;
  for (const k of slow) {
    const fn = api[k] as (...a: unknown[]) => Promise<unknown>;
    (out as unknown as Record<string, unknown>)[k] = async (...a: unknown[]) => {
      await wait();
      return fn(...a);
    };
  }
  return out;
}
