"use client";

// TEST-ONLY (app/[locale]/e2e-fixtures/studio): the Design Studio on a mock
// StudioApi — no Supabase, no AI, no credit, nothing written.

import { useMemo } from "react";
import { useLocale } from "next-intl";

import { mockProductApi, mockStudioApi } from "@/lib/studio/client/mock";
import { GOLDEN_IDEAS, type GoldenIdea } from "@/lib/studio/product/__fixtures__/golden";
import { ROBOT_ARM_PART_IDS, ROBOT_ARM_SPEC } from "@/lib/studio/__fixtures__/robot-arm";
import type { StudioApi } from "@/lib/studio/client/api";
import { getPart } from "@/lib/studio/library";
import { buildWiring } from "@/lib/studio/netlist";
import { clampSpec, emptyStudioDoc, ENCLOSURE_TEMPLATES, parseStudioDoc, type EnclosureTemplate, type StudioDoc } from "@/lib/studio/schema";
import { markPassed } from "@/lib/studio/client/steps";
import { StudioShell } from "./StudioShell";
import { asLocale } from "@/lib/locale";

const FIXTURE_INITIAL = {
  ok: true as const,
  project: { name: "Desk buddy", consented: true, brief: null },
  doc: null,
  version: 0,
  persist: false,
};

export function StudioFixture({
  stored = false,
  step = null,
  preset = null,
  product = false,
  idea = null,
  admin = false,
  classTeam = false,
  finished = false,
}: {
  stored?: boolean;
  step?: string | null;
  preset?: "plant" | null;
  /** ?product=1: the P5-16 product pipeline (worker-side mock endpoints, no network). */
  product?: boolean;
  /** ?idea=<golden key>: one of the five acceptance ideas, parts picked and wired (robot_arm: Part E's 6-axis arm). */
  idea?: GoldenIdea["key"] | "robot_arm" | null;
  /** ?admin=1: the super_admin Engineer view. */
  admin?: boolean;
  /** ?class=1 (3c/3d): a school class team project — safety banner, no phone/email ask, no checkout. */
  classTeam?: boolean;
  /** ?finished=1: every step before Make is done, so ?step=make opens (3c e2e). */
  finished?: boolean;
}) {
  const locale = asLocale(useLocale());
  const api = useMemo(() => {
    const base = withCounts(withGate(withLook(withDelay(stored ? withTabStore(mockStudioApi()) : mockStudioApi()))));
    return product ? { ...base, product: mockProductApi() } : base;
  }, [stored, product]);
  // ?preset=plant (read by the page) opens on the Enclosure step with a plant idea already wired (W6 e2e).
  const initial = useMemo(() => {
    const golden =
      idea === "robot_arm" ? { spec: ROBOT_ARM_SPEC, partIds: ROBOT_ARM_PART_IDS } : idea ? GOLDEN_IDEAS.find((g) => g.key === idea) : null;
    const base = golden ? goldenDoc(golden, locale) : preset === "plant" ? plantDoc(locale) : null;
    const doc = base && finished ? finishedDoc(base) : base;
    return doc ? { ...FIXTURE_INITIAL, project: { ...FIXTURE_INITIAL.project, name: doc.spec.name }, doc } : FIXTURE_INITIAL;
  }, [locale, preset, idea, finished]);
  // Same first state the mock's load() gives, handed over up front like the real page does
  // (lib/studio/server/initial.ts), so the fixture's first render matches production.
  // ?store=1 (W1 e2e): the doc lives in this tab's sessionStorage and loads in the browser,
  // so leaving for the sign-in page and coming back finds the same project.
  return (
    <StudioShell
      projectId={api.projectId}
      destination="Google Gemini"
      api={api}
      initial={stored ? null : initial}
      requestedStep={stored || idea ? step : null}
      isAdmin={admin}
      classTeam={classTeam ? { teamName: "Team Falcon", className: "Grade 8 robotics" } : null}
    />
  );
}

/** One of the five P5-16 acceptance ideas, parts picked and wired (the Enclosure step is next). */
function goldenDoc(g: Pick<GoldenIdea, "spec" | "partIds">, locale: "en" | "ar"): StudioDoc {
  const counts = new Map<string, number>();
  const picked = g.partIds
    .filter((id) => getPart(id))
    .map((id) => {
      const n = (counts.get(id) ?? 0) + 1;
      counts.set(id, n);
      return { partId: id, instanceId: `${id}_${n}`, label: getPart(id)!.name[locale], reason: "" };
    });
  const w = buildWiring(picked, g.spec, getPart, locale);
  return { ...emptyStudioDoc(g.spec), components: w.components, netlist: w.netlist, checks: w.checks };
}

/**
 * ?finished=1: the same doc with Enclosure, Print and Code already done, so the
 * Make step is reachable. An unlocked product counts as a drawn case AND its
 * printed bodies (lib/studio/client/steps.ts stepDone), which needs no
 * geometry in the fixture; Code is a pass-only step.
 */
function finishedDoc(doc: StudioDoc): StudioDoc {
  return {
    ...doc,
    product: { designs: [], chosenId: null, unlockedId: "fixture-design", specHash: "" },
    answers: markPassed(doc.answers, "code"),
  };
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

/** Idea, parts and wiring done for "automatic small plant watering monitor". */
function plantDoc(locale: "en" | "ar"): StudioDoc {
  const spec = clampSpec({
    name: locale === "ar" ? "مراقب النبتة" : "Plant buddy",
    oneLine: "Automatic small plant watering monitor",
    use: "desk",
    power: "usb",
    environment: "indoor",
    features: ["Soil moisture", "Water pump"],
    inputs: [],
    outputs: ["relay", "led"],
    sizeHint: "palm",
    style: "rounded",
    quantity: 1,
  });
  const picked = ["esp32_devkit", "soil_moisture_cap", "relay_module", "led_5mm"]
    .filter((id) => getPart(id))
    .map((id) => ({ partId: id, instanceId: `${id}_1`, label: getPart(id)!.name[locale], reason: "" }));
  const w = buildWiring(picked, spec, getPart, locale);
  return { ...emptyStudioDoc(spec), components: w.components, netlist: w.netlist, checks: w.checks };
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
      const round = template === "dome_base" || template === "lantern" || template === "puck" || template === "stake_pod";
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
    window.__g360Ai = counts;
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
