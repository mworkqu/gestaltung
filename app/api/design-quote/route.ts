import { NextResponse } from "next/server";

import { isValidPhone, normalizePhone } from "@/lib/phone";
import { formatFileSize } from "@/lib/format-bytes";
import { OWNER_EMAIL, sendEmail } from "@/lib/email";
import { renderLeadEmail } from "@/lib/email/lead-email";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { CAD_BUCKET, QUOTE_BUCKET } from "@/lib/design/constants";
import { isAllowedQuoteStoragePath } from "@/lib/design/quote-paths";
import { clientIp, createRateLimiter } from "@/lib/rate-limit";
import { readTurnstileToken } from "@/lib/turnstile";
import { checkTurnstile, turnstileEnforced } from "@/lib/turnstile-server";
import { asLocale } from "@/lib/locale";
import { quoteReference } from "@/lib/design/quote-reference";
import { quoteReceivedEmail } from "@/lib/email/quote-received-email";

// Public "request a quote" endpoint for the custom-manufacturing flow. The
// homepage dropzone → /design/quote uploads the CAD file straight to Storage,
// then posts the visitor's contact details, chosen method, and the storage
// path here as JSON. Like /api/store-lead it is best-effort: it (1) saves the
// lead to the inquiries table and (2) emails the owner (branded lead alert,
// lib/email/lead-email.ts) with a short-lived signed download link for the
// uploaded file. We succeed if either lands so a missing key never loses a lead.

const SIGNED_URL_TTL = 60 * 60 * 24 * 7; // 7 days

// Per-IP brake (API-03): 10 quote requests per 10 minutes per server instance.
const rate = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 });

const TECHNIQUE_LABELS: Record<string, string> = {
  "3d_printing": "3D printing",
  cnc_machining: "CNC machining",
  laser_cutting: "Laser cutting",
  edm: "EDM",
  not_sure: "Not sure — needs a recommendation",
};

type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * Cloudflare Turnstile (P2-08). Switch off or a key missing → always allowed
 * (today's behaviour). Switch on → the x-turnstile-token header or the body's
 * turnstileToken must pass, unless the caller is a signed-in, non-anonymous
 * account (sign-up is itself behind the CAPTCHA; the form shows no widget to
 * them). A guest session does not skip it.
 */
async function captchaPassed(
  request: Request,
  supabase: Db | null,
  body: Record<string, unknown>,
): Promise<boolean> {
  if (!(await turnstileEnforced())) return true;
  try {
    const user = supabase ? (await supabase.auth.getUser()).data.user : null;
    if (user && !user.is_anonymous) return true;
  } catch {
    // No usable session: fall through to the token check.
  }
  const token = readTurnstileToken(request.headers) ?? readTurnstileToken(body);
  return (await checkTurnstile(request, token)).ok;
}

export async function POST(request: Request) {
  const limit = rate.hit(clientIp(request.headers));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

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
    /** Cloudflare Turnstile token (or send it in the x-turnstile-token header). */
    turnstileToken?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  // The caller's own cookie client: RLS applies to everything read with it.
  // Null without Supabase env (the lead is then only emailed).
  let supabase: Db | null = null;
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    try {
      supabase = await createClient();
    } catch {
      supabase = null;
    }
  }
  if (!(await captchaPassed(request, supabase, body as Record<string, unknown>))) {
    return NextResponse.json({ error: "captcha_failed" }, { status: 403 });
  }

  const email = String(body.email ?? "").trim().slice(0, 160) || null;
  const phone = normalizePhone(String(body.phone ?? "")).slice(0, 40);
  const name = String(body.name ?? "").trim().slice(0, 120) || "Website visitor";
  const technique = String(body.technique ?? "").trim().slice(0, 40);
  const notes = String(body.message ?? "").trim().slice(0, 4000);
  const locale = asLocale(body.locale);
  const fileName = String(body.file_name ?? "").trim().slice(0, 200);
  const fileSize = Number(body.file_size) || 0;
  const bucket = body.bucket === "cad" ? CAD_BUCKET : QUOTE_BUCKET;
  const rawPath =
    typeof body.storage_path === "string" && body.storage_path.trim() ? body.storage_path.trim() : null;

  // API-04: the service role signs this path, so it must be a path our uploader
  // wrote (for cad-files: the caller's own folder). Anything else is dropped as
  // if the upload had failed: the lead is still saved, no link is minted.
  let storagePath: string | null = null;
  if (rawPath) {
    let userId: string | null = null;
    if (bucket === CAD_BUCKET && supabase) {
      try {
        userId = (await supabase.auth.getUser()).data.user?.id ?? null;
      } catch {
        userId = null;
      }
    }
    if (isAllowedQuoteStoragePath(bucket, rawPath, userId)) storagePath = rawPath;
    else console.warn("[design-quote] storage_path rejected for bucket", bucket);
  }
  const projectId =
    typeof body.project_id === "string" && /^[0-9a-f-]{36}$/i.test(body.project_id) ? body.project_id : null;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://gestaltung360.com";

  // The id lives in the stored message (the admin card finds the project from
  // it); the card and the email show the project name, never the id.
  let projectName: string | null = null;
  if (projectId && supabase) {
    try {
      // The caller's RLS client (API-04): only a project they can read has a name.
      const { data } = await supabase.from("projects").select("name").eq("id", projectId).maybeSingle();
      projectName = (data?.name as string | undefined) ?? null;
    } catch {
      projectName = null;
    }
  }
  const projectLine = projectId ? `Project: ${projectName ?? ""} — ${siteUrl}/${locale}/projects/${projectId}\n` : "";

  if (!email && !phone) {
    return NextResponse.json({ error: "missing_contact" }, { status: 422 });
  }
  // W2: a typed phone must be one we can reach on WhatsApp (same rule as the form).
  if (phone && !isValidPhone(phone)) {
    return NextResponse.json({ error: "invalid_phone" }, { status: 422 });
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

  // F-021: the row id is chosen here (the anonymous requester cannot read the row
  // back) and the reference is derived from it, so no new column is needed.
  const inquiryId = crypto.randomUUID();
  const reference = quoteReference(inquiryId) ?? inquiryId.slice(0, 8).toUpperCase();

  const message =
    `Custom manufacturing quote request.\n` +
    `Reference: ${reference}\n` +
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
  if (supabase) {
    try {
      const { error } = await supabase.from("inquiries").insert({
        id: inquiryId,
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
      subject: `New quote request ${reference} — ${name} (${methodLabel})`,
      html: mail.html,
      text: mail.text,
    });
  } catch {
    emailed = false;
  }

  if (!saved && !emailed) {
    return NextResponse.json({ error: "not_delivered" }, { status: 500 });
  }

  // 3) The customer's own confirmation, only when they gave an email.
  if (email) {
    try {
      const mail = quoteReceivedEmail({ locale, reference, fileName, fileUploaded: Boolean(storagePath), siteUrl });
      await sendEmail({ to: [email], replyTo: OWNER_EMAIL, subject: mail.subject, html: mail.html, text: mail.text });
    } catch {
      // Best effort: the on-screen confirmation already carries the reference.
    }
  }
  return NextResponse.json({ ok: true, saved, emailed, reference, file_name: fileName });
}
