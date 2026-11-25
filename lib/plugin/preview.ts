/**
 * "How it will look": the data behind the in-chat preview card (MCP Apps UI
 * resource `ui://gestaltung360/preview`). Pure.
 *
 * Deliberately carries NO millimetre figures. The client sees the shape, the
 * colour, the finish, the label, the parts and the total in QAR; the engineer
 * builds the model. CLAUDE.md: the model proposes a function, never a product,
 * and no number appears that we did not compute — so the case is drawn
 * proportionally from the template, never dimensioned.
 *
 * No CAD program is named anywhere in this payload: the word for it is "case".
 */

import { formatQar } from "@/lib/format/money";
import type { Locale } from "@/lib/locale";

import type { BuildFile } from "./build-file";
import type { CheckResult } from "./check-project";

export const PREVIEW_URI = "ui://gestaltung360/preview";

/** The one mime type an MCP Apps HTML widget may use (spec 2026-01-26). */
export const PREVIEW_MIME = "text/html;profile=mcp-app";

export type PreviewPart = {
  name: string;
  qty: number;
  /** Formatted, e.g. "QAR 16" — or null when we source it and there is no price yet. */
  price: string | null;
  in_store: boolean;
};

export type PreviewPayload = {
  name: string;
  look: {
    template: string;
    /** A plain-words shape, so the widget never has to know our template ids. */
    shape: string;
    colour: string;
    /** A CSS colour for the drawing only. */
    swatch: string;
    finish: string;
    label: string | null;
    notes: string;
  };
  parts: PreviewPart[];
  parts_total: string;
  parts_total_qar: number;
  wiring_summary: string;
  /** What `send_project` would send, listed for the user before they agree. */
  sends: string[];
  engineer_line: string;
  company: string;
  locale: Locale;
};

/** Our template ids in plain words — the client never sees "stake_pod". */
const SHAPES: Record<string, { en: string; ar: string }> = {
  rounded_box: { en: "a rounded box", ar: "علبة بحواف دائرية" },
  pill: { en: "a pill shape", ar: "شكل بيضاوي ممدود" },
  soft_wedge: { en: "a sloped wedge", ar: "شكل مائل" },
  puck: { en: "a round puck", ar: "قرص دائري" },
  handheld_taper: { en: "a hand-held tapered body", ar: "جسم يدوي متدرج" },
  lantern: { en: "a lantern shape", ar: "شكل فانوس" },
  dome_base: { en: "a domed top on a base", ar: "قبة على قاعدة" },
  wall_plate: { en: "a flat wall plate", ar: "لوحة جدارية مسطحة" },
  stake_pod: { en: "a pod on a ground stake", ar: "حاوية على ركيزة أرضية" },
};

/** Finishes in plain words. */
const FINISHES: Record<string, { en: string; ar: string }> = {
  matte_plastic: { en: "matte", ar: "مطفي" },
  glossy_plastic: { en: "glossy", ar: "لامع" },
  soft_touch: { en: "soft touch", ar: "ناعم الملمس" },
  anodized_aluminium: { en: "anodised aluminium", ar: "ألمنيوم مؤكسد" },
  wood_look: { en: "wood look", ar: "بمظهر الخشب" },
};

/** Colour names and the swatch the drawing uses. Names, not invented codes. */
const COLOURS: Record<string, { en: string; ar: string; css: string }> = {
  chalk: { en: "chalk", ar: "أبيض طباشيري", css: "#eef1f5" },
  graphite: { en: "graphite", ar: "رمادي داكن", css: "#3b4149" },
  sand: { en: "sand", ar: "رملي", css: "#ded2bb" },
  sage: { en: "sage", ar: "أخضر باهت", css: "#b7c6b2" },
  coral: { en: "coral", ar: "مرجاني", css: "#e4867a" },
  ocean: { en: "ocean", ar: "أزرق محيطي", css: "#4f7f9c" },
  sun: { en: "sun", ar: "أصفر شمسي", css: "#e8c261" },
  cobalt: { en: "cobalt", ar: "أزرق كوبالت", css: "#2f5fd0" },
  mist: { en: "mist", ar: "رمادي فاتح", css: "#c9d2db" },
  clay: { en: "clay", ar: "طيني", css: "#b4705a" },
};

const pickWord = (map: Record<string, { en: string; ar: string }>, key: string, locale: Locale): string =>
  map[key] ? (locale === "ar" ? map[key]!.ar : map[key]!.en) : key.replace(/_/g, " ");

/** The one service phrase, in both languages. */
export function engineerLine(locale: Locale): string {
  return locale === "ar"
    ? "يراجع مهندسنا ملفك ويحدد أفضل طريقة تصنيع مع السعر خلال يوم عمل واحد."
    : "Our engineer reviews your file and quotes the best method within one working day.";
}

/** Exactly what send_project would send, so the user can read it before agreeing. */
export function sendsList(build: BuildFile, locale: Locale): string[] {
  const ar = locale === "ar";
  const out = [
    ar ? "ملخّص المنتج والقرارات التي اتخذتها" : "The product summary and the decisions you made",
    ar ? "القطع المختارة وكمياتها" : "The parts you chose and how many",
    ar ? "التوصيل الذي نحسبه من القطع" : "The wiring, recomputed from the parts",
    ar ? "شكل العلبة ولونها وتشطيبها" : "The case: its shape, colour and finish",
    ar ? "وصف العلبة لمهندسنا" : "The case brief for our engineer",
  ];
  if (build.code) out.push(ar ? "الكود الخاص بالمنتج" : "The code for the product");
  if (build.requirement_quotes.length) {
    out.push(
      ar
        ? `${build.requirement_quotes.length} اقتباسًا قصيرًا من كلماتك للمتطلبات الأساسية`
        : `${build.requirement_quotes.length} short quote${build.requirement_quotes.length === 1 ? "" : "s"} of your own words`,
    );
  }
  out.push(ar ? "المحادثة نفسها لا تُرسل أبدًا" : "The conversation itself is never sent");
  return out;
}

export function previewPayload(
  build: BuildFile,
  result: CheckResult,
  opts: { locale: Locale; company: string },
): PreviewPayload {
  const { locale } = opts;
  const colour = COLOURS[build.look.colour];

  return {
    name: build.name,
    look: {
      template: build.look.template,
      shape: pickWord(SHAPES, build.look.template, locale),
      colour: colour ? (locale === "ar" ? colour.ar : colour.en) : build.look.colour,
      swatch: colour?.css ?? "#dfe5ec",
      finish: pickWord(FINISHES, build.look.finish, locale),
      label: build.look.label || null,
      notes: build.look.notes ?? "",
    },
    parts: result.parts.map((p) => ({
      name: p.name,
      qty: p.qty,
      price: p.price_qar !== undefined ? formatQar(p.price_qar, locale) : null,
      in_store: p.status === "in_store",
    })),
    parts_total: formatQar(result.parts_total_qar, locale),
    parts_total_qar: result.parts_total_qar,
    wiring_summary: result.wiring_summary,
    sends: sendsList(build, locale),
    engineer_line: engineerLine(locale),
    company: opts.company,
    locale,
  };
}
