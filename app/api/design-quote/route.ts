import { NextResponse } from "next/server";

import { normalizePhone } from "@/lib/phone";
import { formatFileSize } from "@/lib/format-bytes";
import { OWNER_EMAIL, sendEmail } from "@/lib/email";
import { renderLeadEmail } from "@/lib/email/lead-email";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { CAD_BUCKET, QUOTE_BUCKET } from "@/lib/design/constants";

// Public "request a quote" endpoint for the custom-manufacturing flow. The
// homepage dropzone → /design/quote uploads the CAD file straight to Storage,
// then posts the visitor's contact details, chosen method, and the storage
// path here as JSON. Like /api/store-lead it is best-effort: it (1) saves the
// lead to the inquiries table and (2) emails the owner (branded lead alert,
// lib/email/lead-email.ts) with a short-lived signed download link for the
// uploaded file. We succeed if either lands so a missing key never loses a lead.

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
    /** "cad" = the file is on the customer's project (cad-files), else quote-uploads. */
    bucket?: string;
    project_id?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const email = String(body.email ?? "").trim().slice(0, 160) || null;
  const phone = normalizePhone(String(body.phone ?? "")).slice(0, 40);
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

  const bucket = body.bucket === "cad" ? CAD_BUCKET : QUOTE_BUCKET;
  const projectId =
    typeof body.project_id === "string" && /^[0-9a-f-]{36}$/i.test(body.project_id) ? body.project_id : null;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://gestaltung360.com";

  // The id lives in the stored message (the admin card finds the project from
  // it); the card and the email show the project name, never the id.
  let projectName: string | null = null;
  if (projectId) {
    try {
      const svc = createServiceClient();
      if (svc) {
        const { data } = await svc.from("projects").select("name").eq("id", projectId).maybeSingle();
        projectName = (data?.name as string | undefined) ?? null;
      }
    } catch {
      projectName = null;
    }
  }
  const projectLine = projectId ? `Project: ${projectName ?? ""} — ${siteUrl}/${locale}/projects/${projectId}\n` : "";

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
          .from(bucket)
          .createSignedUrl(storagePath, SIGNED_URL_TTL);
        downloadUrl = data?.signedUrl ?? null;
      }
    } catch {
      downloadUrl = null;
    }
  }

  // The stored message is what the admin card (lib/admin/lead-parse.ts) reads.
  // "Storage:" lets the dashboard mint a fresh download link after the 7-day one
  // in the email has expired. Sizes are real KB/MB, never "0.00 MB".
  const sizeLabel = formatFileSize(fileSize);
  const fileLine = fileName
    ? `File: ${fileName}${sizeLabel ? ` (${sizeLabel})` : ""}${
        storagePath
          ? `\nStorage: ${bucket}/${storagePath}${downloadUrl ? `\nDownload (valid 7 days): ${downloadUrl}` : ""}`
          : " — upload failed, awaiting the file from the customer"
      }`
    : "File: none provided";

  const message =
    `Custom manufacturing quote request.\n` +
    `Method: ${methodLabel}\n` +
    `${fileLine}\n` +
    projectLine +
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

  // 2) Email the owner: the branded lead alert with a Download button. The
  // plain-text part carries the same fields with the link spelled out.
  try {
    const mail = renderLeadEmail({
      title: "New quote request",
      name,
      phone,
      email,
      method: methodLabel,
      file: fileName ? { name: fileName, sizeBytes: fileSize || undefined, failed: !storagePath } : null,
      downloadUrl,
      projectName,
      language: locale,
      notes: notes ? { label: "Notes", text: notes } : null,
      siteUrl,
    });
    emailed = await sendEmail({
      to: [OWNER_EMAIL],
      replyTo: email || OWNER_EMAIL,
      subject: `New quote request — ${name} (${methodLabel})`,
      html: mail.html,
      text: mail.text,
    });
  } catch {
    emailed = false;
  }

  if (!saved && !emailed) {
    return NextResponse.json({ error: "not_delivered" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, saved, emailed });
}
