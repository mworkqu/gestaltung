"use client";

// TEST-ONLY StudioApi for the e2e fixture (/[locale]/e2e-fixtures/studio):
// no network, no Supabase, no AI, no credit. Answers are canned but go
// through the same rules the server uses (buildWiring, defaultEnclosureFor),
// so the schematic, the 3D enclosure and the printed parts are real
// (defaultMechParts); the firmware is a small canned sketch for the chosen board.

import { getPart } from "@/lib/studio/library";
import { isValidPhone } from "@/lib/phone";
import { buildWiring } from "@/lib/studio/netlist";
import { buildConnections, pinBlock, pinConstants } from "@/lib/studio/connections";
import { defaultMechParts, layoutBounds, mechSummary } from "@/lib/studio/ai/mech-default";
import { defaultEnclosureFor } from "@/lib/studio/enclosure/templates";
import { specParts } from "@/lib/studio/ai/pick";
import { chatGuardTurn, guardSpec, userTexts, vagueTurn, WORDS } from "@/lib/studio/ai/spec-guards";
import { clampSpec, type ProductSpec, type StudioComponent } from "@/lib/studio/schema";
import type { EngineerDesign, Locale, ProductApi, StudioApi } from "./api";
import { mockOptionsFromUrl } from "./product";
import { forModel, sameSpec } from "./steps";
import { actuatorCountIn, actuatorCountLabel, actuatorTotals, setActuatorCount } from "@/lib/studio/actuators";

/**
 * A small canned sketch whose pin block is built from the request's own wiring,
 * exactly like the server's (P5-17), so the fixture shows LED_PIN etc.
 */
function mockSketch(name: string, board: string, components: StudioComponent[], spec: ProductSpec, locale: Locale): string {
  let constants: ReturnType<typeof pinConstants> = [];
  try {
    const w = buildWiring(components, spec, getPart, locale);
    constants = pinConstants(buildConnections(w.components, w.netlist.nets, getPart), getPart);
  } catch {
    /* no wiring: a sketch without pins */
  }
  const outputs = constants.filter((c) => /LED|PUMP|MOTOR|RELAY|BUZZER|SERVO|SG90|RING|WS2812|SPEAKER/.test(c.name));
  const inputs = constants.filter((c) => !outputs.includes(c) && !/^(I2C|SPI)_/.test(c.name));
  const analog = (c: (typeof constants)[number]) => /^A\d/.test(c.value) || /SOIL|LDR|LIGHT/.test(c.name);
  return [
    `// ${name} — starter sketch for the ${board}`,
    "",
    ...(constants.length ? [pinBlock(constants), ""] : []),
    "void setup() {",
    "  Serial.begin(115200);",
    ...inputs.map((c) => `  pinMode(${c.name}, INPUT);`),
    ...outputs.map((c) => `  pinMode(${c.name}, OUTPUT);`),
    "}",
    "",
    "void loop() {",
    ...inputs.map((c) => `  Serial.println(${analog(c) ? "analogRead" : "digitalRead"}(${c.name}));`),
    ...outputs.map((c) => `  digitalWrite(${c.name}, !digitalRead(${c.name}));`),
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
        if (sameSpec(next, current)) return { ok: true, data: { reply: MOCK_REPLY[locale].nothing, changed: [] } };
        const changed =
          asked && actuatorTotals(next).find((a) => a.kind === asked.kind)?.count === asked.count
            ? [actuatorCountLabel(asked.kind, asked.count, locale)]
            : mockChanged(current, next, locale);
        return { ok: true, data: { reply: MOCK_REPLY[locale].done, spec: next, changed } };
      }
      if (!turn.messages.some((m) => m.role === "assistant")) return { ok: true, data: QUESTION[locale] };
      const plant = WORDS.plant.test(userTexts(idea, turn.messages).join(" "));
      return {
        ok: true,
        data: {
          spec: guardSpec(clampSpec({
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
          }), turn).spec,
        },
      };
    },
    async pick(spec, locale) {
      await wait(300);
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
      let components = picked;
      try {
        components = buildWiring(picked, spec, getPart, locale).components;
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
