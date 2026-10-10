// Design Studio API — request bodies and status mapping. Pure (tested).

import { z } from "zod";

import type { CanUse } from "@/lib/credits/constants";
import { ProductSpecSchema, StudioComponentSchema, StudioDocSchema, clampSpec, type ProductSpec } from "../schema";

const Locale = z.unknown().optional().transform((v): "en" | "ar" => (v === "ar" ? "ar" : "en"));
const ProjectId = z.string().uuid();

/** Any spec-like value → a valid ProductSpec (quantity is always 1). */
const SpecIn = z.unknown().transform((v): ProductSpec => {
  const r = ProductSpecSchema.safeParse(v);
  return r.success ? r.data : clampSpec(v);
});

export const SpecBody = z.object({
  projectId: ProjectId,
  locale: Locale,
  idea: z.string().max(4000).optional().default(""),
  messages: z.array(z.unknown()).max(64).optional().default([]),
});

export const PickBody = z.object({
  projectId: ProjectId,
  locale: Locale,
  spec: SpecIn,
});

export const WiringBody = z.object({
  projectId: ProjectId,
  locale: Locale,
  spec: SpecIn,
  components: z.array(StudioComponentSchema).min(1).max(40),
});

const Dim = z.number().finite().min(1).max(1000);
export const EnclosureBody = z.object({
  projectId: ProjectId,
  locale: Locale,
  spec: SpecIn,
  components: z.array(z.object({ partId: z.string().max(60), label: z.string().max(60).optional() })).max(40).optional().default([]),
  bbox: z.object({ w: Dim, d: Dim, h: Dim }),
});

export const MechBody = z.object({
  projectId: ProjectId,
  /** Outer enclosure size from the browser's builder; else estimated from the layout. */
  dims: z.object({ w: Dim, d: Dim, h: Dim }).optional(),
});

export const DocPutBody = z.object({
  projectId: ProjectId,
  doc: StudioDocSchema,
  version: z.number().int().min(0),
});

/** Model-call failure → HTTP status. */
export function callErrorStatus(error: "paused" | "rate_limited" | "unavailable" | "invalid"): number {
  if (error === "paused" || error === "rate_limited") return 429;
  if (error === "invalid") return 502;
  return 503;
}

/** canUse() refusal → the same answers /api/netlist and /api/cad give. */
export function creditDenied(access: Pick<CanUse, "allowed" | "reason">): { status: number; error: string } | null {
  if (access.allowed) return null;
  const reason = access.reason ?? "no_credits";
  if (reason === "sign_in") return { status: 401, error: "sign_in" };
  if (reason === "no_credits") return { status: 402, error: "no_credits" };
  if (reason === "not_found") return { status: 404, error: "not_found" };
  return { status: 503, error: reason };
}

/** cad RPC error message → status (raised codes from 0043 / 0042). */
export const CAD_STATUS: Record<string, number> = { sign_in: 401, no_credits: 402, not_found: 404, too_many_failed: 429 };

export function cadRpcError(message: string | undefined): { status: number; error: string } {
  const code = Object.keys(CAD_STATUS).find((c) => message?.includes(c));
  return code ? { status: CAD_STATUS[code], error: code } : { status: 500, error: "failed" };
}

type RpcError = { code?: string; message?: string } | null;
/** The function does not exist yet (migration not run). */
export const rpcMissing = (e: RpcError) =>
  !!e && (e.code === "PGRST202" || e.code === "42883" || /could not find the function/i.test(e.message ?? ""));

/** 3 versions per CAD credit: cad_deliver reports the regens left after this one. */
export function versionFromRegens(regens: unknown): { version: number; versionsLeft: number } {
  const left = typeof regens === "number" && Number.isFinite(regens) ? Math.max(0, Math.min(2, Math.round(regens))) : 0;
  return { version: 3 - left, versionsLeft: left };
}

/** Stable comparison key for "is the wiring request unchanged?". */
export function wiringKey(spec: ProductSpec, components: readonly { partId: string; instanceId: string }[]): string {
  return JSON.stringify({
    spec: { ...spec, features: [...spec.features], inputs: [...spec.inputs].sort(), outputs: [...spec.outputs].sort() },
    components: components.map((c) => [c.instanceId, c.partId]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
  });
}
