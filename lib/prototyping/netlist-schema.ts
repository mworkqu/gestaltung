// Server-only zod gate for a model's netlist. Shape only — references are
// checked by crossValidate() in ./netlist. Unknown keys are stripped.

import { z } from "zod";

import { PIN_TYPES } from "./netlist";

const name = (max: number) => z.string().trim().min(1).max(max);
const ref = z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_]{0,11}$/);

export const NetlistSchema = z.object({
  components: z
    .array(
      z.object({
        ref,
        function: name(80),
        bomId: name(40),
        currentMa: z.coerce.number().min(0).max(100000).nullable().optional(),
        pins: z
          .array(z.object({ id: name(12), name: name(24), type: z.enum(PIN_TYPES) }))
          .min(1)
          .max(48),
      })
    )
    .min(1)
    .max(40),
  nets: z
    .array(
      z.object({
        name: name(24),
        connections: z.array(z.object({ ref, pin: name(12) })).min(1).max(40),
      })
    )
    .max(120),
  powerRails: z
    .array(z.object({ name: name(16), sourceRef: ref, maxCurrentMa: z.coerce.number().positive().max(100000) }))
    .max(8),
  notes: z.array(z.string().trim().max(240)).max(12).default([]),
});
