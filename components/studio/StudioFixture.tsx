"use client";

// TEST-ONLY (app/[locale]/e2e-fixtures/studio): the Design Studio on a mock
// StudioApi — no Supabase, no AI, no credit, nothing written.

import { useMemo } from "react";

import { mockStudioApi } from "@/lib/studio/client/mock";
import type { StudioApi } from "@/lib/studio/client/api";
import { ENCLOSURE_TEMPLATES, parseStudioDoc, type EnclosureTemplate } from "@/lib/studio/schema";
import { StudioShell } from "./StudioShell";

const FIXTURE_INITIAL = {
  ok: true as const,
  project: { name: "Desk buddy", consented: true, brief: null },
  doc: null,
  version: 0,
  persist: false,
};

export function StudioFixture({ stored = false, step = null }: { stored?: boolean; step?: string | null }) {
  const api = useMemo(() => withCounts(withGate(withLook(withDelay(stored ? withTabStore(mockStudioApi()) : mockStudioApi())))), [stored]);
  // Same first state the mock's load() gives, handed over up front like the real page does
  // (lib/studio/server/initial.ts), so the fixture's first render matches production.
  // ?store=1 (W1 e2e): the doc lives in this tab's sessionStorage and loads in the browser,
  // so leaving for the sign-in page and coming back finds the same project.
  return (
    <StudioShell
      projectId={api.projectId}
      destination="Google Gemini"
      api={api}
      initial={stored ? null : FIXTURE_INITIAL}
      requestedStep={stored ? step : null}
    />
  );
}

const TAB_STORE_KEY = "g360:e2e-studio-doc";

/** ?store=1: load/save the doc in sessionStorage (one project per tab). */
function withTabStore(api: StudioApi): StudioApi {
  return {
    ...api,
    async load() {
      const r = await api.load();
      if (!r.ok) return r;
      try {
        const raw = sessionStorage.getItem(TAB_STORE_KEY);
        const saved = raw ? (JSON.parse(raw) as { doc: unknown; version: number }) : null;
        const doc = saved ? parseStudioDoc(saved.doc) : null;
        return { ...r, doc, version: saved?.version ?? 0, persist: true };
      } catch {
        return { ...r, persist: true };
      }
    },
    async save(doc, version) {
      try {
        sessionStorage.setItem(TAB_STORE_KEY, JSON.stringify({ doc, version: version + 1 }));
      } catch {
        /* storage blocked */
      }
      return { ok: true, version: version + 1 };
    },
  };
}

/** ?gate=sign_in (W1 e2e): drawing the wiring answers "sign in first", like a guest on the live site. */
function withGate(api: StudioApi): StudioApi {
  let gate: string | null = null;
  try {
    gate = new URLSearchParams(window.location.search).get("gate");
  } catch {
    /* no window */
  }
  if (gate !== "sign_in") return api;
  return {
    ...api,
    async wiring() {
      return { ok: false, status: 401, error: "sign_in" };
    },
  };
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

/** W8 e2e: how many times the (mocked) model was asked, as window.__g360Ai = {spec, pick}. The tab cache sits ABOVE this. */
function withCounts(api: StudioApi): StudioApi {
  const counts = { spec: 0, pick: 0 };
  let ms = 0;
  try {
    (window as unknown as { __g360Ai?: typeof counts }).__g360Ai = counts;
    ms = Math.min(5000, Math.max(0, Number(new URLSearchParams(window.location.search).get("pickdelay")) || 0));
  } catch {
    /* no window (server render) */
  }
  return {
    ...api,
    async spec(...a: Parameters<StudioApi["spec"]>) {
      counts.spec++;
      return api.spec(...a);
    },
    async pick(...a: Parameters<StudioApi["pick"]>) {
      counts.pick++;
      if (ms) await new Promise((r) => setTimeout(r, ms));
      return api.pick(...a);
    },
  };
}
