"use client";

// TEST-ONLY StudioApi for the e2e fixture (/[locale]/e2e-fixtures/studio):
// no network, no Supabase, no AI, no credit. Answers are canned but go
// through the same rules the server uses (buildWiring, defaultEnclosureFor),
// so the schematic, the 3D enclosure and the printed parts are real
// (defaultMechParts); the firmware is a small canned sketch for the chosen board.

import { getPart, libraryIndexForAI } from "@/lib/studio/library";
import { isValidPhone } from "@/lib/phone";
import { buildWiring } from "@/lib/studio/netlist";
import { buildConnections, pinBlock, pinConstants } from "@/lib/studio/connections";
import { defaultMechParts, layoutBounds, mechSummary } from "@/lib/studio/ai/mech-default";
import { defaultEnclosureFor } from "@/lib/studio/enclosure/templates";
import { enforcePick, specParts } from "@/lib/studio/ai/pick";
import { ROBOT_ARM_MODEL_PICK, ROBOT_ARM_REPLY, robotArmSpec } from "@/lib/studio/__fixtures__/robot-arm";
import { applyActuatorRules } from "@/lib/studio/ai/actuator-rules";
import { chatGuardTurn, guardSpec, userTexts, vagueTurn, WORDS } from "@/lib/studio/ai/spec-guards";
import { clampSpec, type ProductSpec, type StudioComponent } from "@/lib/studio/schema";
import type { EngineerDesign, Locale, ProductApi, StudioApi } from "./api";
import { mockOptionsFromUrl } from "./product";
import { forModel, sameSpec } from "./steps";
import { applyCardColours, cardItems } from "@/lib/studio/card-parts";
import { actuatorCountIn, actuatorCountLabel, actuatorTotals, setActuatorCount } from "@/lib/studio/actuators";

/**
 * A small canned sketch whose pin block is built from the request's own wiring,
 * exactly like the server's (P5-17), so the fixture shows LED_PIN etc.
 */
function mockSketch(name: string, board: string, components: StudioComponent[], spec: ProductSpec, locale: Locale): string {
  let constants: ReturnType<typeof pinConstants> = [];
  try {
    const w = buildWiring(components, spec, getPart, locale);
    constants = pinConstants(buildConnections(w.components, w.netlist.nets, getPart, spec), getPart);
  } catch {
    /* no wiring: a sketch without pins */
  }
  // Part E: servos on the PCA9685 are driven by channel through Adafruit_PWMServoDriver.
  const channels = constants.filter((c) => c.kind === "channel");
  const addr = constants.find((c) => c.kind === "address");
  const pins = constants.filter((c) => !c.kind || c.kind === "pin");
  const outputs = pins.filter((c) => /LED|PUMP|MOTOR|RELAY|BUZZER|SERVO|SG90|RING|WS2812|SPEAKER/.test(c.name));
  const inputs = pins.filter((c) => !outputs.includes(c) && !/^(I2C|SPI)_/.test(c.name));
  const analog = (c: (typeof constants)[number]) => /^A\d/.test(c.value) || /SOIL|LDR|LIGHT/.test(c.name);
  return [
    `// ${name} — starter sketch for the ${board}`,
    ...(addr ? ["#include <Wire.h>", "#include <Adafruit_PWMServoDriver.h>"] : []),
    "",
    ...(constants.length ? [pinBlock(constants), ""] : []),
    ...(addr ? [`Adafruit_PWMServoDriver pwm(${addr.name});`, "const int SERVO_MIN = 150;  // pulse for 0 degrees", "const int SERVO_MAX = 600;  // pulse for 180 degrees", ""] : []),
    "void setup() {",
    "  Serial.begin(115200);",
    ...(addr ? ["  pwm.begin();", "  pwm.setPWMFreq(50);"] : []),
    ...inputs.map((c) => `  pinMode(${c.name}, INPUT);`),
    ...outputs.map((c) => `  pinMode(${c.name}, OUTPUT);`),
    "}",
    "",
    "void loop() {",
    ...inputs.map((c) => `  Serial.println(${analog(c) ? "analogRead" : "digitalRead"}(${c.name}));`),
    ...outputs.map((c) => `  digitalWrite(${c.name}, !digitalRead(${c.name}));`),
    ...channels.map((c) => `  pwm.setPWM(${c.name}, 0, (SERVO_MIN + SERVO_MAX) / 2);`),
    "  delay(500);",
    "}",
  ].join("\n");
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * P5-16 product endpoints for the fixture (?product=1). The worker answers design /
 * check / preview / model itself (lib/studio/geometry/product-mock.ts); here are the
 * page's own calls. ?unlock=no_credits | sign_in makes "Create my CAD" refuse.
 */
export function mockProductApi(): ProductApi {
  return {
    base: "",
    mock: mockOptionsFromUrl(),
    async choose(designId) {
      await wait(60);
      return { ok: true, data: { chosenId: designId } };
    },
    async unlock(designId) {
      await wait(150);
      let gate: string | null = null;
      try {
        gate = new URLSearchParams(window.location.search).get("unlock");
      } catch {
        /* no window */
      }
      if (gate === "no_credits") return { ok: false, status: 402, error: "no_credits" };
      if (gate === "sign_in") return { ok: false, status: 403, error: "sign_in" };
      return { ok: true, data: { unlockedId: designId } };
    },
    async engineer(doc) {
      // The same archetype defaults the worker's mock designs (deterministic), solved here.
      const [{ rankArchetypes, defaultProductFor }, { solveProduct }] = await Promise.all([
        import("@/lib/studio/product/archetypes"),
        import("@/lib/studio/product/solve"),
      ]);
      const parts = doc.components.flatMap((c) => {
        const part = getPart(c.partId);
        return part ? [{ instanceId: c.instanceId, part }] : [];
      });
      const shown = new Set((doc.product?.designs ?? []).map((d) => d.archetype));
      const archetypes = shown.size ? [...shown] : rankArchetypes(doc.spec).slice(0, 3).map((r) => r.archetype);
      const designs: EngineerDesign[] = archetypes.map((archetype) => {
        const model = defaultProductFor(doc.spec, parts, { archetype });
        const solved = solveProduct(model, parts, { spec: doc.spec });
        return { id: `d_${`mk${archetype.replace(/_/g, "")}`.slice(0, 16)}`, model: solved.model, solvedHash: solved.hash, score: mockOptionsFromUrl().score ?? 8, loops: 0, looksLike: archetype.replace(/_/g, " "), missing: [], issues: solved.issues, source: "default" };
      });
      return { ok: true, data: { designs } };
    },
    async previewUrl() {
      return null;
    },
  };
}

const QUESTION: Record<Locale, { question: string; choices: string[] }> = {
  en: { question: "Where will it live?", choices: ["On my desk", "On a wall", "In my hand"] },
  ar: { question: "أين سيُستخدم؟", choices: ["على مكتبي", "على الحائط", "في يدي"] },
};

/** Part A (mock only): a question gets an answer, never a card change. */
const ASKS = /[?؟]\s*$|^(?:what|who|how|why|when|where|which|do you|can you|are you|is it|tell me)\b|^(?:ما|ماذا|من|كيف|لماذا|هل|متى|أين)\s/i;
const MOCK_REPLY: Record<Locale, { answer: string; done: string; nothing: string; solar: string; updated: string }> = {
  en: {
    answer: "A UR10 is a big industrial robot arm. We can build a small desktop version of your idea with hobby servos.",
    done: "Done. I updated your card.",
    nothing: "Your card already has that. Tell me what else to change.",
    solar: "Now solar powered",
    updated: "Card updated",
  },
  ar: {
    answer: "UR10 ذراع روبوت صناعية كبيرة. يمكننا بناء نسخة مكتبية صغيرة من فكرتك بمحركات سيرفو صغيرة.",
    done: "تم. حدّثتُ بطاقتك.",
    nothing: "بطاقتك فيها ذلك بالفعل. أخبرني ماذا أغيّر أيضاً.",
    solar: "يعمل بالطاقة الشمسية الآن",
    updated: "تم تحديث البطاقة",
  },
};

/** Part F: a reference industrial arm in the idea (UR10 / UR5 / "industrial robot arm"). */
const BIG_ARM = /\bur ?(?:3|5|10|16)e?\b|industrial (?:robot|arm)|يو ?آر ?10/i;

/** Short labels of what changed between two cards (mock only; the server gets them from the model). */
function mockChanged(before: ProductSpec, after: ProductSpec, locale: Locale): string[] {
  const words = MOCK_REPLY[locale];
  const solar = (s: ProductSpec) => s.features.some((f) => /solar|شمس/i.test(f));
  if (solar(after) && !solar(before)) return [words.solar];
  return [words.updated];
}

const PICK: { partId: string; reason: Record<Locale, string> }[] = [
  { partId: "esp32_devkit", reason: { en: "The brain: it reads the sensor and drives the screen.", ar: "العقل: يقرأ الحساس ويشغّل الشاشة." } },
  { partId: "pir_hcsr501", reason: { en: "Notices when someone walks past.", ar: "يلاحظ مرور شخص بالقرب منه." } },
  { partId: "oled_096_i2c", reason: { en: "Shows a friendly message.", ar: "تعرض رسالة لطيفة." } },
  { partId: "led_5mm", reason: { en: "A small light that says it is on.", ar: "ضوء صغير يدل على أنه يعمل." } },
];

/** The mock's "Our understanding": derived from the card each time (the real model rebuilds it every turn). */
function mockUnderstood(spec: ProductSpec, locale: Locale): ProductSpec {
  const ar = locale === "ar";
  const plant = spec.outputs.includes("pump") || /plant|soil|نبت|تربة/i.test(`${spec.name} ${spec.oneLine}`);
  const movers = actuatorTotals(spec).map(({ kind, count }) => ({
    name: kind === "servo" ? (ar ? "سيرفو SG90" : "SG90 servo") : kind,
    count,
    kind,
  }));
  // A pump on the card is a mover in the understanding (as the real model lists it).
  if (spec.outputs.includes("pump") && !movers.some((m) => m.kind === "pump")) {
    movers.push({ name: ar ? "مضخة ماء 5 فولت" : "5V water pump", count: 1, kind: "pump" });
  }
  return {
    ...spec,
    understanding: {
      goal: spec.oneLine || spec.name,
      howItWorks: ar ? "يقرأ الحساس ما حوله، ويقرر المتحكّم، ثم تتحرك القطع." : "The sensor reads its surroundings, the board decides, then the parts act.",
      controller: "Arduino Uno",
      sensors: [plant ? { name: ar ? "حساس رطوبة التربة" : "Soil moisture sensor", count: 1 } : { name: ar ? "حساس حركة" : "Motion sensor", count: 1 }],
      actuators: movers,
      // "3 LEDs" said in the chat (kept as a feature by the mock refine) → the lights' count.
      outputs: spec.outputs
        .filter((o) => o !== "pump" && o !== "motor")
        .map((o) => {
          const n = o === "led" ? Number(spec.features.map((f) => /(\d+)\s*(?:leds?|lights?|أضواء)/i.exec(f)?.[1]).find(Boolean) ?? 1) : 1;
          return { name: o === "led" ? (ar ? "أضواء LED" : "LEDs") : o, count: n };
        }),
    },
  };
}

export function mockStudioApi(projectId = "00000000-0000-4000-8000-000000000000"): StudioApi {
  return {
    mode: "mock",
    projectId,
    async load() {
      await wait(50);
      return { ok: true, project: { name: "Desk buddy", consented: true, brief: null }, doc: null, version: 0, persist: false };
    },
    async save(_doc, version) {
      return { ok: true, version: version + 1 };
    },
    async spec({ messages, locale, idea, current }) {
      await wait(250);
      // The same deterministic guards as the server (lib/studio/ai/spec.ts), so the e2e
      // sees the real vague-idea question, function words and placement.
      const turn = { idea, messages: forModel(messages), locale };
      const canned = chatGuardTurn(turn.idea, turn.messages, locale, Boolean(current));
      if (canned?.kind === "question") return { ok: true, data: { question: canned.question, choices: canned.choices } };
      if (canned) return { ok: true, data: { reply: canned.reply, changed: [] } };
      const vague = current ? null : vagueTurn(turn.idea, turn.messages, locale);
      if (vague) return { ok: true, data: { question: vague.question, choices: vague.choices } };
      if (current) {
        // Part A: a question is answered (card untouched); a change request updates the card.
        const last = [...turn.messages].reverse().find((m) => m.role === "user")?.text.trim() ?? "";
        if (ASKS.test(last)) return { ok: true, data: { reply: MOCK_REPLY[locale].answer, changed: [] } };
        let next = guardSpec(current, turn).spec;
        // Part B: "make it 4 joints" / "2 pumps" sets that count on the card.
        const asked = actuatorCountIn(last);
        if (asked) next = setActuatorCount(next, asked.kind, asked.count);
        // "add 3 LEDs": the lights become an output with their count (as the real model does).
        const leds = /(\d+)\s*(?:leds?|lights?|أضواء)/i.exec(last);
        if (leds) {
          next = {
            ...next,
            outputs: next.outputs.includes("led") ? next.outputs : [...next.outputs, "led"],
            features: [...next.features.filter((f) => !/(\d+)\s*(?:leds?|lights?|أضواء)/i.test(f)), `${leds[1]} LEDs`].slice(0, 8),
          };
        }
        next = mockUnderstood(next, locale);
        if (sameSpec(next, current)) return { ok: true, data: { reply: MOCK_REPLY[locale].nothing, changed: [] } };
        const changed =
          asked && actuatorTotals(next).find((a) => a.kind === asked.kind)?.count === asked.count
            ? [actuatorCountLabel(asked.kind, asked.count, locale)]
            : mockChanged(current, next, locale);
        return { ok: true, data: { reply: MOCK_REPLY[locale].done, spec: next, changed } };
      }
      // Part F: an industrial arm ("big robotic arm like ur10") gets the desktop version at once,
      // with the scale note and the reply that says so (as the real model does on its first card).
      if (BIG_ARM.test(userTexts(idea, turn.messages).join(" "))) {
        return { ok: true, data: { spec: mockUnderstood(guardSpec(robotArmSpec(locale), turn).spec, locale), reply: ROBOT_ARM_REPLY[locale] } };
      }
      if (!turn.messages.some((m) => m.role === "assistant")) return { ok: true, data: QUESTION[locale] };
      const plant = WORDS.plant.test(userTexts(idea, turn.messages).join(" "));
      return {
        ok: true,
        data: {
          spec: mockUnderstood(guardSpec(clampSpec({
            name: plant ? (locale === "ar" ? "مساعد النبتة" : "Plant helper") : locale === "ar" ? "رفيق المكتب" : "Desk buddy",
            oneLine: idea.slice(0, 120) || "A little desk friend that waves when you walk in.",
            use: "desk",
            power: "usb",
            environment: "indoor",
            features: [],
            inputs: [],
            outputs: ["screen", "led"],
            sizeHint: "palm",
            style: "rounded",
            quantity: 1,
          }), turn).spec, locale),
        },
      };
    },
    async tokens() {
      return { balance: 5, admin: false, charged: 0, tier: "explorer", multiplier: 1, turnsPerToken: 5, nextChargeIn: 5 };
    },
    async pick(spec, locale) {
      await wait(300);
      // Part F: a product with servos goes through the server's own enforcePick from the model's
      // incident pick (board + one SG90): servo count, servo driver, 5 A supply = the robot arm fixture.
      if (spec.actuators?.some((a) => a.kind === "servo")) {
        const ruled = enforcePick(
          { components: ROBOT_ARM_MODEL_PICK.map((partId) => ({ partId })) },
          { spec, index: libraryIndexForAI(), locale, log: [], nameFor: (id, l) => getPart(id)?.name[l], pinsOf: (id) => getPart(id)?.pins },
        ).components;
        let wired = ruled;
        try {
          wired = buildWiring(ruled, spec, getPart, locale).components;
        } catch {
          /* keep the picked list */
        }
        return { ok: true, data: { components: wired, docVersion: null } };
      }
      const picked: StudioComponent[] = PICK.filter((p) => getPart(p.partId)).map((p) => ({
        partId: p.partId,
        instanceId: `${p.partId}_1`,
        label: getPart(p.partId)!.name[locale],
        reason: p.reason[locale],
      }));
      // The parts the spec names (pump for "automatic watering"…), as the server's enforcePick adds them.
      for (const id of specParts(spec)) {
        const part = getPart(id);
        if (part && !picked.some((c) => c.partId === id)) picked.splice(1, 0, { partId: id, instanceId: `${id}_1`, label: part.name[locale] });
      }
      // Everything on the card (3 LEDs, the soil sensor…), as the server's enforcePick adds it.
      for (const item of cardItems(spec)) {
        const id = item.ids.find((x) => getPart(x));
        if (!id) continue;
        const have = picked.filter((c) => item.ids.includes(c.partId)).length;
        const want = item.key === "servo" ? Math.min(item.count, 1) : item.count;
        for (let i = have; i < want; i++) picked.push({ partId: id, instanceId: `${id}_${i + 1}`, label: getPart(id)!.name[locale] });
      }
      // Part D: the same actuator rules as the server (servo count, driver, 5 A supply).
      const index = libraryIndexForAI();
      const slots = applyActuatorRules(
        picked.map((c) => ({ partId: c.partId, label: c.label })),
        { spec, byId: new Map(index.map((e) => [e.id, e])), log: [], name: (id) => getPart(id)?.name[locale] ?? id, pinsOf: (id) => getPart(id)?.pins },
      );
      const seen = new Map<string, number>();
      const reasonOf = new Map(picked.map((c) => [c.partId, c.reason]));
      const ruled: StudioComponent[] = applyCardColours(spec, slots.map((s) => {
        const n = (seen.get(s.partId) ?? 0) + 1;
        seen.set(s.partId, n);
        const reason = reasonOf.get(s.partId);
        return { partId: s.partId, instanceId: `${s.partId}_${n}`, label: s.label, ...(reason ? { reason } : {}) } as StudioComponent;
      }));
      let components = ruled;
      try {
        components = buildWiring(ruled, spec, getPart, locale).components;
      } catch {
        /* keep the picked list */
      }
      return { ok: true, data: { components, docVersion: null } };
    },
    async wiring(spec, components, locale) {
      await wait(300);
      const w = buildWiring(components.filter((c) => !c.auto), spec, getPart, locale);
      return { ok: true, data: { components: w.components, netlist: w.netlist, checks: w.checks, docVersion: null } };
    },
    async enclosure(spec) {
      await wait(300);
      return {
        ok: true,
        data: { enclosure: { ...defaultEnclosureFor(spec), colour: "coral" }, versionsLeft: 2, fallback: false, docVersion: null },
      };
    },
    async mech(doc, dims) {
      await wait(200);
      const enclosure = dims ?? layoutBounds(doc.components, doc.layout, getPart) ?? { w: 60, d: 40, h: 25 };
      const summary = mechSummary({ components: doc.components, layout: doc.layout, getPart, enclosure, template: doc.enclosure?.template });
      return { ok: true, data: { mech: defaultMechParts(summary), docVersion: null } };
    },
    async firmware(spec, components, locale) {
      await wait(250);
      const mcu = components.map((c) => getPart(c.partId)).find((p) => p?.category === "mcu");
      const board = mcu?.id === "arduino_uno" ? "Arduino Uno" : mcu?.id === "pico_w" ? "Raspberry Pi Pico W" : "ESP32 Dev Module";
      const code = mockSketch(spec.name, board, components.filter((c) => !c.auto), spec, locale);
      return {
        ok: true,
        data: {
          firmware: {
            board,
            code,
            fileName: "desk_buddy.ino",
            steps:
              locale === "ar"
                ? ["ثبّت برنامج Arduino IDE.", `اختر اللوحة "${board}".`, "صِلها بكابل USB واضغط Upload."]
                : ["Install the Arduino IDE.", `Choose the board "${board}".`, "Plug it in with a USB cable and press Upload."],
          },
          docVersion: null,
        },
      };
    },
    async uploadPrintFiles(files) {
      return files.map((f) => `cad-files/mock/${projectId}/print/${f.name}`);
    },
    async requestPrint() {
      await wait(200);
      return true;
    },
    async giveConsent() {
      return true;
    },
    async rename() {},
    async storeProducts() {
      return new Map();
    },
    // W2: a signed-in maker with an email but no name or phone on file, so the
    // "Get it made" pop-up asks for exactly those two. ?who=guest = a guest session.
    async profile() {
      let who: string | null = null;
      try {
        who = new URLSearchParams(window.location.search).get("who");
      } catch {
        /* no window */
      }
      if (who === "guest") return { userId: "mock-guest", phone: null, fullName: null, email: null, guest: true };
      return { userId: "mock-user", phone: null, fullName: null, email: "maker@example.com", guest: false };
    },
    async saveContact() {},
    async requestQuote(q) {
      await wait(200);
      // Same rule as /api/store-lead (422 invalid_phone), and the request is kept for the e2e.
      if (!isValidPhone(q.phone)) return false;
      try {
        (window as unknown as { __g360LastQuote?: unknown }).__g360LastQuote = q;
      } catch {
        /* no window */
      }
      return true;
    },
  };
}
