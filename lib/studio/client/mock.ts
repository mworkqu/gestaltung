"use client";

// TEST-ONLY StudioApi for the e2e fixture (/[locale]/e2e-fixtures/studio):
// no network, no Supabase, no AI, no credit. Answers are canned but go
// through the same rules the server uses (buildWiring, defaultEnclosureFor),
// so the schematic, the 3D enclosure and the printed parts are real
// (defaultMechParts); the firmware is a small canned sketch for the chosen board.

import { getPart } from "@/lib/studio/library";
import { buildWiring } from "@/lib/studio/netlist";
import { defaultMechParts, layoutBounds, mechSummary } from "@/lib/studio/ai/mech-default";
import { defaultEnclosureFor } from "@/lib/studio/enclosure/templates";
import { clampSpec, type StudioComponent } from "@/lib/studio/schema";
import type { Locale, StudioApi } from "./api";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const QUESTION: Record<Locale, { question: string; choices: string[] }> = {
  en: { question: "Where will it live?", choices: ["On my desk", "On a wall", "In my hand"] },
  ar: { question: "أين سيُستخدم؟", choices: ["على مكتبي", "على الحائط", "في يدي"] },
};

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
    async spec({ messages, locale, idea }) {
      await wait(250);
      if (!messages.some((m) => m.role === "assistant")) return { ok: true, data: QUESTION[locale] };
      return {
        ok: true,
        data: {
          spec: clampSpec({
            name: locale === "ar" ? "رفيق المكتب" : "Desk buddy",
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
          }),
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
      const code = [
        `// ${spec.name} — starter sketch for the ${board}`,
        "const int MOTION_PIN = 27; // motion sensor OUT",
        "const int LED_PIN = 26;    // the small light",
        "",
        "void setup() {",
        "  Serial.begin(115200);",
        "  pinMode(MOTION_PIN, INPUT);",
        "  pinMode(LED_PIN, OUTPUT);",
        "}",
        "",
        "void loop() {",
        "  bool someone = digitalRead(MOTION_PIN) == HIGH;",
        "  digitalWrite(LED_PIN, someone ? HIGH : LOW);",
        "  delay(50);",
        "}",
      ].join("\n");
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
    async profile() {
      return { userId: null, phone: "+97455555555", fullName: "Test" };
    },
    async requestQuote() {
      await wait(200);
      return true;
    },
  };
}
