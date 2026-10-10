"use client";

// TEST-ONLY (app/[locale]/e2e-fixtures/studio): the Design Studio on a mock
// StudioApi — no Supabase, no AI, no credit, nothing written.

import { useMemo } from "react";

import { mockStudioApi } from "@/lib/studio/client/mock";
import type { StudioApi } from "@/lib/studio/client/api";
import { ENCLOSURE_TEMPLATES, type EnclosureTemplate } from "@/lib/studio/schema";
import { StudioShell } from "./StudioShell";

const FIXTURE_INITIAL = {
  ok: true as const,
  project: { name: "Desk buddy", consented: true, brief: null },
  doc: null,
  version: 0,
  persist: false,
};

export function StudioFixture() {
  const api = useMemo(() => withLook(withDelay(mockStudioApi())), []);
  // Same first state the mock's load() gives, handed over up front like the real page does
  // (lib/studio/server/initial.ts), so the fixture's first render matches production.
  return <StudioShell projectId={api.projectId} destination="Google Gemini" api={api} initial={FIXTURE_INITIAL} />;
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

/** ?look=<template> makes the mocked "Draw it" return that template (owner screenshots). */
function withLook(api: StudioApi): StudioApi {
  let look: EnclosureTemplate | null = null;
  try {
    const v = new URLSearchParams(window.location.search).get("look");
    look = (ENCLOSURE_TEMPLATES as readonly string[]).includes(v ?? "") ? (v as EnclosureTemplate) : null;
  } catch {
    /* no window */
  }
  if (!look) return api;
  const template = look;
  return {
    ...api,
    async enclosure(...a: Parameters<StudioApi["enclosure"]>) {
      const r = await api.enclosure(...a);
      if (!r.ok) return r;
      const round = template === "dome_base" || template === "lantern" || template === "puck";
      return {
        ...r,
        data: {
          ...r.data,
          enclosure: {
            ...r.data.enclosure,
            template,
            ...(round ? { proportions: { ...r.data.enclosure.proportions, widthToDepth: 1 } } : {}),
            ...(template === "dome_base" ? { feet: "ring" as const } : {}),
          },
        },
      };
    },
  };
}
