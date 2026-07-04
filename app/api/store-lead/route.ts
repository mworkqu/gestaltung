import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

// Store-landing callback lead. Saves the visitor's name + number to the
// inquiries table (super_admin reads it in the dashboard) AND emails the owner
// at info@gestaltung360.com. Both are best-effort: we succeed if either lands,
// so a missing email key never blocks lead capture. No third-party SDK — the
// email goes out via Resend's REST API (free tier, no credit card).

const LEAD_EMAIL = process.env.STORE_LEAD_EMAIL || "info@gestaltung360.com";
const RESEND_API_KEY = process.env.RESEND_API_KEY;
// Resend's shared sender works without verifying a custom domain.
const RESEND_FROM = process.env.RESEND_FROM || "Gestaltung Store <onboarding@resend.dev>";

export async function POST(request: Request) {
  let body: { name?: string; phone?: string; locale?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim().slice(0, 120);
  const phone = String(body.phone ?? "").trim().slice(0, 40);
  const locale = body.locale === "ar" ? "ar" : "en";

  if (!name || !phone) {
    return NextResponse.json({ error: "missing_fields" }, { status: 422 });
  }

  const message = "Store landing — requested a callback.";
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
        .insert({ name, phone, message, locale, status: "new" });
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
          reply_to: LEAD_EMAIL,
          subject: `New store callback request — ${name}`,
          text:
            `A visitor asked to be contacted from the Gestaltung store.\n\n` +
            `Name: ${name}\n` +
            `Phone / WhatsApp: ${phone}\n` +
            `Language: ${locale}\n`,
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
