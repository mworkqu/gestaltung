// The electronics builder's two model calls. Server-only.
//
//   listElectronics  — what to BUY for the electronics: boards and modules,
//                      sensors and actuators, LEDs, switches, connectors — with
//                      a short name, a spec, a quantity, an attribute class and
//                      target attributes. Never resistors, capacitors, diodes
//                      or transistors (our rules derive those from the circuit)
//                      and never a SKU, part number, price or stock level.
//   generateNetlist  — how those parts connect (components, pins, nets, rails),
//                      validated by zod and crossValidate().
//
// Both go through validatedCall (one retry, metered, recorded raw + parsed).

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { BuildRoute } from "./analysis";
import { AttributesSchema } from "./analysis-schema";
import type { ProjectLine } from "./bom";
import { validatedCall, type CallResult } from "./ai-call";
import { crossValidate, type Netlist } from "./netlist";
import { NetlistSchema } from "./netlist-schema";
import { attributesGuide, bomLineSchema } from "./providers/gemini-attrs";
import type { AttrClass } from "@/lib/store/attributes";

/** Classes the model may use for electronics lines. Passives are ours. */
const MODEL_CLASSES: AttrClass[] = ["board", "module", "ic", "sensor", "actuator", "led", "switch", "header", "power"];
const MODEL_GROUPS = ["boards", "sensors", "discrete", "consumables"] as const;

const ElectronicsSchema = z.object({
  lines: z
    .array(
      z.object({
        id: z.string().trim().regex(/^[a-z][a-z0-9_]{0,39}$/),
        function: z.string().trim().min(1).max(60),
        spec: z.string().trim().max(200),
        quantity: z.coerce.number().int().min(1).max(500),
        critical: z.boolean().catch(true),
        class: z.string().refine((c) => (MODEL_CLASSES as string[]).includes(c), "unknown class"),
        group: z.enum(MODEL_GROUPS).catch("boards"),
        attributes: AttributesSchema.optional(),
      })
    )
    .min(1)
    .max(40),
});

const ELECTRONICS_SYSTEM = `You list the electronics to BUY for a small product and return JSON only.

Rules:
- lines: every board, module, sensor, actuator, LED, switch, connector and power part the product needs, for ONE unit.
- function: a SHORT NAME of the item, 1 to 4 words, a noun ("development board", "soil moisture sensor", "status LED", "servo motor") — never a sentence.
- spec: what it must meet, in orderable terms ("3.3 V logic, WiFi", "capacitive, analog output, 3.3–5 V").
- You MAY name a common board family customers buy by (Arduino Uno, Arduino Nano, ESP32, Raspberry Pi, Raspberry Pi Pico) in the spec and attributes. NEVER a vendor SKU, manufacturer part number, brand, price, stock level or lead time.
- quantity: real counts. Four LEDs means quantity 4.
- Do NOT list resistors, capacitors, diodes or transistors: they are derived from the circuit by our own rules.
- Do NOT list breadboards, jumper wires, cables or tools: they are added by our own rules.
- group: boards (boards and modules, motor drivers, relay and display modules), sensors (sensors, actuators, servos, motors, pumps, buzzers, LEDs), discrete (switches, headers, connectors, bare ICs), consumables (batteries, solar panels, power supplies).
- EVERY line must carry class, group and attributes. class and attributes use ONLY these keys:
${attributesGuide(MODEL_CLASSES)}
- Do not include any confidence, probability or score.`;

export async function listElectronics(opts: {
  supabase: SupabaseClient;
  projectId: string;
  summary: string;
  facts: string;
  route: BuildRoute;
  locale: "en" | "ar";
}): Promise<CallResult<ProjectLine[]>> {
  const prompt = `Write function and spec in ${opts.locale === "ar" ? "Arabic" : "English"}; ids, classes, attribute keys and option values stay in English.

Build route: ${opts.route === "prototype" ? "prototype — development boards, modules and discrete parts on a breadboard or perfboard" : "custom PCB — but the circuit is still prototyped first from development boards and modules, so list the prototype build"}.

Known facts:
${opts.facts || "(none)"}

Product:
"""
${opts.summary.slice(0, 2000)}
"""`;
  return validatedCall<ProjectLine[]>({
    ...opts,
    feature: "electronics",
    system: ELECTRONICS_SYSTEM,
    prompt,
    schema: {
      type: "OBJECT",
      properties: {
        lines: { type: "ARRAY", items: bomLineSchema(MODEL_CLASSES, MODEL_GROUPS, ["electronics"], ["class", "group", "attributes"]) },
      },
      required: ["lines"],
    },
    validate: (raw) => {
      const r = ElectronicsSchema.safeParse(raw);
      if (!r.success)
        return { value: null, errors: r.error.issues.slice(0, 10).map((i) => `${i.path.join(".")}: ${i.message}`) };
      const seen = new Set<string>();
      const lines: ProjectLine[] = [];
      for (const l of r.data.lines) {
        if (seen.has(l.id)) continue;
        seen.add(l.id);
        lines.push({
          id: `e_${l.id}`.slice(0, 40),
          function: l.function,
          spec: l.spec,
          quantity: l.quantity,
          kind: "electronics",
          critical: l.critical,
          class: l.class,
          group: l.group,
          attributes: { ...(l.attributes ?? {}), class: l.class },
          origin: "electronics",
        });
      }
      return { value: lines, errors: [] };
    },
  });
}

const PIN_TYPE_ENUM = ["power_in", "power_out", "ground", "input", "output", "bidirectional", "passive"];
const str = { type: "STRING" };
const NETLIST_SCHEMA = {
  type: "OBJECT",
  properties: {
    components: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          ref: str,
          function: str,
          bomId: str,
          currentMa: { type: "NUMBER" },
          pins: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: { id: str, name: str, type: { type: "STRING", format: "enum", enum: PIN_TYPE_ENUM } },
              required: ["id", "name", "type"],
            },
          },
        },
        required: ["ref", "function", "bomId", "pins"],
      },
    },
    nets: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: str,
          connections: {
            type: "ARRAY",
            items: { type: "OBJECT", properties: { ref: str, pin: str }, required: ["ref", "pin"] },
          },
        },
        required: ["name", "connections"],
      },
    },
    powerRails: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { name: str, sourceRef: str, maxCurrentMa: { type: "NUMBER" } },
        required: ["name", "sourceRef", "maxCurrentMa"],
      },
    },
    notes: { type: "ARRAY", items: str },
  },
  required: ["components", "nets", "powerRails", "notes"],
};

const NETLIST_SYSTEM = `You design the wiring of a small electronic product from its bill of materials and return JSON only.

Rules:
- components: one per physical electronic part, using ONLY lines from the bill of materials given. bomId is exactly that line's id. A line with quantity 2 becomes two components with the same bomId.
- ref: a standard designator — U (ICs, boards, modules), LED (LEDs), J (connectors, batteries, panels), M (motors, servos, pumps), SW (switches, buttons), BT. Unique.
- pins: the pins that are actually used. id short (e.g. "1", "VCC", "SIG"); name as printed; type one of power_in, power_out, ground, input, output, bidirectional, passive.
- currentMa: the component's typical current draw in mA (0 for passives and sources).
- Declare under each component EVERY pin you are going to connect, and connect ONLY pins you declared. Never invent a pin (no "NC", no pin that is not in that component's own pins list), and never leave a pin id empty. A pin that is not used is simply left out.
- nets: every electrical connection. Each connection names a ref and a pin id that exist. A pin is on at most one net. Name power nets after their rail voltage ("5V", "3V3", "12V") and the ground net "GND". Name I2C nets SDA and SCL.
- Connect LEDs and buttons directly to the board pins they use: the series resistors and pull-ups are added by our own rules afterwards.
- powerRails: each supply voltage — name, the ref of the component that supplies it (its pin must be type power_out), and the most current it can supply in mA.
- notes: short practical cautions only.
- Never name a brand, manufacturer, model or part number. Never give a price.
- Do not include any confidence, probability or score.`;

export async function generateNetlist(opts: {
  supabase: SupabaseClient;
  projectId: string;
  summary: string;
  lines: ProjectLine[];
  locale: "en" | "ar";
}): Promise<CallResult<Netlist>> {
  const bomIds = opts.lines.map((l) => l.id);
  const prompt = `Write function and notes text in ${opts.locale === "ar" ? "Arabic" : "English"}; ids, refs, pin ids and net names stay in English.

Product:
"""
${opts.summary.slice(0, 2000)}
"""

Bill of materials (electronics lines):
${opts.lines.map((l) => `- id "${l.id}": ${l.function} — ${l.spec} (quantity ${l.quantity})`).join("\n")}`;
  return validatedCall<Netlist>({
    supabase: opts.supabase,
    projectId: opts.projectId,
    feature: "netlist",
    system: NETLIST_SYSTEM,
    prompt,
    schema: NETLIST_SCHEMA,
    validate: (raw) => {
      const shaped = NetlistSchema.safeParse(raw);
      if (!shaped.success)
        return { value: null, errors: shaped.error.issues.slice(0, 12).map((i) => `${i.path.join(".")}: ${i.message}`) };
      const n: Netlist = shaped.data;
      // Test hook, never in production: point one connection at nothing.
      if (process.env.NETLIST_TEST_BREAK === "1" && process.env.NODE_ENV !== "production" && n.nets[0]?.connections[0])
        n.nets[0].connections[0] = { ref: "X99", pin: "1" };
      const errors = crossValidate(n, bomIds);
      return errors.length ? { value: null, errors } : { value: n, errors };
    },
  });
}
