import { NextResponse } from "next/server";

import { normalizePhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

// Single lead/contact endpoint. Every contact touchpoint on the site posts here
// and each is handled as its own "case" (distinct email subject): the homepage
// callback, the /contact form, and the BOM's one quote request for every
// unstocked line (bom_quote: the items, the note and a link to the project,
// whose name is read under the caller's own RLS). It (1) saves the lead to the inquiries
// table (super_admin reads it in the dashboard) and (2) emails the owner at
// info@gestaltung360.com. Both are best-effort — we succeed if either lands, so
// a missing email key never loses a lead. Email goes out via Resend's REST API
// (free tier, no SDK).

const LEAD_EMAIL = process.env.STORE_LEAD_EMAIL || "info@gestaltung360.com";
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM =
  process.env.RESEND_FROM || "Gestaltung <onboarding@resend.dev>";

// Per-case labelling. Add a new case here + post its `source` from the form.
const SOURCES: Record<
  string,
  { label: string; subject: (name: string, ctx: { count: number }) => string; fallbackMessage: string }
> = {
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
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ITEMS = 60;

// contact_form only: /contact?kind=school (from /students) tags the lead. The message
// (saved and emailed) starts with this tag, so no column is needed.
const SCHOOL_TAG = "School / class project";

type QuoteItem = { function: string; spec: string; quantity: number };

/** The BOM lines of a bom_quote, trimmed and capped; anything malformed is dropped. */
function quoteItems(raw: unknown): QuoteItem[] {
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

export async function POST(request: Request) {
  let body: {
    name?: string;
    phone?: string;
    email?: string;
    message?: string;
    locale?: string;
    source?: string;
    // contact_form only: "school" from /contact?kind=school.
    kind?: string;
    // bom_quote only.
    items?: unknown;
    note?: string;
    projectId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim().slice(0, 120);
  const phone = normalizePhone(String(body.phone ?? "")).slice(0, 40);
  const email = String(body.email ?? "").trim().slice(0, 160) || null;
  const locale = body.locale === "ar" ? "ar" : "en";
  const src = SOURCES[body.source ?? ""] ?? SOURCES.store_callback;
  const isQuote = body.source === "bom_quote";
  const items = isQuote ? quoteItems(body.items) : [];
  const isSchool = body.source === "contact_form" && body.kind === "school";

  if (!name || !phone || (isQuote && !items.length)) {
    return NextResponse.json({ error: "missing_fields" }, { status: 422 });
  }

  let message = String(body.message ?? "").trim().slice(0, 4000) || src.fallbackMessage;
  if (isSchool && !message.toLowerCase().startsWith(SCHOOL_TAG.toLowerCase())) {
    message = `${SCHOOL_TAG}: ${message}`.slice(0, 4000);
  }
  if (isQuote) {
    // The project link, and its name as the caller's own RLS lets them read
    // it (never taken from the request). A failed read keeps the link only.
    const projectId = typeof body.projectId === "string" && UUID.test(body.projectId) ? body.projectId : null;
    let projectName: string | null = null;
    if (projectId) {
      try {
        const supabase = await createClient();
        const { data, error } = await supabase.from("projects").select("name").eq("id", projectId).maybeSingle();
        if (error) console.error("store-lead: project name lookup failed", error);
        projectName = (data?.name as string | undefined) ?? null;
      } catch (err) {
        console.error("store-lead: project name lookup failed", err);
      }
    }
    const link = projectId ? `${new URL(request.url).origin}/${locale}/projects/${projectId}` : null;
    const note = String(body.note ?? "").trim().slice(0, 1000);
    message = [
      `Quote request for ${items.length} unstocked item${items.length === 1 ? "" : "s"}.`,
      projectId ? `Project: ${projectName ?? "(name not readable)"} — ${link}` : null,
      items.map((i) => `- ${i.function}${i.spec ? ` — ${i.spec}` : ""} × ${i.quantity}`).join("\n"),
      note ? `Note:\n${note}` : null,
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 4000);
  }

  let saved = false;
  let emailed = false;

  // 1) Save to the inquiries table (anon INSERT is allowed by RLS).
  if (
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    try {
      const supabase = await createClient();
      const { error } = await supabase
        .from("inquiries")
        .insert({ name, phone, email, message, locale, status: "new" });
      saved = !error;
    } catch {
      saved = false;
    }
  }

  // 2) Email the owner (skipped gracefully if the key isn't configured yet).
  if (RESEND_API_KEY) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: RESEND_FROM,
          to: [LEAD_EMAIL],
          reply_to: email || LEAD_EMAIL,
          subject: src.subject(name, { count: items.length }) + (isSchool ? " (school / class project)" : ""),
          text:
            `New ${src.label.toLowerCase()} from the Gestaltung website.\n\n` +
            `Name: ${name}\n` +
            `Phone / WhatsApp: ${phone}\n` +
            `Email: ${email ?? "—"}\n` +
            `Language: ${locale}\n\n` +
            `Message:\n${message}\n`,
        }),
      });
      emailed = res.ok;
    } catch {
      emailed = false;
    }
  }

  if (!saved && !emailed) {
    return NextResponse.json({ error: "not_delivered" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, saved, emailed });
}
