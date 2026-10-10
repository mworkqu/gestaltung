// Printable mechanical parts (Phase 2). Pure orchestration around an injected
// StudioCall. Only templates + numbers from the model; clampMechParts keeps
// every number in MECH_PARAMS' range. Two failures → the deterministic list
// (mech-default.ts).

import { MECH_TEMPLATES, clampMechParts, type ClampLog, type MechPart } from "../schema";
import { defaultMechParts, type MechSummary } from "./mech-default";
import { MECH_RESPONSE_SCHEMA, MECH_SYSTEM, mechPrompt } from "./prompts";
import { isObj, type Outcome, type StudioCall } from "./types";

export function validateMech(raw: unknown, opts: { summary: MechSummary; log: ClampLog }): { value: MechPart[] | null; errors: string[] } {
  const list = isObj(raw) ? raw.parts : raw;
  if (!Array.isArray(list)) return { value: null, errors: ["the answer must be {parts: MechPart[]}"] };
  const errors: string[] = [];
  const instances = new Set(opts.summary.components.map((c) => c.instanceId));
  list.forEach((p, i) => {
    if (!isObj(p) || typeof p.template !== "string" || !(MECH_TEMPLATES as readonly string[]).includes(p.template.trim().toLowerCase()))
      errors.push(`parts[${i}].template must be one of: ${MECH_TEMPLATES.join(", ")}`);
    else if (typeof p.forInstance === "string" && p.forInstance && !instances.has(p.forInstance))
      errors.push(`parts[${i}].forInstance "${p.forInstance}" is not a component instanceId`);
  });
  if (errors.length) return { value: null, errors: errors.slice(0, 6) };
  const value = clampMechParts(list, opts.log);
  if (!value.length) return { value: null, errors: ["list at least the lid and the base"] };
  return { value, errors: [] };
}

export async function runMech(opts: { call: StudioCall; summary: MechSummary }): Promise<Outcome<MechPart[]>> {
  const log: ClampLog = [];
  const r = await opts.call<MechPart[]>({
    step: "mech",
    system: MECH_SYSTEM,
    prompt: mechPrompt({ summary: opts.summary }),
    schema: MECH_RESPONSE_SCHEMA,
    validate: (raw) => {
      const attempt: ClampLog = [];
      const res = validateMech(raw, { summary: opts.summary, log: attempt });
      if (res.value) log.splice(0, log.length, ...attempt);
      return res;
    },
  });
  if (r.ok) return { ok: true, value: r.value, source: "model", clampLog: log, problems: [] };
  if (r.error === "paused" || r.error === "rate_limited") return { ok: false, error: r.error, clampLog: log, problems: r.problems };
  const fallback: ClampLog = [];
  return { ok: true, value: defaultMechParts(opts.summary, fallback), source: "default", clampLog: fallback, problems: r.problems };
}
