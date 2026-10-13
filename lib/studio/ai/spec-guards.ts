// Deterministic guards around the idea chat (W3). Pure and client-safe: the
// server runs them on every model answer (lib/studio/ai/spec.ts), the e2e mock
// runs the same code, and the Idea step uses draftSpec() to fill the live card
// from the visitor's own words before the AI has answered.
//
// The prompt asks the model for the same things, but the model can drop them;
// these rules make sure it never does:
//  * vagueness: no function stated ("something with Arduino") → ONE short
//    question with tappable chips, never an echo of the idea (no model call);
//  * function words are kept: "automatic watering" → a pump (or a valve when the
//    visitor says valve) + a power source that can drive it; "beeps" → buzzer…;
//  * placement from the idea: plant → stands in the soil (plant_soil),
//    wearable → on the body / wrist, never the generic "sits on a desk";
//  * the visitor's latest words win ("make it solar" after "plug it in").

import { LIMITS, clampSpec, DEFAULT_SPEC, type ClampLog, type Output, type Placement, type ProductSpec } from "../schema";

type Locale = "en" | "ar";
type Msg = { role: "user" | "assistant"; text: string };

/** Card rows the guards (or the model) filled in. */
export type CardSlot = "place" | "power" | "does" | "senses" | "size";

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** Arabic has no \b in JS regexes: a whole Arabic word = space/start … space/end. */
const arWord = (w: string) => `(?:^|[\\s،.,!?؟])(?:و|ب|ل)?(?:ال)?${w}(?=$|[\\s،.,!?؟])`;

export const WORDS = {
  waterAction: new RegExp(`\\b(?:water(?:ing|s|ed)?|irrigat\\w*|sprinkl\\w*|drip\\w*)\\b|سقي|يسقي|تسقي|يروي|تروي|${arWord("ري")}`),
  auto: /\b(?:automatic(?:ally)?|auto|by itself|on its own|itself|self[- ]?watering|schedul\w*|timer)\b|تلقائي|أوتوماتيك|اوتوماتيك|بنفسه|ذاتي/,
  pump: /\b(?:pumps?|pumping|irrigat\w*|sprinklers?|drip)\b|مضخ/,
  valve: /\b(?:valves?|solenoid)\b|صمام|محبس/,
  plant: /\b(?:plants?|soil|pots?|potted|garden\w*|seedlings?|herbs?|flowers?|cactus|succulents?)\b|نبات|نبتة|تربة|حديقة|زرع|أصيص|اصيص|زهور|ورود/,
  plantSense: new RegExp(`\\b(?:water\\w*|moist\\w*|monitor\\w*|thirst\\w*|dry|soil|irrigat\\w*)\\b|رطوبة|سقي|يسقي|عطش|جاف|تربة|مراقب|${arWord("ري")}`),
  outdoor: /\b(?:garden\w*|outdoors?|outside|balcony|yard|backyard|farm|greenhouse)\b|حديقة|خارج|شرفة|بلكون|مزرعة/,
  wrist: /\b(?:wrists?|smart ?watch|wristband|bracelet|armband)\b|معصم|ساعة يد|سوار/,
  wear: /\b(?:wearables?|wear(?:ing)?|worn|necklace|pendant|gloves?|helmet|badge|on my (?:arm|wrist|body|chest|shirt|bag))\b|ارتداء|يلبس|ألبس|البس|قلادة|خوذة|قفاز/,
  solar: /\b(?:solar|sun[- ]powered)\b|شمسي|طاقة شمسية|بالشمس/,
  battery: /\b(?:battery|batteries|rechargeable|cordless|portable)\b|بطارية|بطاريه|قابل للشحن|محمول/,
  mains: /\b(?:plug(?:s|ged)?(?: it)? (?:in|into)|wall (?:socket|power|outlet)|mains|power adapter|adapter)\b|مقبس|كهرباء المنزل|محول/,
  usb: /\busb\b|يو ?إس ?بي/,
  buzzer: /\b(?:beeps?|beeping|buzz\w*|alarms?|siren|alert sound)\b|إنذار|انذار|صفارة|يصفر|يصفّر|تنبيه صوتي/,
  screen: /\b(?:screen|display|lcd|oled|shows? (?:the |me )?(?:temperature|time|date|level|reading|value|status)\w*)\b|شاشة|يعرض/,
  led: /\b(?:lights? up|lighting up|lamp|leds?|glows?|glowing|night ?light)\b|يضيء|يضيئ|إضاءة|اضاءة|مصباح/,
  motion: /\b(?:motion|movement|walks? (?:in|by|past)|walk in|someone (?:comes|enters)|presence|pir)\b|حركة|أدخل|ادخل|يدخل|مرور/,
  temperature: /\b(?:temperature|thermometer|humidity|weather)\b|حرارة|الطقس/,
} as const;

const NEG_EN = "\\b(?:no|without|remove|drop|skip|lose|don'?t (?:need|want))\\b(?:\\s+(?:the|a|any))?\\s+";
const NEG_AR = "(?:بدون|بلا|لا أريد|لا اريد|احذف|أزل|ازل|شيل)\\s*(?:ال)?";
const negOf = (en: string, ar: string) => new RegExp(`${NEG_EN}(?:${en})|${NEG_AR}(?:${ar})`);

const NEG = {
  pump: negOf("pumps?|watering|automatic watering", "مضخ|سقي|الري"),
  valve: negOf("valves?|solenoid", "صمام"),
  buzzer: negOf("beeps?|beeping|buzzers?|sound|alarms?", "صوت|صفارة|إنذار"),
  screen: negOf("screens?|displays?", "شاشة"),
  led: negOf("lights?|leds?|lamp", "ضوء|إضاءة|مصباح"),
} as const;

/** The visitor's own words, oldest first (the idea, then every answer and change request). */
export function userTexts(idea: string, messages: readonly Msg[]): string[] {
  return [idea, ...messages.filter((m) => m.role === "user").map((m) => m.text)]
    .map((t) => (t ?? "").toLowerCase().trim())
    .filter(Boolean);
}

const lastIndex = (texts: readonly string[], re: RegExp) => {
  for (let i = texts.length - 1; i >= 0; i--) if (re.test(texts[i])) return i;
  return -1;
};

/** Wanted = said somewhere, and not taken back in a later (or the same) message. */
function wanted(texts: readonly string[], pos: RegExp | RegExp[], neg: RegExp | null): boolean {
  const list = Array.isArray(pos) ? pos : [pos];
  const p = Math.max(...list.map((re) => lastIndex(texts, re)));
  if (p < 0) return false;
  if (!neg) return true;
  const n = lastIndex(texts, neg);
  return n < 0 || n < p || (n === p && list.some((re) => re.test(texts[p].replace(neg, " "))));
}

// ---------------------------------------------------------------------------
// Vagueness
// ---------------------------------------------------------------------------

const FILLER = new Set(
  (
    "a an the and or of to for with without using use used by on in into at from it its this that these some any my me i im i'm " +
    "we our you your can could would should will want wanna like love need help please just maybe kind sort really very " +
    "build building make making made create creating design designing do doing start new cool fun simple small little tiny big " +
    "smart nice good great awesome interesting easy basic first own something anything everything nothing stuff thing things " +
    "device gadget product project projects idea ideas prototype electronic electronics circuit kit diy hobby " +
    "arduino uno nano mega esp esp32 esp8266 raspberry pi pico microcontroller micro controller board boards module modules " +
    "شيء شي شيئا حاجة اشي مشروع مشاريع جهاز أداة اداة منتج فكرة أفكار افكار أريد اريد ابغى أبغى ابي بدي نفسي " +
    "بناء ابني أبني صنع اصنع أصنع تصميم اصمم أصمم عمل اعمل أعمل جديد جديدة صغير صغيرة ذكي ذكية جميل بسيط بسيطة " +
    "باستخدام استخدام مع من في على عن الى إلى هذا هذه أي اي اردوينو أردوينو آردوينو ارديونو esp لوحة دائرة إلكترونيات الكترونيات " +
    "راسبيري باي بيكو متحكم"
  ).split(/\s+/),
);

/** Strip Arabic "و/ب/ل" + "ال" prefixes so "بالأردوينو" counts as "أردوينو". */
const bareAr = (w: string) => w.replace(/^(?:و|ب|ل|ف)?(?:ال)(?=..)/, "").replace(/^(?:و|ب)(?=...)/, "");

/** True when the visitor's words state no function at all ("something with Arduino"). */
export function isVague(texts: readonly string[]): boolean {
  const words = texts
    .join(" ")
    .toLowerCase()
    .split(/[^\p{L}\p{N}'’]+/u)
    .map((w) => w.replace(/[’']/g, "'"))
    .filter((w) => w.length > 1 && !/^\d+$/.test(w));
  return words.every((w) => FILLER.has(w) || FILLER.has(bareAr(w)) || FILLER.has(w.replace(/'s$/, "")));
}

export const VAGUE_QUESTION: Record<Locale, { question: string; choices: string[] }> = {
  en: {
    question: "Fun! What should it do?",
    choices: ["Water a plant by itself", "Light up when I walk in", "Show the temperature", "Beep as an alarm"],
  },
  ar: {
    question: "رائع! ماذا تريده أن يفعل؟",
    choices: ["يسقي نبتة تلقائياً", "يضيء عندما أدخل", "يعرض درجة الحرارة", "يصفّر كإنذار"],
  },
};

/**
 * The one clarifying question for a vague idea, or null. Asked once: when the
 * visitor's answer is still vague, the model takes it from there.
 */
export function vagueTurn(
  idea: string,
  messages: readonly Msg[],
  locale: Locale,
): { kind: "question"; question: string; choices: string[] } | null {
  const asked = messages.some((m) => m.role === "assistant" && (m.text === VAGUE_QUESTION.en.question || m.text === VAGUE_QUESTION.ar.question));
  if (asked) return null;
  if (!isVague(userTexts(idea, messages))) return null;
  return { kind: "question", ...VAGUE_QUESTION[locale] };
}

// ---------------------------------------------------------------------------
// Function words, power, placement
// ---------------------------------------------------------------------------

const FEATURE: Record<string, { en: string; ar: string; has: RegExp }> = {
  pump: { en: "Small water pump", ar: "مضخة ماء صغيرة", has: /pump|مضخ/i },
  valve: { en: "Water valve", ar: "صمام ماء", has: /valve|solenoid|صمام/i },
  soil: { en: "Soil moisture sensor", ar: "حساس رطوبة التربة", has: /soil|moist|رطوبة|تربة/i },
  motion: { en: "Motion sensor", ar: "حساس حركة", has: /motion|pir|movement|presence|حركة/i },
  temperature: { en: "Temperature sensor", ar: "حساس حرارة", has: /temp|humid|حرار/i },
  solar: { en: "Solar charging", ar: "شحن بالطاقة الشمسية", has: /solar|شمس/i },
};

export type Actuator = "pump" | "valve" | null;

/** The water actuator the visitor's words ask for. */
export function actuatorFor(texts: readonly string[]): Actuator {
  const joined = texts.join("\n");
  if (wanted(texts, WORDS.valve, NEG.valve)) return "valve";
  const pumpish = WORDS.pump.test(joined) || (WORDS.waterAction.test(joined) && WORDS.auto.test(joined));
  if (!pumpish) return null;
  return wanted(texts, [WORDS.pump, WORDS.waterAction, WORDS.auto], NEG.pump) ? "pump" : null;
}

type PowerWord = "solar" | "battery" | "mains" | "usb";
/** The LAST power source the visitor named ("make it solar" beats an earlier "plug it in"). */
export function powerSaid(texts: readonly string[]): PowerWord | null {
  for (let i = texts.length - 1; i >= 0; i--) {
    const t = texts[i];
    if (WORDS.solar.test(t)) return "solar";
    if (WORDS.battery.test(t)) return "battery";
    if (WORDS.mains.test(t)) return "mains";
    if (WORDS.usb.test(t)) return "usb";
  }
  return null;
}

export type Guarded = { spec: ProductSpec; touched: Set<CardSlot> };

/**
 * Apply the rules to a spec (from the model, or the current card during a
 * refinement). Only ADDS what the visitor's words ask for and fixes what
 * contradicts them; everything else the model said is kept.
 */
export function guardSpec(
  input: ProductSpec,
  ctx: { idea: string; messages: readonly Msg[]; locale: Locale },
  log: ClampLog = [],
): Guarded {
  const texts = userTexts(ctx.idea, ctx.messages);
  const joined = texts.join("\n");
  const touched = new Set<CardSlot>();
  const s: ProductSpec = { ...input, features: [...input.features], inputs: [...input.inputs], outputs: [...input.outputs] };
  const addFeatures: string[] = [];
  const feature = (key: keyof typeof FEATURE) => {
    const f = FEATURE[key];
    if (!s.features.some((x) => f.has.test(x)) && !addFeatures.some((x) => f.has.test(x))) addFeatures.push(f[ctx.locale]);
    touched.add("senses");
  };
  const setOutput = (o: Output, on: boolean) => {
    const has = s.outputs.includes(o);
    if (on && !has) s.outputs = [o, ...s.outputs];
    if (!on && has) s.outputs = s.outputs.filter((x) => x !== o);
    if (on !== has) log.push({ path: "outputs", from: o, to: on ? "added" : "removed" });
    if (on) touched.add("does");
  };

  // 1. Actuator: "automatic watering" never gets lost.
  const actuator = actuatorFor(texts);
  if (actuator === "pump") {
    setOutput("pump", true);
    feature("pump");
  } else if (actuator === "valve") {
    setOutput("relay", true);
    feature("valve");
  } else if (s.outputs.includes("pump") && lastIndex(texts, NEG.pump) >= 0) {
    setOutput("pump", false);
  }

  // 2. Other function words the visitor wrote (added, or removed when taken back).
  for (const o of ["buzzer", "screen", "led"] as const) {
    if (wanted(texts, WORDS[o], NEG[o])) setOutput(o, true);
    else if (s.outputs.includes(o) && lastIndex(texts, NEG[o]) > lastIndex(texts, WORDS[o])) setOutput(o, false);
  }
  if (WORDS.motion.test(joined)) feature("motion");
  if (WORDS.temperature.test(joined)) feature("temperature");

  // 3. Placement (and size) from the idea, never the generic default.
  const plant = WORDS.plant.test(joined);
  const worn = !plant && (WORDS.wear.test(joined) || WORDS.wrist.test(joined) || s.use === "wearable");
  if (plant) {
    if (WORDS.plantSense.test(joined) || actuator) feature("soil");
    setPlacement(s, "plant_soil", log);
    if (WORDS.outdoor.test(joined)) {
      s.use = "outdoor";
      s.environment = "outdoor";
    } else if (s.use === "wearable" || s.use === "handheld" || s.use === "vehicle" || s.use === "wall") {
      log.push({ path: "use", from: s.use, to: "desk" });
      s.use = "desk";
    }
    if (s.sizeHint === "desk" || s.sizeHint === "large") s.sizeHint = "palm";
    touched.add("place");
    touched.add("size");
  } else if (worn) {
    if (s.use !== "wearable") log.push({ path: "use", from: s.use, to: "wearable" });
    s.use = "wearable";
    setPlacement(s, WORDS.wrist.test(joined) ? "on_wrist" : "on_body", log);
    if (s.sizeHint !== "pocket") s.sizeHint = "pocket";
    touched.add("place");
    touched.add("size");
  } else if (s.placement === "plant_soil") {
    // The plant was taken out of the idea: back to the use alone.
    delete s.placement;
  }

  // 4. One power source that matches: the visitor's latest word first, then what the parts need.
  const said = powerSaid(texts);
  const before = s.power;
  if (said === "solar") {
    s.power = "battery_usb";
    feature("solar");
  } else if (said === "battery") s.power = s.power === "battery" || s.power === "battery_usb" ? s.power : "battery_usb";
  else if (said === "mains") s.power = "mains_adapter";
  else if (said === "usb") s.power = s.power === "battery_usb" ? s.power : "usb";
  // A solenoid valve needs a wall adapter; a pump drains a lone battery (it must charge).
  if (actuator === "valve" && said !== "solar" && said !== "battery") s.power = "mains_adapter";
  if (actuator === "pump" && s.power === "battery") s.power = said ? "battery_usb" : "usb";
  // Worn things cannot hang off a cable.
  if (worn && (s.power === "usb" || s.power === "mains_adapter")) s.power = "battery_usb";
  // "Solar" taken back by a later power word: the solar feature goes too.
  if (said !== null && said !== "solar") s.features = s.features.filter((f) => !FEATURE.solar.has.test(f));
  if (s.power !== before) log.push({ path: "power", from: before, to: s.power });
  if (said || actuator || worn) touched.add("power");

  s.features = [...addFeatures, ...s.features].slice(0, LIMITS.features.max);
  if (addFeatures.length) log.push({ path: "features", from: input.features, to: s.features });
  return { spec: clampSpec(s), touched };
}

function setPlacement(s: ProductSpec, p: Placement, log: ClampLog) {
  if (s.placement !== p) log.push({ path: "placement", from: s.placement ?? null, to: p });
  s.placement = p;
}

/**
 * The live card while the chat is still going: what the visitor's own words
 * already tell us (no AI). `known` = the rows to show filled in.
 */
export function draftSpec(idea: string, messages: readonly Msg[], locale: Locale): Guarded {
  const blank: ProductSpec = { ...DEFAULT_SPEC, outputs: [], features: [] };
  return guardSpec(blank, { idea, messages, locale });
}

// ---------------------------------------------------------------------------
// Chat guard (Part A): messages that need no AI at all
// ---------------------------------------------------------------------------
// Empty / punctuation-only, emoji-only, or nothing but greetings, thanks or
// insults ("hi", "thanks!", "are you stupid") → a canned reply in the page
// language, no model call and no card change. Anything with a real word in it
// ("who made you?", "what is UR10") goes to the model.

export type ChatGuardKind = "empty" | "emoji" | "greeting" | "thanks" | "insult";

const GREETING = new Set(
  (
    "hi hii hiii hello helo hey heya hiya yo sup howdy greetings morning evening afternoon good day " +
    "مرحبا مرحباً مرحبتين اهلا أهلا اهلين أهلين هلا هاي هلو سلام السلام عليكم صباح مساء الخير النور"
  ).split(/\s+/),
);
const THANKS = new Set("thanks thank thx ty cheers appreciated شكرا شكراً مشكور يعطيك العافية".split(/\s+/));
const INSULT = new Set(
  (
    "stupid dumb idiot idiotic moron moronic useless dumbass trash garbage rubbish sucks suck stinks lame pathetic " +
    "shut up hate wtf stfu fool crap terrible worst " +
    "غبي غبية حمار حمارة تافه تافهة سخيف سخيفة اسكت فاشل فاشلة احمق أحمق اهبل أهبل كريه"
  ).split(/\s+/),
);
/** Words that never change what the message is ("are you stupid", "thank you so much"). */
const GUARD_FILLER = new Set(
  (
    "you u ur you're youre are r is it this that so very really such a an the and too just bot ai assistant thing " +
    "much lot all there guys man bro i im i'm am me how so" +
    " انت أنت انتي إنتي يا هل جدا جداً كثير مرة مره و"
  ).split(/\s+/),
);

/** What a message is, when it needs no AI (null = a real message for the model). */
export function chatGuardKind(text: string): ChatGuardKind | null {
  const t = (text ?? "").trim().toLowerCase();
  if (!/[\p{L}\p{N}]/u.test(t)) return /\p{Extended_Pictographic}/u.test(t) ? "emoji" : "empty";
  const words = t
    .split(/[^\p{L}\p{N}'’]+/u)
    .map((w) => w.replace(/[’']/g, "'"))
    .filter(Boolean);
  let kind: ChatGuardKind | null = null;
  for (const w of words) {
    const bare = bareAr(w);
    const is = (set: Set<string>) => set.has(w) || set.has(bare) || set.has(w.replace(/(.)\1+$/, "$1"));
    if (is(INSULT)) kind = "insult"; // an insult wins over a greeting in the same line
    else if (is(THANKS)) kind = kind === "insult" ? kind : "thanks";
    else if (is(GREETING)) kind = kind ?? "greeting";
    else if (!GUARD_FILLER.has(w) && !GUARD_FILLER.has(bare)) return null;
  }
  return kind;
}

/** Once the card is there: a calm one-line reply; the card stays as it is. */
export const GUARD_REPLY: Record<ChatGuardKind, Record<Locale, string>> = {
  empty: {
    en: "Tell me what to change on the card, or ask me anything about your idea.",
    ar: "أخبرني ماذا أغيّر في البطاقة، أو اسألني أي شيء عن فكرتك.",
  },
  emoji: {
    en: "Got it. Tell me what to change on the card, or ask me anything about your idea.",
    ar: "وصلت. أخبرني ماذا أغيّر في البطاقة، أو اسألني أي شيء عن فكرتك.",
  },
  greeting: {
    en: "Hi! I'm Gestaltung's design assistant. Tell me what to change on the card, or ask me about your idea.",
    ar: "أهلاً! أنا مساعد التصميم في جِشتالتُونج. أخبرني ماذا أغيّر في البطاقة، أو اسألني عن فكرتك.",
  },
  thanks: {
    en: "You're welcome! Anything else to change on the card?",
    ar: "على الرحب والسعة! هل تريد تغيير شيء آخر في البطاقة؟",
  },
  insult: {
    en: "Sorry it's not right yet. Tell me what to change and I'll fix the card.",
    ar: "آسف إن لم تكن البطاقة كما تريد. أخبرني ماذا أغيّر وسأعدّلها.",
  },
};

/** Before the card: the same chips as a vague idea, after a short canned line. */
export const GUARD_QUESTION: Record<ChatGuardKind, Record<Locale, string>> = {
  empty: { en: "What should your product do?", ar: "ماذا تريد أن يفعل منتجك؟" },
  emoji: { en: "What should your product do?", ar: "ماذا تريد أن يفعل منتجك؟" },
  greeting: { en: "Hi! What should your product do?", ar: "أهلاً! ماذا تريد أن يفعل منتجك؟" },
  thanks: { en: "Happy to help! What should your product do?", ar: "يسعدني ذلك! ماذا تريد أن يفعل منتجك؟" },
  insult: { en: "Let's start again. What should your product do?", ar: "لنبدأ من جديد. ماذا تريد أن يفعل منتجك؟" },
};

export type GuardTurn =
  | { kind: "reply"; reply: string; changed: string[] }
  | { kind: "question"; question: string; choices: string[] };

/**
 * The canned turn for the visitor's latest message (the idea itself on the first
 * turn), or null when the model should answer. `hasCard` = the spec card is shown.
 */
export function chatGuardTurn(
  idea: string,
  messages: readonly Msg[],
  locale: Locale,
  hasCard: boolean,
): GuardTurn | null {
  const last = [...messages].reverse().find((m) => m.role === "user");
  const kind = chatGuardKind(last ? last.text : idea);
  if (!kind) return null;
  if (hasCard) return { kind: "reply", reply: GUARD_REPLY[kind][locale], changed: [] };
  return { kind: "question", question: GUARD_QUESTION[kind][locale], choices: VAGUE_QUESTION[locale].choices };
}
