// Shared pieces of the notification emails (Phase I): payload readers, number
// and date wording for EN/AR, the common "how to use your credit" text and the
// one HTML/text shell every kind goes through. Pure — no I/O, safe in tests.

import { escapeHtml } from "@/lib/email";
import { COMPANY, COMPANY_WHATSAPP } from "@/lib/company";
import { CAD_GENERATIONS, CREDIT_QAR, REDEEM_DAYS } from "@/lib/credits/constants";

export type NotificationLocale = "en" | "ar";

export type NotificationLinks = {
  siteUrl: string;
  projectsUrl: string;
  storeUrl: string;
  projectUrl?: string;
  unsubscribeUrl: string;
  whatsappUrl: string;
};

export type RenderArgs = {
  locale: NotificationLocale;
  payload: Record<string, unknown>;
  links: NotificationLinks;
};

export type Rendered = { subject: string; text: string; html: string };

// ─── payload readers (never throw) ──────────────────────────────────────────

/** A trimmed, single-line string from the payload; `fallback` when missing/blank. */
export function str(v: unknown, fallback = ""): string {
  if (typeof v === "string") {
    const s = v.replace(/\s+/g, " ").trim();
    return s || fallback;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return fallback;
}

/** A finite number from the payload (numbers or numeric strings); else `fallback`. */
export function num(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

/** Like `num` but undefined when absent (for optional balances). */
export function optNum(v: unknown): number | undefined {
  const n = num(v, NaN);
  return Number.isNaN(n) ? undefined : n;
}

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// ─── wording helpers ────────────────────────────────────────────────────────

export type CreditWord = "circuit" | "cad" | "any";
/** Arabic grammatical case of the counted noun: subject / object / after a preposition. */
export type ArCase = "nom" | "acc" | "gen";

/**
 * "3 circuit credits", "1 CAD credit", Arabic with number agreement:
 * 1 → "رصيد توصيل واحد", 2 → "رصيدا توصيل" (رصيدي in object/prepositional use),
 * 3-10 → "N أرصدة توصيل", 11+ → "N رصيد توصيل". `any` = credits of unspecified kind.
 */
export function creditCount(n: number, word: CreditWord, locale: NotificationLocale, arCase: ArCase = "acc"): string {
  const count = Math.max(0, Math.round(n));
  if (locale === "en") {
    const noun = word === "circuit" ? "circuit credit" : word === "cad" ? "CAD credit" : "credit";
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
  }
  const tail = word === "circuit" ? " توصيل" : word === "cad" ? " CAD" : "";
  if (count === 0) return `لا أرصدة${tail}`;
  if (count === 1) return `رصيد${tail} واحد${arCase === "acc" ? "ًا" : ""}`;
  if (count === 2) return `${arCase === "nom" ? "رصيدا" : "رصيدي"}${tail}`;
  if (count <= 10) return `${count} أرصدة${tail}`;
  return `${count} رصيد${arCase === "acc" && !tail ? "ًا" : ""}${tail}`;
}

/** "QAR 20" / "20 ر.ق". */
export function qar(amount: number, locale: NotificationLocale): string {
  const n = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return locale === "ar" ? `${n} ر.ق` : `QAR ${n}`;
}

/** A date in Qatar time, Latin digits: "31 October 2026" / "31 أكتوبر 2026". Null when unparseable. */
export function formatDate(value: unknown, locale: NotificationLocale): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(locale === "ar" ? "ar-QA-u-nu-latn" : "en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Qatar",
    }).format(d);
  } catch {
    return null;
  }
}

// ─── shared copy ────────────────────────────────────────────────────────────

const COPY = {
  en: {
    brandStrip: `${COMPANY.legalNameEn} · C.R. ${COMPANY.crNumber}`,
    howTitle: "How to use your credits",
    how: [
      `Your first circuit drawing (wiring diagram and schematic) on each project is free; every further one on that project costs 1 circuit credit. 1 CAD credit covers one CAD session for a 3D model, with up to ${CAD_GENERATIONS} versions.`,
      `Every credit you spend comes back as a QAR ${CREDIT_QAR} discount on any order with us (parts, 3D printing, laser or CNC) within ${REDEEM_DAYS} days, applied at checkout. Credits are never refunded as cash.`,
    ],
    howLink: "See how credits work",
    help: "Questions? Message us on WhatsApp",
    unsubscribe: "Unsubscribe from these emails",
    reason: "You are receiving this email because you have an account on Gestaltung360.",
  },
  ar: {
    brandStrip: `${COMPANY.legalNameAr} · س.ت ${COMPANY.crNumber}`,
    howTitle: "كيف تستخدم أرصدتك",
    how: [
      `أول رسم للدائرة (مخطط التوصيل والمخطط الكهربائي) في كل مشروع مجاني، وكل رسم إضافي في المشروع يكلّف رصيد توصيل واحدًا. رصيد CAD الواحد يغطي جلسة نموذج ثلاثي الأبعاد بحتى ${CAD_GENERATIONS} نسخ.`,
      `كل رصيد تستخدمه يعود إليك كخصم ${CREDIT_QAR} ر.ق على أي طلب معنا (قطع، طباعة ثلاثية الأبعاد، قص ليزر أو CNC) خلال ${REDEEM_DAYS} يومًا، ويُطبَّق عند إتمام الطلب. لا تُستردّ الأرصدة نقدًا أبدًا.`,
    ],
    howLink: "تعرّف على كيفية عمل الأرصدة",
    help: "لديك سؤال؟ راسلنا على واتساب",
    unsubscribe: "إلغاء الاشتراك في هذه الرسائل",
    reason: "وصلتك هذه الرسالة لأن لديك حسابًا في Gestaltung360.",
  },
} as const;

export function creditsPageUrl(links: NotificationLinks, locale: NotificationLocale): string {
  return `${links.siteUrl.replace(/\/+$/, "")}/${locale}/credits`;
}

// ─── the shell ──────────────────────────────────────────────────────────────

export type EmailDoc = {
  locale: NotificationLocale;
  links: NotificationLinks;
  subject: string;
  headline: string;
  /** Plain-text paragraphs (escaped on the way into HTML). */
  paragraphs: string[];
  /** Optional label/value lines (e.g. balances). */
  facts?: { label: string; value: string }[];
  cta: { label: string; url: string };
  /** Include the shared "how to use your credits" block (default true). */
  howTo?: boolean;
};

export function buildEmail(doc: EmailDoc): Rendered {
  const { locale, links } = doc;
  const c = COPY[locale];
  const ar = locale === "ar";
  const howTo = doc.howTo !== false;
  const learnUrl = creditsPageUrl(links, locale);

  // ── plain text
  const text = [
    c.brandStrip,
    "",
    doc.headline,
    "",
    ...doc.paragraphs.flatMap((p) => [p, ""]),
    ...(doc.facts?.length ? [...doc.facts.map((f) => `${f.label}: ${f.value}`), ""] : []),
    `${doc.cta.label}: ${doc.cta.url}`,
    "",
    ...(howTo ? [c.howTitle, ...c.how.flatMap((p) => ["", p]), "", `${c.howLink}: ${learnUrl}`, ""] : []),
    `${c.help}: ${COMPANY_WHATSAPP.display} ${links.whatsappUrl}`,
    "",
    "--",
    c.reason,
    `${c.unsubscribe}: ${links.unsubscribeUrl}`,
  ].join("\n");

  // ── html (inline styles only)
  const e = escapeHtml;
  const para = (s: string) => `<p style="margin:0 0 14px">${e(s)}</p>`;
  const facts = doc.facts?.length
    ? `<table role="presentation" style="border-collapse:collapse;margin:0 0 14px">${doc.facts
        .map(
          (f) =>
            `<tr><td style="padding:2px ${ar ? "0 2px 14px" : "14px 2px 0"};color:#475569">${e(f.label)}</td><td style="padding:2px 0;font-weight:bold">${e(f.value)}</td></tr>`
        )
        .join("")}</table>`
    : "";
  const how = howTo
    ? [
        `<div style="margin:20px 0 0;padding:14px 16px;border-radius:10px;background:#f1f5f9">`,
        `<p style="margin:0 0 8px;font-weight:bold;color:#0f172a">${e(c.howTitle)}</p>`,
        ...c.how.map((p) => `<p style="margin:0 0 10px;font-size:14px;color:#334155">${e(p)}</p>`),
        `<p style="margin:0;font-size:14px"><a href="${e(learnUrl)}" style="color:#1d4ed8">${e(c.howLink)}</a></p>`,
        `</div>`,
      ].join("")
    : "";

  const html = [
    `<div dir="${ar ? "rtl" : "ltr"}" lang="${locale}" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#0f172a;text-align:${ar ? "right" : "left"};max-width:560px;margin:0 auto;padding:16px">`,
    `<p style="margin:0 0 20px;padding:8px 12px;border-radius:8px;background:#0f172a;color:#ffffff;font-size:12px;letter-spacing:0.02em">${e(c.brandStrip)}</p>`,
    `<h1 style="margin:0 0 14px;font-size:20px;line-height:1.35;color:#0f172a">${e(doc.headline)}</h1>`,
    ...doc.paragraphs.map(para),
    facts,
    `<p style="margin:18px 0"><a href="${e(doc.cta.url)}" style="display:inline-block;padding:11px 20px;border-radius:10px;background:#1d4ed8;color:#ffffff;text-decoration:none;font-weight:bold">${e(doc.cta.label)}</a></p>`,
    how,
    `<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 14px"/>`,
    `<p style="margin:0 0 8px;font-size:12px;color:#64748b">${e(c.help)}: <a href="${e(links.whatsappUrl)}" dir="ltr" style="color:#1d4ed8">${e(COMPANY_WHATSAPP.display)}</a></p>`,
    `<p style="margin:0 0 4px;font-size:12px;color:#64748b">${e(c.reason)}</p>`,
    `<p style="margin:0;font-size:12px"><a href="${e(links.unsubscribeUrl)}" style="color:#64748b">${e(c.unsubscribe)}</a></p>`,
    `</div>`,
  ].join("");

  return { subject: doc.subject, text, html };
}
