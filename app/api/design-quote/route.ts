import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { QUOTE_BUCKET } from "@/lib/design/constants";

// Public "request a quote" endpoint for the custom-manufacturing flow. The
// homepage dropzone → /design/quote uploads the CAD file straight to Storage,
// then posts the visitor's contact details, chosen method, and the storage
// path here as JSON. Like /api/store-lead it is best-effort: it (1) saves the
// lead to the inquiries table and (2) emails the owner via Resend, including a
// short-lived signed download link for the uploaded file. We succeed if either
// lands so a missing key never loses a lead.

const LEAD_EMAIL = process.env.STORE_LEAD_EMAIL || "info@gestaltung360.com";
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM =
  process.env.RESEND_FROM || "Gestaltung <onboarding@resend.dev>";

const SIGNED_URL_TTL = 60 * 60 * 24 * 7; // 7 days

const TECHNIQUE_LABELS: Record<string, string> = {
  "3d_printing": "3D printing",
  cnc_machining: "CNC machining",
  laser_cutting: "Laser cutting",
  edm: "EDM",
  not_sure: "Not sure — needs a recommendation",
};

export async function POST(request: Request) {
  let body: {
    email?: string;
    phone?: string;
    name?: string;
    technique?: string;
    message?: string;
    locale?: string;
    file_name?: string;
    file_size?: number;
    storage_path?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const email = String(body.email ?? "").trim().slice(0, 160) || null;
  const phone = String(body.phone ?? "").trim().slice(0, 40);
  const name = String(body.name ?? "").trim().slice(0, 120) || "Website visitor";
  const technique = String(body.technique ?? "").trim().slice(0, 40);
  const notes = String(body.message ?? "").trim().slice(0, 4000);
  const locale = body.locale === "ar" ? "ar" : "en";
  const fileName = String(body.file_name ?? "").trim().slice(0, 200);
  const fileSize = Number(body.file_size) || 0;
  const storagePath =
    typeof body.storage_path === "string" && body.storage_path.trim()
      ? body.storage_path.trim().slice(0, 400)
      : null;

  if (!email && !phone) {
    return NextResponse.json({ error: "missing_contact" }, { status: 422 });
  }
  if (!technique) {
    return NextResponse.json({ error: "missing_technique" }, { status: 422 });
  }

  const methodLabel = TECHNIQUE_LABELS[technique] ?? technique;

  // Mint a short-lived signed download link for the uploaded file (service role
  // needed because the bucket is private and the requester is anonymous).
  let downloadUrl: string | null = null;
  if (storagePath) {
    try {
      const svc = createServiceClient();
      if (svc) {
        const { data } = await svc.storage
          .from(QUOTE_BUCKET)
          .createSignedUrl(storagePath, SIGNED_URL_TTL);
        downloadUrl = data?.signedUrl ?? null;
      }
    } catch {
      downloadUrl = null;
    }
  }

  const fileLine = fileName
    ? `File: ${fileName}${fileSize ? ` (${(fileSize / 1024 / 1024).toFixed(2)} MB)` : ""}${
        storagePath
          ? downloadUrl
            ? `\nDownload (valid 7 days): ${downloadUrl}`
            : `\nStored at: ${storagePath}`
          : " — upload failed, awaiting the file from the customer"
      }`
    : "File: none provided";

  const message =
    `Custom manufacturing quote request.\n` +
    `Method: ${methodLabel}\n` +
    `${fileLine}\n` +
    `Email: ${email ?? "—"}\n` +
    `Phone / WhatsApp: ${phone || "—"}\n` +
    (notes ? `\nNotes:\n${notes}\n` : "");

  let saved = false;
  let emailed = false;

  // 1) Save to inquiries (anon INSERT allowed by RLS). phone is NOT NULL, so we
  // store an empty string when only an email was given.
  if (
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.from("inquiries").insert({
        name,
        phone: phone || "",
        email,
        message,
        locale,
        status: "new",
      });
      saved = !error;
    } catch {
      saved = false;
    }
  }

  // 2) Email the owner with the details + signed download link.
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
          subject: `New quote request — ${name} (${methodLabel})`,
          text:
            `New custom-manufacturing quote request from the Gestaltung website.\n\n` +
            `Name: ${name}\n` +
            `Email: ${email ?? "—"}\n` +
            `Phone / WhatsApp: ${phone || "—"}\n` +
            `Method: ${methodLabel}\n` +
            `${fileLine}\n` +
            `Language: ${locale}\n` +
            (notes ? `\nNotes:\n${notes}\n` : ""),
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
