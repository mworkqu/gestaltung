// Server-only (imported by app/api/analyse and the providers). The zod gate
// every provider response passes through before it can reach the UI. z.object() strips unknown keys, so a `confidence` field — or anything
// else a model adds — is dropped here rather than displayed.

import { z } from "zod";

import { DISCIPLINES, MAX_BRIEF_CHARS } from "./constants";

const text = (max: number) => z.string().trim().min(1).max(max);
const id = z.string().trim().regex(/^[a-z][a-z0-9_]{0,39}$/);
const kind = z.enum(DISCIPLINES);

export const DisciplinesSchema = z.array(kind).max(3).transform((d) => [...new Set(d)]);

export const RequirementsSchema = z.object({
  requirements: z
    .array(
      z.object({
        id,
        label: text(80),
        // Models sometimes send a quantity as a number; the contract is text.
        value: z.union([z.string(), z.number()]).transform((v) => String(v).trim()).pipe(text(200)),
        source: z.enum(["brief", "assumed"]),
      })
    )
    .max(30),
  questions: z
    .array(
      z.object({
        id,
        label: text(120),
        type: z.enum(["number", "select", "boolean"]),
        options: z.array(text(60)).max(12).optional(),
      })
    )
    .max(15),
});

export const AnalysisSchema = RequirementsSchema.extend({
  summary: z.string().trim().max(1200),
  disciplines: DisciplinesSchema,
  suggestedParts: z
    .array(z.object({ name: text(80), kind, note: z.string().trim().max(300) }))
    .max(20),
});

export const AnalysisRequestSchema = z.object({
  brief: z.string().trim().min(1).max(MAX_BRIEF_CHARS),
  answers: z
    .array(z.object({ id, label: text(120), value: z.string().max(200).nullable() }))
    .max(30),
  locale: z.enum(["en", "ar"]),
});
