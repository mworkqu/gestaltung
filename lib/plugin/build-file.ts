/**
 * The build file a client's own AI sends through the Gestaltung360 chat plugin
 * (MCP server at /api/mcp). It is a structured project summary, never a chat
 * transcript: every string has a hard cap and unknown keys are stripped, so no
 * field can carry a conversation. Pure (zod only).
 */
import { z } from "zod";
import { COLOURS, ENCLOSURE_TEMPLATES, FINISHES } from "@/lib/studio/schema-enums";

export const BUILD_FILE_VERSION = 1 as const;

export const BUILD_LIMITS = {
  name: 60,
  whatItDoes: 400,
  short: 140,
  decisions: 12,
  quotes: 10,
  parts: 24,
  partQty: 8,
  role: 40,
  wiringNotes: 600,
  codeSource: 40_000,
  lookLabel: 24,
  lookNotes: 400,
  cadPrompt: 2_000,
  openscad: 60_000,
  libraryId: 64,
} as const;

const L = BUILD_LIMITS;

/** Trimmed string with a hard cap. Over the cap is an error, never a silent cut. */
const text = (max: number, min = 0) => z.string().trim().min(min).max(max);

export const PLUGIN_POWERS = ["usb", "battery", "adapter", "solar"] as const;
export const PLUGIN_WHERE = ["indoor", "outdoor", "both"] as const;

export const BuildSummarySchema = z.object({
  what_it_does: text(L.whatItDoes, 1).describe("What the product does, in plain words."),
  who_for: text(L.short).default("").describe("Who it is for."),
  where_used: z.enum(PLUGIN_WHERE),
  power: z.enum(PLUGIN_POWERS),
  size_note: text(L.short).default("").describe("Size wishes, e.g. 'fits on a balcony rail'."),
  decisions: z.array(text(L.short, 1)).max(L.decisions).default([])
    .describe("Each decision made with the client, one short line each."),
});

export const BuildPartSchema = z.object({
  library_id: z.string().trim().min(1).max(L.libraryId).regex(/^[a-z0-9_]+$/, "library ids are lowercase letters, digits and _")
    .describe("A part id from get_design_rules. Never invent one."),
  qty: z.number().int().min(1).max(L.partQty).default(1),
  role: text(L.role).optional().describe("What this part does in the product."),
});

export const BuildCodeSchema = z.object({
  language: z.literal("arduino"),
  board: z.string().trim().min(1).max(L.libraryId).describe("library_id of the controller board in parts[]."),
  source: text(L.codeSource, 1),
});

export const BuildLookSchema = z.object({
  template: z.enum(ENCLOSURE_TEMPLATES),
  colour: z.enum(COLOURS),
  finish: z.enum(FINISHES),
  label: text(L.lookLabel).optional().describe("Short text printed on the case."),
  notes: text(L.lookNotes).default(""),
});

export const BuildCadSchema = z
  .object({
    prompt: text(L.cadPrompt).optional()
      .describe("A written brief for our engineer to model the case (sizes in mm, openings, mounting)."),
    openscad: text(L.openscad).optional().describe("Optional OpenSCAD source for the case."),
  })
  .refine((c) => Boolean(c.prompt) || Boolean(c.openscad), {
    message: "cad needs a prompt, openscad code, or both",
  });

export const BuildFileSchema = z.object({
  version: z.literal(BUILD_FILE_VERSION),
  name: text(L.name, 3),
  summary: BuildSummarySchema,
  requirement_quotes: z.array(text(L.short, 1)).max(L.quotes).default([])
    .describe("Up to 10 short quotes of the client's own words for key requirements only (max 140 chars each). Never paste the conversation."),
  parts: z.array(BuildPartSchema).min(1).max(L.parts),
  wiring_notes: text(L.wiringNotes).optional()
    .describe("Optional notes for our engineer. Our wiring is always recomputed from the parts."),
  code: BuildCodeSchema.optional(),
  look: BuildLookSchema,
  cad: BuildCadSchema,
});

export type BuildFile = z.infer<typeof BuildFileSchema>;
export type BuildFileInput = z.input<typeof BuildFileSchema>;

export type BuildFileResult =
  | { ok: true; value: BuildFile }
  | { ok: false; errors: string[] };

/** Field path + message, short enough to hand back to the client's AI. */
export function parseBuildFile(raw: unknown): BuildFileResult {
  const r = BuildFileSchema.safeParse(raw);
  if (r.success) return { ok: true, value: r.data };
  const errors = r.error.issues.slice(0, 20).map((i) => {
    const path = i.path.length ? i.path.join(".") : "(root)";
    return `${path}: ${i.message}`.slice(0, 200);
  });
  return { ok: false, errors };
}

/** JSON schema of the build file, for get_design_rules and the MCP resource. */
export function buildFileJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(BuildFileSchema, { io: "input" }) as Record<string, unknown>;
}

/** A tiny valid example (also a test fixture). Part ids must exist in the code library. */
export const EXAMPLE_BUILD_FILE: BuildFileInput = {
  version: 1,
  name: "Balcony plant waterer",
  summary: {
    what_it_does: "Checks the soil and waters one pot with a small pump when the soil is dry. A light ring shows the soil state.",
    who_for: "A busy person with plants on a balcony",
    where_used: "outdoor",
    power: "usb",
    size_note: "Small enough to sit beside the pot",
    decisions: ["Water for 5 seconds when dry", "Check the soil every 10 minutes"],
  },
  requirement_quotes: ["it has to survive the balcony sun"],
  parts: [
    { library_id: "esp32_c3_mini", qty: 1, role: "controller" },
    { library_id: "soil_moisture_cap", qty: 1, role: "soil sensor" },
    { library_id: "pump_5v", qty: 1, role: "water pump" },
    { library_id: "motor_driver", qty: 1, role: "switches the pump" },
    { library_id: "ws2812_ring", qty: 1, role: "status light" },
  ],
  look: { template: "stake_pod", colour: "sage", finish: "matte_plastic", notes: "Rounded, quiet look" },
  cad: { prompt: "Stake-shaped case about 90 x 60 x 35 mm with a cable hole for the pump tube." },
};
