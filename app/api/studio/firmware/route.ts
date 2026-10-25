import { logUsage, quota } from "@/lib/ai/usage";
import { callGemini, geminiConfigured } from "@/lib/prototyping/providers/gemini-client";
import { ProviderError } from "@/lib/prototyping/providers/types";
import {
  FIRMWARE_SCHEMA,
  LOAD_MAX_ON_PER_HOUR_MS,
  LOAD_MAX_RUN_MS,
  circuitForPrompt,
  cleanFirmware,
  ensureMissingNote,
  ensureRunGuard,
  findController,
  needsRunGuard,
  runGuardBlock,
} from "@/lib/prototyping/firmware";
import { featuresBlockedBy, promiseLine, unmetPromises } from "@/lib/studio/card-parts";
import type { Netlist } from "@/lib/prototyping/netlist";
import { studioLibrary } from "@/lib/studio/library/remote";
import { buildWiring } from "@/lib/studio/netlist";
import { buildConnections, pinBlock, pinConstants, readingNotes } from "@/lib/studio/connections";
import { syncPinBlock } from "@/lib/studio/code-link";
import { loadDoc, updateDoc } from "@/lib/studio/server/doc";
import { FirmwareBody } from "@/lib/studio/server/http";
import { studioRequest } from "@/lib/studio/server/context";
import { jsonError } from "@/lib/http";

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
  // Code library + the owner's studio_parts edits (P5-15c), per request.
  const { getPart } = await studioLibrary();

  const current = await loadDoc(supabase, project.id);
  const saved = current.ok ? current.doc : null;
  const spec = saved?.spec ?? body.spec;
  const components = saved?.components.length ? saved.components : body.components;
  if (!spec || !components.length) return jsonError("no_circuit", 409);

  let netlist: Netlist;
  let w: ReturnType<typeof buildWiring>;
  try {
    w = buildWiring(components.filter((c) => !c.auto), spec, getPart, body.locale);
    netlist = w.legacy as Netlist;
  } catch (e) {
    console.error("[studio/firmware] buildWiring failed:", e instanceof Error ? e.message : e);
    return jsonError("no_circuit", 409);
  }
  if (!netlist.components.length) return jsonError("no_circuit", 409);
  if (!findController(netlist)) return jsonError("no_controller", 409);

  if (!geminiConfigured()) return jsonError("unavailable", 503);
  if ((await quota(supabase, "gemini")).paused) return jsonError("paused", 429);

  // P5-17: the pin constants come from the SAME wiring the views draw. The model is
  // told to start with this exact block; the block is put back verbatim afterwards.
  const connections = buildConnections(w.components, w.netlist.nets, getPart, spec);
  const constants = pinConstants(connections, getPart);
  // F-010: the parts' own reading facts (a capacitive soil probe reads HIGHER when dry) travel
  // with the pin block, so the model cannot invert them and our code puts them back verbatim.
  const notes = readingNotes(connections, getPart);
  const block = constants.length ? pinBlock(constants, notes) : null;
  // A pump / heater / motor always gets the max-run guard, and anything the parts cannot do is
  // named in the sketch. Both are enforced after the answer, not only asked for here.
  const guard = needsRunGuard(netlist);
  const unmet = unmetPromises(spec, (id) => !!getPart(id));
  const cannotDo = [...featuresBlockedBy(spec, unmet), ...unmet.map(promiseLine)];
  // Part E: servos on a PCA9685 servo driver are driven over I2C, by channel.
  const servoDriver = constants.some((c) => c.kind === "channel");

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
    "code comments in English." +
    (block
      ? " The sketch MUST contain the pin block given below, copied VERBATIM (same lines, same markers) right after the #include lines. " +
        "Use ONLY those constant names for the pins everywhere in the code; never write a raw pin number and never redefine them."
      : "") +
    (notes.length
      ? ` Reading facts of these parts, which you must follow exactly (they are in the pin block too): ${notes.join(" ")} ` +
        "Compare a reading against the _PCT constants as a percentage of the board's full ADC range, " +
        "never against a raw number of your own."
      : "") +
    (guard
      ? " The circuit switches a pump, heater or motor. The sketch MUST contain the safety block below " +
        "copied VERBATIM, and must call loadMayRun(ms) before every switch-on and loadRan(ms) after it; " +
        `never run the load longer than LOAD_MAX_RUN_MS (${LOAD_MAX_RUN_MS / 1000} s) in one go or ` +
        `LOAD_MAX_ON_PER_HOUR_MS (${LOAD_MAX_ON_PER_HOUR_MS / 1000} s) in an hour.`
      : "") +
    (cannotDo.length
      ? " Some things were asked for that no part in this circuit can do: " +
        `${cannotDo.join("; ")}. Do NOT pretend to implement them and do not invent a sensor; ` +
        "leave the comment block we add in place and say so in notes."
      : "") +
    (servoDriver
      ? " The servos are NOT on board pins: they sit on a PCA9685 servo driver on I2C. Use the Adafruit_PWMServoDriver library " +
        "(Adafruit_PWMServoDriver pwm(PCA9685_ADDR); pwm.begin(); pwm.setPWMFreq(50);) and move each servo with " +
        "pwm.setPWM(<its SERVO_… channel constant>, 0, pulse). Never use Servo.attach() for them."
      : "");
  const brief = [
    spec.oneLine,
    spec.features.length ? `Features: ${spec.features.join(", ")}` : null,
    `Inputs: ${spec.inputs.join(", ") || "none"}. Outputs: ${spec.outputs.join(", ") || "none"}. Power: ${spec.power}.`,
  ]
    .filter(Boolean)
    .join("\n");
  const prompt =
    `Product: ${spec.name}\n\nWhat it does:\n${brief.slice(0, 3000)}\n\nCircuit:\n${circuitForPrompt(netlist)}` +
    `${block ? `\n\nPin block (copy verbatim):\n${block}` : ""}` +
    `${guard ? `\n\nSafety block (copy verbatim):\n${runGuardBlock()}` : ""}`;

  try {
    const res = await callGemini({ system, prompt, schema: FIRMWARE_SCHEMA, temperature: 0.2, timeoutMs: 100_000 });
    const firmware = cleanFirmware(res.raw, res.model);
    await logUsage(supabase, { userId: ctx.userId,
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
    if (!firmware) return jsonError("failed", 502);
    firmware.code = syncPinBlock(firmware.code, connections, getPart).code;
    // Enforced in OUR code, whatever the model wrote: the guard and the honest note.
    firmware.code = ensureRunGuard(firmware.code, netlist).code;
    firmware.code = ensureMissingNote(firmware.code, cannotDo).code;
    const board = firmware.board || (findController(netlist)?.function ?? "").replace(/ microcontroller board$/, "");
    const stored = await updateDoc(supabase, project.id, (d) => (d ? { ...d, firmware: { board, code: firmware.code } } : null));
    return Response.json({
      firmware: { board, code: firmware.code, fileName: firmware.fileName, steps: firmware.steps.slice(0, 6), libraries: firmware.libraries },
      docVersion: stored.version,
    });
  } catch (e) {
    const reason = e instanceof ProviderError ? e.reason : "unavailable";
    await logUsage(supabase, { userId: ctx.userId, provider: "gemini", projectId: project.id, feature: "studio", step: "firmware", outcome: "error", errorCode: reason });
    return jsonError(reason === "paused" ? "paused" : "unavailable", 502);
  }
}
