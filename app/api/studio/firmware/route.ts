import { logUsage, quota } from "@/lib/ai/usage";
import { callGemini, geminiConfigured } from "@/lib/prototyping/providers/gemini-client";
import { ProviderError } from "@/lib/prototyping/providers/types";
import { FIRMWARE_SCHEMA, circuitForPrompt, cleanFirmware, findController } from "@/lib/prototyping/firmware";
import type { Netlist } from "@/lib/prototyping/netlist";
import { getPart } from "@/lib/studio/library";
import { buildWiring } from "@/lib/studio/netlist";
import { loadDoc, updateDoc } from "@/lib/studio/server/doc";
import { FirmwareBody } from "@/lib/studio/server/http";
import { studioRequest } from "@/lib/studio/server/context";

// POST /api/studio/firmware — starter Arduino-IDE sketch for the board the
// visitor actually chose (P5-14). Free, like /api/firmware: same consent,
// daily quota and usage log (feature "studio", step "firmware"). The circuit
// comes from OUR wiring rules (buildWiring → the legacy netlist the existing
// firmware prompt reads), so the pins in the sketch are the pins we drew.
// Saved as doc.firmware {board, code}; steps / libraries are returned to show
// once. Before 0068 (doc in memory) the browser's spec + parts are used.

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const ctx = await studioRequest(request, FirmwareBody, { consent: true });
  if (ctx instanceof Response) return ctx;
  const { supabase, body, project } = ctx;

  const current = await loadDoc(supabase, project.id);
  const saved = current.ok ? current.doc : null;
  const spec = saved?.spec ?? body.spec;
  const components = saved?.components.length ? saved.components : body.components;
  if (!spec || !components.length) return Response.json({ error: "no_circuit" }, { status: 409 });

  let netlist: Netlist;
  try {
    netlist = buildWiring(components.filter((c) => !c.auto), spec, getPart, body.locale).legacy as Netlist;
  } catch (e) {
    console.error("[studio/firmware] buildWiring failed:", e instanceof Error ? e.message : e);
    return Response.json({ error: "no_circuit" }, { status: 409 });
  }
  if (!netlist.components.length) return Response.json({ error: "no_circuit" }, { status: 409 });
  if (!findController(netlist)) return Response.json({ error: "no_controller" }, { status: 409 });

  if (!geminiConfigured()) return Response.json({ error: "unavailable" }, { status: 503 });
  if ((await quota(supabase, "gemini")).paused) return Response.json({ error: "paused" }, { status: 429 });

  const ar = body.locale === "ar";
  const system =
    "You write firmware for small electronics prototypes in the Arduino IDE (C++). " +
    "Write ONE complete, compilable sketch for the circuit given. Use ONLY the controller pins listed in the circuit — " +
    "never invent a pin; if a pin name like D2/GPIO4 is given, use that number. Prefer well-known Arduino libraries and name each one. " +
    "Keep it simple and readable for a beginner: short comments, a clearly marked settings block at the top " +
    "(Wi-Fi name/password placeholders, thresholds, timings), Serial debug output at 115200. " +
    "Do what the product description asks; when it leaves a behaviour open, choose a safe simple default and say so in notes. " +
    "Never drive a motor, pump, relay or heater directly without the driver the circuit shows. " +
    `Write steps (at most 5 short plain sentences: install the board and libraries, select the board, upload) and notes in ${ar ? "Arabic" : "English"}; ` +
    "code comments in English.";
  const brief = [
    spec.oneLine,
    spec.features.length ? `Features: ${spec.features.join(", ")}` : null,
    `Inputs: ${spec.inputs.join(", ") || "none"}. Outputs: ${spec.outputs.join(", ") || "none"}. Power: ${spec.power}.`,
  ]
    .filter(Boolean)
    .join("\n");
  const prompt = `Product: ${spec.name}\n\nWhat it does:\n${brief.slice(0, 3000)}\n\nCircuit:\n${circuitForPrompt(netlist)}`;

  try {
    const res = await callGemini({ system, prompt, schema: FIRMWARE_SCHEMA, temperature: 0.2, timeoutMs: 100_000 });
    const firmware = cleanFirmware(res.raw, res.model);
    await logUsage(supabase, {
      provider: "gemini",
      model: res.model,
      projectId: project.id,
      feature: "studio",
      step: "firmware",
      promptTokens: res.usage?.input,
      completionTokens: res.usage?.output,
      totalTokens: res.usage?.total,
      latencyMs: res.latencyMs,
      outcome: firmware ? "ok" : "error",
      errorCode: firmware ? null : "malformed",
    });
    if (!firmware) return Response.json({ error: "failed" }, { status: 502 });
    const board = firmware.board || (findController(netlist)?.function ?? "").replace(/ microcontroller board$/, "");
    const stored = await updateDoc(supabase, project.id, (d) => (d ? { ...d, firmware: { board, code: firmware.code } } : null));
    return Response.json({
      firmware: { board, code: firmware.code, fileName: firmware.fileName, steps: firmware.steps.slice(0, 6), libraries: firmware.libraries },
      docVersion: stored.version,
    });
  } catch (e) {
    const reason = e instanceof ProviderError ? e.reason : "unavailable";
    await logUsage(supabase, { provider: "gemini", projectId: project.id, feature: "studio", step: "firmware", outcome: "error", errorCode: reason });
    return Response.json({ error: reason === "paused" ? "paused" : "unavailable" }, { status: 502 });
  }
}
