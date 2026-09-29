import { createClient } from "@/lib/supabase/server";
import { logUsage, quota } from "@/lib/ai/usage";
import { callGemini, geminiConfigured } from "@/lib/prototyping/providers/gemini-client";
import { ProviderError } from "@/lib/prototyping/providers/types";
import { FIRMWARE_SCHEMA, circuitForPrompt, cleanFirmware, findController } from "@/lib/prototyping/firmware";
import type { Netlist } from "@/lib/prototyping/netlist";

// Software › Code: write a starter Arduino-IDE sketch for the project's own
// circuit (owner, 2026-09-29). Same gate as the other AI routes: the caller's
// own project (RLS), a session, the daily guard. Saved to projects.firmware
// (migration 0040); before 0040 the code is returned but not saved.

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response(null, { status: 401 });

  const body = (await request.json().catch(() => null)) as { projectId?: string; locale?: string } | null;
  const projectId = body?.projectId;
  if (!projectId || !/^[0-9a-f-]{36}$/i.test(projectId)) return new Response(null, { status: 400 });
  const locale = body?.locale === "ar" ? "ar" : "en";

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, brief, netlist")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!project) return new Response(null, { status: 404 });
  const netlist = project.netlist as Netlist | null;
  if (!netlist?.components?.length) return Response.json({ error: "no_circuit" }, { status: 409 });
  if (!findController(netlist)) return Response.json({ error: "no_controller" }, { status: 409 });

  if (!geminiConfigured()) return Response.json({ error: "unavailable" }, { status: 503 });
  if ((await quota(supabase, "gemini")).paused) return Response.json({ error: "paused" }, { status: 429 });

  const system =
    "You write firmware for small electronics prototypes in the Arduino IDE (C++). " +
    "Write ONE complete, compilable sketch for the circuit given. Use ONLY the controller pins listed in the circuit — " +
    "never invent a pin; if a pin name like D2/GPIO4 is given, use that number. Prefer well-known Arduino libraries and name each one. " +
    "Keep it simple and readable for a beginner: short comments, a clearly marked settings block at the top " +
    "(Wi-Fi name/password placeholders, thresholds, timings), Serial debug output at 115200. " +
    "Do what the brief asks; when the brief leaves a behaviour open, choose a safe simple default and say so in notes. " +
    "Never drive a motor, pump, relay or heater directly without the driver the circuit shows. " +
    `Write steps (how to install the board and libraries, select the board, upload) and notes in ${locale === "ar" ? "Arabic" : "English"}; ` +
    "code comments in English.";
  const prompt = `Project: ${project.name}\n\nBrief:\n${String(project.brief ?? "").slice(0, 5000) || "(none)"}\n\nCircuit:\n${circuitForPrompt(netlist)}`;

  try {
    const res = await callGemini({ system, prompt, schema: FIRMWARE_SCHEMA, temperature: 0.2, timeoutMs: 100_000 });
    const firmware = cleanFirmware(res.raw, res.model);
    await logUsage(supabase, {
      provider: "gemini",
      model: res.model,
      projectId,
      feature: "firmware",
      promptTokens: res.usage?.input,
      completionTokens: res.usage?.output,
      totalTokens: res.usage?.total,
      latencyMs: res.latencyMs,
      outcome: firmware ? "ok" : "error",
      errorCode: firmware ? null : "malformed",
    });
    if (!firmware) return Response.json({ error: "failed" }, { status: 502 });
    const { error } = await supabase.from("projects").update({ firmware }).eq("id", projectId);
    return Response.json({ firmware, saved: !error });
  } catch (e) {
    const reason = e instanceof ProviderError ? e.reason : "unavailable";
    await logUsage(supabase, { provider: "gemini", projectId, feature: "firmware", outcome: "error", errorCode: reason });
    return Response.json({ error: reason === "paused" ? "paused" : "unavailable" }, { status: 502 });
  }
}
