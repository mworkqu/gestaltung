// The ONE branded email shell. Every email the app sends (owner lead alerts,
// order and credit emails, project links, cron reports) is built through
// renderBrandedEmail(), so they all share the logo header, the cobalt accent,
// the neu-light card, RTL for Arabic and a plain-text twin. Pure: no I/O, safe
// in tests.
//
// Email-safe on purpose: tables for layout, inline styles only, no external CSS
// or web fonts, the logo is an absolute https URL of a small public asset
// (public/icon.png, 1.7 KB). Visible text never carries a raw URL or an id;
// links live in href only (the plain-text part must carry them, it has no
// buttons).

import { COMPANY, COMPANY_WHATSAPP } from "@/lib/company";

export type EmailLocale = "en" | "ar";

/** DESIGN.md palette, as hex (email clients have no CSS variables). */
export const BRAND = {
  canvas: "#eef2f7",
  recessed: "#e6ebf2",
  ink: "#1c2434",
  body: "#475569",
  muted: "#64748b",
  faint: "#94a3b8",
  border: "#d3dbe6",
  cobalt: "#0e59c5",
  white: "#ffffff",
} as const;

const FONT_LTR = "Arial,Helvetica,sans-serif";
const FONT_RTL = "'Segoe UI',Tahoma,Arial,sans-serif";

export function escapeHtmlText(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
const e = escapeHtmlText;

export type BrandButton = { label: string; url: string; variant?: "primary" | "secondary" };

export type BrandFact = {
  label: string;
  value: string;
  /** Make the value itself a link (href only; the text stays the value). */
  href?: string;
  /** A small pill next to the value, e.g. "Open WhatsApp" -> wa.me. */
  action?: { label: string; url: string };
  /** Keep the value left-to-right inside an Arabic email (phones, file names). */
  ltr?: boolean;
};

export type BrandEmailDoc = {
  locale: EmailLocale;
  /** The headline inside the card (also the <title>). */
  title: string;
  /** Hidden inbox preview line. */
  preheader?: string;
  /** Plain paragraphs (escaped). */
  paragraphs?: string[];
  facts?: BrandFact[];
  /** Pre-escaped HTML for the body, and its plain-text twin (order tables etc.). */
  bodyHtml?: string;
  bodyText?: string;
  /** A quoted block, e.g. the customer's notes (escaped, line breaks kept). */
  quote?: { label: string; text: string };
  buttons?: BrandButton[];
  /** Extra pre-built blocks after the buttons (rating row, credits box). */
  afterHtml?: string;
  afterText?: string;
  footer?: {
    /** "You are receiving this because..." */
    reason?: string;
    /** Show "Questions? Message us on WhatsApp" (customer emails). Default true. */
    help?: boolean;
    unsubscribe?: { label: string; url: string };
  };
  /** Site origin for the logo and the footer link; default NEXT_PUBLIC_SITE_URL or gestaltung360.com. */
  siteUrl?: string;
};

const COPY = {
  en: {
    brandStrip: `${COMPANY.legalNameEn} · C.R. ${COMPANY.crNumber}`,
    help: "Questions? Message us on WhatsApp",
  },
  ar: {
    brandStrip: `${COMPANY.legalNameAr} · س.ت ${COMPANY.crNumber}`,
    help: "لديك سؤال؟ راسلنا على واتساب",
  },
} as const;

export function defaultSiteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://gestaltung360.com").replace(/\/+$/, "");
}

// ─── building blocks (exported for the few emails with special sections) ────

/** One bulletproof button: a table cell with a background, so Outlook keeps the colour. */
export function buttonHtml(b: BrandButton, ar: boolean): string {
  const primary = b.variant !== "secondary";
  const bg = primary ? BRAND.cobalt : BRAND.white;
  const color = primary ? BRAND.white : BRAND.cobalt;
  const font = ar ? FONT_RTL : FONT_LTR;
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;display:inline-table;margin:0 ${ar ? "0 8px 8px" : "8px 8px 0"}">` +
    `<tr><td align="center" bgcolor="${bg}" style="border-radius:10px;border:1px solid ${BRAND.cobalt};background:${bg}">` +
    `<a href="${e(b.url)}" style="display:inline-block;padding:12px 22px;font-family:${font};font-size:15px;font-weight:bold;line-height:1.2;color:${color};text-decoration:none;border-radius:10px">${e(b.label)}</a>` +
    `</td></tr></table>`
  );
}

function factsHtml(facts: BrandFact[], ar: boolean): string {
  const rows = facts
    .map((f, i) => {
      const last = i === facts.length - 1;
      const line = last ? "" : `border-bottom:1px solid ${BRAND.border};`;
      const valueInner = f.href
        ? `<a href="${e(f.href)}" style="color:${BRAND.cobalt};text-decoration:none">${e(f.value)}</a>`
        : e(f.value);
      const wrapped = f.ltr ? `<span dir="ltr" style="unicode-bidi:isolate">${valueInner}</span>` : valueInner;
      const action = f.action
        ? ` <a href="${e(f.action.url)}" style="display:inline-block;margin-${ar ? "right" : "left"}:8px;padding:2px 10px;border-radius:999px;border:1px solid ${BRAND.cobalt};background:${BRAND.white};color:${BRAND.cobalt};font-size:12px;font-weight:bold;text-decoration:none">${e(f.action.label)}</a>`
        : "";
      return (
        `<tr>` +
        `<td valign="top" style="padding:10px 14px;${line}font-size:12px;color:${BRAND.muted};width:34%;text-align:${ar ? "right" : "left"}">${e(f.label)}</td>` +
        `<td valign="top" style="padding:10px 14px;${line}font-size:15px;font-weight:bold;color:${BRAND.ink};text-align:${ar ? "right" : "left"}">${wrapped}${action}</td>` +
        `</tr>`
      );
    })
    .join("");
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-spacing:0;margin:0 0 18px;background:${BRAND.recessed};border:1px solid ${BRAND.border};border-radius:12px">` +
    rows +
    `</table>`
  );
}

function quoteHtml(q: { label: string; text: string }, ar: boolean): string {
  const text = e(q.text).replace(/\r?\n/g, "<br/>");
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px"><tr>` +
    `<td style="padding:12px 16px;background:${BRAND.white};border:1px solid ${BRAND.border};border-${ar ? "right" : "left"}:3px solid ${BRAND.cobalt};border-radius:10px;text-align:${ar ? "right" : "left"}">` +
    `<div style="font-size:11px;color:${BRAND.muted};margin:0 0 6px">${e(q.label)}</div>` +
    `<div style="font-size:14px;line-height:1.6;color:${BRAND.body}">${text}</div>` +
    `</td></tr></table>`
  );
}

/** A compact data table for report emails (supplier changes etc.); cells are escaped. */
export function dataTable(headers: string[], rows: string[][], ar = false): { html: string; text: string } {
  const align = ar ? "right" : "left";
  const th = headers
    .map((h) => `<th align="${align}" style="padding:8px 10px;font-size:11px;font-weight:bold;color:${BRAND.muted};border-bottom:1px solid ${BRAND.border};text-align:${align}">${e(h)}</th>`)
    .join("");
  const body = rows
    .map(
      (r) =>
        `<tr>${r
          .map((c) => `<td valign="top" style="padding:8px 10px;font-size:13px;color:${BRAND.ink};border-bottom:1px solid ${BRAND.border};text-align:${align}">${e(c)}</td>`)
          .join("")}</tr>`
    )
    .join("");
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 18px;background:${BRAND.white};border:1px solid ${BRAND.border};border-radius:10px"><tr>${th}</tr>${body}</table>`;
  const text = [headers.join(" | "), ...rows.map((r) => r.join(" | "))].join("\n");
  return { html, text };
}

// ─── the shell ──────────────────────────────────────────────────────────────

export function renderBrandedEmail(doc: BrandEmailDoc): { html: string; text: string } {
  const locale: EmailLocale = doc.locale === "ar" ? "ar" : "en";
  const ar = locale === "ar";
  const c = COPY[locale];
  const dir = ar ? "rtl" : "ltr";
  const align = ar ? "right" : "left";
  const font = ar ? FONT_RTL : FONT_LTR;
  const site = (doc.siteUrl || defaultSiteUrl()).replace(/\/+$/, "");
  const footer = doc.footer ?? {};
  const help = footer.help !== false;
  const buttons = (doc.buttons ?? []).filter((b) => b.url && b.label);
  const facts = (doc.facts ?? []).filter((f) => f.value.trim() !== "");

  // ── plain text (the fallback; carries the URLs the buttons hide)
  const text = [
    c.brandStrip,
    "",
    doc.title,
    "",
    ...(doc.paragraphs ?? []).flatMap((p) => [p, ""]),
    ...(facts.length
      ? [
          ...facts.flatMap((f) => [`${f.label}: ${f.value}`, ...(f.action ? [`${f.action.label}: ${f.action.url}`] : [])]),
          "",
        ]
      : []),
    ...(doc.bodyText ? [doc.bodyText, ""] : []),
    ...(doc.quote ? [`${doc.quote.label}:`, doc.quote.text, ""] : []),
    ...buttons.flatMap((b) => [`${b.label}: ${b.url}`]),
    ...(buttons.length ? [""] : []),
    ...(doc.afterText ? [doc.afterText, ""] : []),
    ...(help ? [`${c.help}: ${COMPANY_WHATSAPP.display} ${COMPANY_WHATSAPP.url}`, ""] : []),
    "--",
    ...(footer.reason ? [footer.reason] : []),
    ...(footer.unsubscribe?.url ? [`${footer.unsubscribe.label}: ${footer.unsubscribe.url}`] : []),
  ].join("\n");

  // ── html
  const paragraphs = (doc.paragraphs ?? [])
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:${BRAND.body}">${e(p)}</p>`)
    .join("");
  const buttonRow = buttons.length
    ? `<div style="margin:6px 0 4px;text-align:${align}">${buttons.map((b) => buttonHtml(b, ar)).join("")}</div>`
    : "";

  const footerLines = [
    help
      ? `<p style="margin:0 0 8px;font-size:12px;color:${BRAND.muted}">${e(c.help)}: <a href="${e(COMPANY_WHATSAPP.url)}" dir="ltr" style="color:${BRAND.cobalt};text-decoration:none;unicode-bidi:embed">&#x2066;${e(COMPANY_WHATSAPP.display)}&#x2069;</a></p>`
      : "",
    footer.reason ? `<p style="margin:0 0 6px;font-size:12px;line-height:1.5;color:${BRAND.muted}">${e(footer.reason)}</p>` : "",
    footer.unsubscribe?.url
      ? `<p style="margin:0 0 6px;font-size:12px"><a href="${e(footer.unsubscribe.url)}" style="color:${BRAND.muted}">${e(footer.unsubscribe.label)}</a></p>`
      : "",
    `<p style="margin:8px 0 0;font-size:11px;color:${BRAND.faint}">${e(c.brandStrip)}</p>`,
  ].join("");

  const html = [
    `<!DOCTYPE html>`,
    `<html lang="${locale}" dir="${dir}"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="color-scheme" content="light"/><title>${e(doc.title)}</title></head>`,
    `<body style="margin:0;padding:0;background:${BRAND.recessed}">`,
    `<div dir="${dir}" lang="${locale}" style="background:${BRAND.recessed};padding:0">`,
    doc.preheader
      ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${BRAND.recessed}">${e(doc.preheader)}</div>`
      : "",
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.recessed}" style="background:${BRAND.recessed}"><tr><td align="center" style="padding:24px 12px">`,
    // card
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-collapse:separate;background:${BRAND.canvas};border:1px solid ${BRAND.border};border-radius:16px;box-shadow:0 10px 28px rgba(163,177,198,0.45),0 -2px 0 ${BRAND.white};font-family:${font};color:${BRAND.ink};text-align:${align}">`,
    // header
    `<tr><td style="padding:20px 28px 16px;border-bottom:1px solid ${BRAND.border}">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>`,
    `<td valign="middle"><a href="${e(site)}" style="text-decoration:none"><img src="${e(site)}/icon.png" width="36" height="36" alt="Gestaltung" style="display:block;border:0;border-radius:8px"/></a></td>`,
    `<td valign="middle" style="padding:0 ${ar ? "12px 0 0" : "0 0 0 12px"};font-family:${FONT_LTR};font-size:18px;font-weight:bold;color:${BRAND.ink};letter-spacing:-0.01em"><a href="${e(site)}" dir="ltr" style="color:${BRAND.ink};text-decoration:none">Gestaltung<span style="color:${BRAND.cobalt}">360</span></a></td>`,
    `</tr></table></td></tr>`,
    // cobalt accent rule
    `<tr><td height="3" style="height:3px;line-height:3px;font-size:0;background:${BRAND.cobalt}">&nbsp;</td></tr>`,
    // body
    `<tr><td style="padding:26px 28px 8px">`,
    `<h1 style="margin:0 0 16px;font-family:${font};font-size:22px;line-height:1.3;font-weight:800;color:${BRAND.ink}">${e(doc.title)}</h1>`,
    paragraphs,
    facts.length ? factsHtml(facts, ar) : "",
    doc.bodyHtml ?? "",
    doc.quote ? quoteHtml(doc.quote, ar) : "",
    buttonRow,
    doc.afterHtml ?? "",
    `</td></tr>`,
    // footer
    `<tr><td style="padding:14px 28px 22px"><div style="border-top:1px solid ${BRAND.border};padding-top:14px">${footerLines}</div></td></tr>`,
    `</table>`,
    `</td></tr></table></div></body></html>`,
  ].join("");

  return { html, text };
}
