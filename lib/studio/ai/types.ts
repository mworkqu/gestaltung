// Shared shapes for the Design Studio AI orchestrators.
//
// Each orchestrator (spec / pick / enclosure / mech) takes an injected
// StudioCall with validatedCall's contract (lib/prototyping/ai-call.ts): the
// answer goes through `validate`; a rejected answer is sent back ONCE with the
// problems; a second rejection returns {ok:false, error:"invalid"}. The
// orchestrator then falls back to a SAFE DEFAULT. Clamp logs are returned for
// the server console / admin only — never put them in a response body.

import type { CallResult } from "@/lib/prototyping/ai-call";
import type { ClampLog } from "../schema";

export type StudioStep = "spec" | "pick" | "enclosure" | "mech";

export type Validated<T> = { value: T | null; errors: string[] };

export type StudioCallRequest<T> = {
  step: StudioStep;
  system: string;
  prompt: string;
  schema: object;
  validate: (raw: unknown) => Validated<T>;
};

export type StudioCall = <T>(req: StudioCallRequest<T>) => Promise<CallResult<T>>;

/** A result the route can return: from the model, or the safe default. */
export type Outcome<T> =
  | { ok: true; value: T; source: "model" | "default"; clampLog: ClampLog; problems: string[]; model?: string | null }
  /** paused = daily guard; the route answers 429 and never falls back. */
  | { ok: false; error: "paused" | "rate_limited" | "unavailable"; clampLog: ClampLog; problems: string[] };

export const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Collapse whitespace, trim, cut to max (on a code-point boundary). */
export function cut(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  const s = v.replace(/\s+/g, " ").trim();
  const chars = [...s];
  return chars.length > max ? chars.slice(0, max).join("").trim() : s;
}
