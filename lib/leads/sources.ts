// Per-case labelling for the single lead endpoint (/api/store-lead). Every
// contact touchpoint on the site posts a `source`; each one is its own "case"
// with a distinct email subject. Add a new case here and post its `source`
// from the form.

export type LeadSourceDef = {
  label: string;
  subject: (name: string, ctx: { count: number }) => string;
  fallbackMessage: string;
};

export const SOURCES: Record<string, LeadSourceDef> = {
  contact_form: {
    label: "Contact form",
    subject: (n) => `New contact message — ${n}`,
    fallbackMessage: "Contact form submission.",
  },
  store_callback: {
    label: "Store callback",
    subject: (n) => `New store callback request — ${n}`,
    fallbackMessage: "Store landing — requested a callback.",
  },
  bom_quote: {
    label: "BOM quote request",
    subject: (n, { count }) => `Quote request — ${n} · ${count} unstocked item${count === 1 ? "" : "s"}`,
    fallbackMessage: "Bill of materials — quote request.",
  },
  drawing_request: {
    label: "Drawing request",
    subject: (n) => `New drawing request — ${n}`,
    fallbackMessage: "Help me draw it — new drawing project.",
  },
  // Design Studio "Get it made" (P5-13): the design name, the project link and
  // the part names. The visitor may have no name on file: a neutral one is used.
  studio_quote: {
    label: "Design Studio request",
    subject: (n) => `Design Studio — get it made — ${n}`,
    fallbackMessage: "Design Studio — get it made.",
  },
  // Design Studio "Request printing" (P5-14): the printable parts of the design,
  // their material and grams, and the STLs the visitor uploaded to their own
  // folder of the private cad-files bucket. Quantity is always 1.
  print_request: {
    label: "Print request",
    subject: (n, { count }) => `Print request — ${n} · ${count} part${count === 1 ? "" : "s"}`,
    fallbackMessage: "Design Studio — print request.",
  },
};

/** The source a body names; an unknown or missing one is treated as the homepage callback. */
export function sourceFor(key: unknown): LeadSourceDef {
  return typeof key === "string" && Object.hasOwn(SOURCES, key) ? SOURCES[key] : SOURCES.store_callback;
}

// contact_form only: /contact?kind=school (from /students) or ?kind=institution (from
// /pricing) tags the lead. The message (saved and emailed) starts with the tag and the
// email subject gets the suffix, so no column is needed.
export type ContactKind = { tag: string; subject: string };

export const CONTACT_KINDS: Record<string, ContactKind> = {
  school: { tag: "School / class project", subject: " (school / class project)" },
  institution: { tag: "Institution / team plan", subject: " (institution / team plan)" },
  partner: { tag: "Partnership", subject: " (partnership)" },
  // 3g: a teacher asking for an invoice for their class parts order. Sent by
  // the class page's "Request an invoice" action, never by the public form.
  school_invoice: { tag: "School invoice request", subject: " (school invoice request)" },
};
