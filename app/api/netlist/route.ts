import { createClient } from "@/lib/supabase/server";
import { logUsage, quota } from "@/lib/ai/usage";
import type { ProjectBom } from "@/lib/prototyping/bom";
import { crossValidate, type Netlist, type ProjectNetlist } from "@/lib/prototyping/netlist";
import { NetlistSchema } from "@/lib/prototyping/netlist-schema";
import { callGemini, geminiConfigured } from "@/lib/prototyping/providers/gemini-client";
import { ProviderError, type TokenUsage } from "@/lib/prototyping/providers/types";

// The electronics netlist. A separate model call, made only for a project
// whose bill of materials has electronics lines (i.e. an Electronics branch).
//
// The model returns structure — components, pins, nets, rails — never a
// picture. Its answer must pass zod (shape) AND crossValidate() (every bomId
// is a BOM line, every connection names a real component and pin). A failure
// is sent back once with the list of problems; a second failure returns a
// plain message and nothing is saved or drawn. An unvalidated netlist never
// reaches the page.
//
// Test hook (never active in production): NETLIST_TEST_BREAK=1 points one
// connection at a component that does not exist, on every attempt, to show
// the retry and the fallback.

export const dynamic = "force-dynamic";

const PIN_TYPE_ENUM = ["power_in", "power_out", "ground", "input", "output", "bidirectional", "passive"];
const str = { type: "STRING" };
const SCHEMA = {
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

const SYSTEM = `You design the wiring of a small electronic product from its bill of materials and return JSON only.

Rules:
- components: one per physical electronic part, using ONLY lines from the bill of materials given. bomId is exactly that line's id. A line with quantity 2 becomes two components with the same bomId.
- ref: a standard designator — U (ICs, modules), R, C, D, LED, Q, J (connectors, batteries, panels), M (motors, servos), SW, BT. Unique.
- pins: the pins that are actually used. id short (e.g. "1", "VCC", "SIG"); name as printed; type one of power_in, power_out, ground, input, output, bidirectional, passive.
- currentMa: the component's typical current draw in mA (0 for passives and sources).
- nets: every electrical connection. Each connection names a ref and a pin id that exist. A pin is on at most one net. Name power nets after their rail (e.g. "5V", "3V3") and the ground net "GND".
- powerRails: each supply voltage — name, the ref of the component that supplies it (its pin must be type power_out), and the most current it can supply in mA.
- notes: short practical cautions only.
- Never name a brand, manufacturer, model or part number. Never give a price.
- Do not include any confidence, probability or score.`;

type Attempt = { netlist: Netlist | null; errors: string[] };

/** One row per attempt in analysis_runs (0024): raw reply beside the validated result. */
async function recordRun(
  supabase: Awaited<ReturnType<typeof createClient>>,
  row: { projectId: string; model: string | null; attempt: number; rawText: string | null; raw: unknown; netlist: Netlist | null; outcome: "ok" | "invalid" | "error"; errors: string[] }
) {
  const { error } = await supabase.from("analysis_runs").insert({
    project_id: row.projectId,
    feature: "netlist",
    provider: "gemini",
    model: row.model,
    attempt: row.attempt,
    raw_text: row.rawText,
    raw_response: row.raw ?? null,
    parsed_response: row.netlist,
    outcome: row.outcome,
    error: row.errors.length ? row.errors.join("\n") : null,
  });
  if (error) console.warn(`[netlist] run not recorded (migration 0024?): ${error.message}`);
}

function validate(raw: unknown, bomIds: string[]): Attempt {
  const shaped = NetlistSchema.safeParse(raw);
  if (!shaped.success)
    return {
      netlist: null,
      errors: shaped.error.issues.slice(0, 12).map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  const n: Netlist = shaped.data;
  if (process.env.NETLIST_TEST_BREAK === "1" && process.env.NODE_ENV !== "production" && n.nets[0]?.connections[0]) {
    n.nets[0].connections[0] = { ref: "X99", pin: "1" };
  }
  const errors = crossValidate(n, bomIds);
  return errors.length ? { netlist: null, errors } : { netlist: n, errors };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response(null, { status: 401 });

  const body = (await request.json().catch(() => null)) as { projectId?: unknown; locale?: unknown } | null;
  const projectId = typeof body?.projectId === "string" ? body.projectId : null;
  const locale = body?.locale === "ar" ? "ar" : "en";
  if (!projectId) return new Response(null, { status: 400 });

  const { data: project, error } = await supabase
    .from("projects")
    .select("id, brief, spec, bom")
    .eq("id", projectId)
    .maybeSingle();
  if (error) return Response.json({ error: "not_ready" }, { status: 409 });
  if (!project) return new Response(null, { status: 404 });

  const bom = (project as { bom?: ProjectBom | null }).bom;
  const lines = (bom?.lines ?? []).filter((l) => l.kind === "electronics");
  if (!lines.length) return Response.json({ error: "no_electronics" }, { status: 422 });

  if (!geminiConfigured()) return Response.json({ error: "unavailable" }, { status: 503 });
  if ((await quota(supabase, "gemini")).paused) {
    await logUsage(supabase, { provider: "gemini", projectId, feature: "netlist", outcome: "blocked", errorCode: "paused" });
    return Response.json({ error: "paused" }, { status: 429 });
  }

  const summary = (project as { spec?: { summary?: string } | null }).spec?.summary || project.brief || "";
  const base = `Write function and notes text in ${locale === "ar" ? "Arabic" : "English"}; ids, refs, pin ids and net names stay in English.

Product:
"""
${summary.slice(0, 2000)}
"""

Bill of materials (electronics lines):
${lines.map((l) => `- id "${l.id}": ${l.function} — ${l.spec} (quantity ${l.quantity})`).join("\n")}`;

  const bomIds = lines.map((l) => l.id);
  let last: Attempt = { netlist: null, errors: [] };
  let model: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt =
      attempt === 0
        ? base
        : `${base}

Your previous answer was rejected for these problems. Return a corrected netlist:
${last.errors.map((e) => `- ${e}`).join("\n")}`;
    let usage: TokenUsage | undefined;
    let latencyMs: number | undefined;
    let rawText: string | null = null;
    let raw: unknown = null;
    try {
      const r = await callGemini({ system: SYSTEM, prompt, schema: SCHEMA, temperature: 0.1 });
      ({ usage, latencyMs } = r);
      rawText = r.rawText;
      raw = r.raw;
      model = r.model;
      last = validate(r.raw, bomIds);
    } catch (e) {
      const err = e as ProviderError & { usage?: TokenUsage; latencyMs?: number; rawText?: string };
      usage = err.usage;
      latencyMs = err.latencyMs;
      rawText = err.rawText ?? null;
      last = { netlist: null, errors: [err.reason === "malformed" ? "the answer was not valid JSON" : err.message] };
      if (e instanceof ProviderError && e.reason !== "malformed") {
        await recordRun(supabase, { projectId, model, attempt: attempt + 1, rawText, raw: null, netlist: null, outcome: "error", errors: last.errors });
        await logUsage(supabase, {
          provider: "gemini",
          model,
          projectId,
          feature: "netlist",
          promptTokens: usage?.input,
          completionTokens: usage?.output,
          totalTokens: usage?.total,
          latencyMs,
          outcome: "error",
          errorCode: e.reason,
        });
        return Response.json({ error: e.reason === "rate_limited" ? "rate_limited" : "unavailable" }, { status: 502 });
      }
    }
    await logUsage(supabase, {
      provider: "gemini",
      model,
      projectId,
      feature: "netlist",
      promptTokens: usage?.input,
      completionTokens: usage?.output,
      totalTokens: usage?.total,
      latencyMs,
      outcome: last.netlist ? "ok" : "error",
      errorCode: last.netlist ? null : "invalid",
    });
    await recordRun(supabase, {
      projectId,
      model,
      attempt: attempt + 1,
      rawText,
      raw,
      netlist: last.netlist,
      outcome: last.netlist ? "ok" : "invalid",
      errors: last.errors,
    });
    if (last.netlist) break;
    console.warn(`[netlist] attempt ${attempt + 1} rejected: ${last.errors.join("; ")}`);
  }

  if (!last.netlist) return Response.json({ error: "invalid", problems: last.errors.slice(0, 6) }, { status: 422 });

  const saved: ProjectNetlist = { ...last.netlist, generatedAt: new Date().toISOString(), model };
  const { error: saveErr } = await supabase.from("projects").update({ netlist: saved }).eq("id", projectId);
  if (saveErr) return Response.json({ error: "not_ready" }, { status: 409 });
  return Response.json({ netlist: saved });
}
