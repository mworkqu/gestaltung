// Body parsing and validation for /api/store-lead. Pure: no I/O, so every limit
// and error code is unit-tested. Coercion is deliberately lenient (a number in a
// text field is stringified, never rejected) because that is what the route has
// always done; only the checks below can refuse a lead.

import { z } from "zod";

import { CAD_BUCKET } from "@/lib/design/constants";
import { asLocale, type Locale } from "@/lib/locale";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { UUID_RE } from "@/lib/uuid";

import { CONTACT_KINDS, sourceFor, type ContactKind, type LeadSourceDef } from "./sources";

export const MAX_ITEMS = 60;
export const MAX_FILES = 40;
/** cad-files/<user>/<project>/print/<stamp>/<file>.stl — the visitor's own folder (0018 insert policy). */
export const PRINT_PATH = /^cad-files\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/print\/[\w-]{1,40}\/[\w.-]{1,80}\.stl$/i;

export type QuoteItem = { function: string; spec: string; quantity: number };

/** A validated lead, ready for createLead. Fields not yet resolved against the database stay raw. */
export type ParsedLead = {
  src: LeadSourceDef;
  isQuote: boolean;
  isStudio: boolean;
  isPrint: boolean;
  name: string;
  phone: string;
  email: string | null;
  locale: Locale;
  contactKind: ContactKind | null;
  items: QuoteItem[];
  /** The visitor's message, or the source's fallback; contact_form tags already prefixed. */
  message: string;
  /** A UUID or null (never a free string). */
  projectId: string | null;
  /** Whitespace-collapsed, capped at 80; empty when absent (createLead falls back to the project name). */
  designName: string;
  /** The visitor's optional note, capped at 1000. */
  note: string;
  /** Posted total grams (0 when absent or not a number). */
  totalGrams: number;
  /** The raw `files` value; only createLead checks it against the caller's own folder. */
  files: unknown;
};

export type LeadParseError = { code: "bad_request" | "missing_fields" | "invalid_phone"; status: 400 | 422 };
export type LeadParseResult = { ok: true; lead: ParsedLead } | ({ ok: false } & LeadParseError);

/** Any value (or none) in, `fn` of it out: coercion, never rejection. */
const loose = <T>(fn: (v: unknown) => T) => z.unknown().optional().transform(fn);
/** `String(v ?? "").trim().slice(0, max)` as a schema. */
const text = (max: number) => loose((v) => String(v ?? "").trim().slice(0, max));

const bodySchema = z.object({
  name: text(120),
  phone: loose((v) => normalizePhone(String(v ?? "")).slice(0, 40)),
  email: text(160).transform((v) => v || null),
  message: text(4000),
  note: text(1000),
  designName: loose((v) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 80)),
  totalGrams: loose((v) => Number(v) || 0),
  projectId: loose((v) => (typeof v === "string" && UUID_RE.test(v) ? v : null)),
});

/** The BOM lines of a bom_quote / studio_quote / print_request, trimmed and capped; anything malformed is dropped. */
export function quoteItems(raw: unknown): QuoteItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_ITEMS)
    .map((x): QuoteItem | null => {
      const o = (x ?? {}) as Record<string, unknown>;
      const fn = String(o.function ?? "").trim().slice(0, 120);
      const qty = Number(o.quantity);
      if (!fn) return null;
      return {
        function: fn,
        spec: String(o.spec ?? "").trim().slice(0, 200),
        quantity: Number.isFinite(qty) && qty >= 1 ? Math.min(Math.trunc(qty), 100000) : 1,
      };
    })
    .filter((x): x is QuoteItem => x !== null);
}

/** The STL paths of a print request that belong to this user and project; anything else is dropped. */
export function printFiles(raw: unknown, userId: string | null, projectId: string | null): string[] {
  if (!Array.isArray(raw) || !userId || !projectId) return [];
  const out: string[] = [];
  for (const v of raw.slice(0, MAX_FILES)) {
    if (typeof v !== "string") continue;
    const m = v.match(PRINT_PATH);
    if (m && m[1].toLowerCase() === userId.toLowerCase() && m[2].toLowerCase() === projectId.toLowerCase() && v.startsWith(`${CAD_BUCKET}/`))
      out.push(v);
  }
  return [...new Set(out)];
}

/** Validate a decoded JSON body. Refusals: bad_request 400, missing_fields 422, invalid_phone 422. */
export function parseLead(raw: unknown): LeadParseResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, code: "bad_request", status: 400 };
  }
  const body = raw as Record<string, unknown>;
  const fields = bodySchema.parse(body);

  const source = typeof body.source === "string" ? body.source : "";
  const isStudio = source === "studio_quote";
  const isPrint = source === "print_request";
  const isQuote = source === "bom_quote";
  const withItems = isQuote || isStudio || isPrint;

  const name = fields.name || (isStudio || isPrint ? "Design Studio visitor" : "");
  const src = sourceFor(source);
  const items = withItems ? quoteItems(body.items) : [];
  const contactKind =
    source === "contact_form" && typeof body.kind === "string" && Object.hasOwn(CONTACT_KINDS, body.kind)
      ? CONTACT_KINDS[body.kind]
      : null;

  if (!name || !fields.phone || (withItems && !items.length)) {
    return { ok: false, code: "missing_fields", status: 422 };
  }
  // W2: the same rule every form checks before sending (lib/phone.ts) — a
  // number we can reach on WhatsApp, never "00000000" or "12345678".
  if (!isValidPhone(fields.phone)) {
    return { ok: false, code: "invalid_phone", status: 422 };
  }

  let message = fields.message || src.fallbackMessage;
  if (contactKind && !message.toLowerCase().startsWith(contactKind.tag.toLowerCase())) {
    message = `${contactKind.tag}: ${message}`.slice(0, 4000);
  }

  return {
    ok: true,
    lead: {
      src,
      isQuote,
      isStudio,
      isPrint,
      name,
      phone: fields.phone,
      email: fields.email,
      locale: asLocale(body.locale),
      contactKind,
      items,
      message,
      projectId: fields.projectId,
      designName: fields.designName,
      note: fields.note,
      totalGrams: fields.totalGrams,
      files: body.files,
    },
  };
}
