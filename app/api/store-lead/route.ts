import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

// Single lead/contact endpoint. Every contact touchpoint on the site posts here
// and each is handled as its own "case" (distinct email subject): the homepage
// callback and the /contact form today. It (1) saves the lead to the inquiries
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
  { label: string; subject: (name: string) => string; fallbackMessage: string }
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
};

export async function POST(request: Request) {
  let body: {
    name?: string;
    phone?: string;
    email?: string;
    message?: string;
    locale?: string;
    source?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim().slice(0, 120);
  const phone = String(body.phone ?? "").trim().slice(0, 40);
  const email = String(body.email ?? "").trim().slice(0, 160) || null;
  const locale = body.locale === "ar" ? "ar" : "en";
  const src = SOURCES[body.source ?? ""] ?? SOURCES.store_callback;
  const message =
    String(body.message ?? "").trim().slice(0, 4000) || src.fallbackMessage;

  if (!name || !phone) {
    return NextResponse.json({ error: "missing_fields" }, { status: 422 });
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
          subject: src.subject(name),
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
