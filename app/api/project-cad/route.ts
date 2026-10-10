import { NextResponse } from "next/server";

import { formatFileSize } from "@/lib/format-bytes";
import { OWNER_EMAIL, sendEmail } from "@/lib/email";
import { renderLeadEmail } from "@/lib/email/lead-email";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { CAD_BUCKET } from "@/lib/design/constants";

// Notifies the owner that a CAD file has been attached to a project, so it can
// be quoted by hand. There is no method detection and no workshop dispatch —
// that pipeline is retired. The file itself is already in the private
// cad-files bucket under <user_id>/<project_id>/; this records the lead in
// `inquiries` and emails a signed download link.
//
// Best-effort, like /api/store-lead and /api/design-quote: it reports success
// if EITHER the row saved or the email sent, so a missing key never loses a
// request.

const SIGNED_URL_TTL = 60 * 60 * 24 * 7; // 7 days

export async function POST(request: Request) {
  let body: {
    project_id?: string;
    storage_path?: string;
    file_name?: string;
    file_size?: number;
    locale?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const projectId = String(body.project_id ?? "").trim();
  const storagePath = String(body.storage_path ?? "").trim().slice(0, 400);
  const fileName = String(body.file_name ?? "").trim().slice(0, 200);
  const fileSize = Number(body.file_size) || 0;
  const locale = body.locale === "ar" ? "ar" : "en";

  if (!projectId || !storagePath || !fileName) {
    return NextResponse.json({ error: "missing_fields" }, { status: 422 });
  }

  // Identify the requester through the RLS client. Reading the project back
  // also proves they own it — RLS returns nothing otherwise — so a forged
  // project_id cannot be used to generate a notification.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // The path must sit under this user's own folder.
  if (!storagePath.startsWith(`${user.id}/`)) {
    return NextResponse.json({ error: "forbidden_path" }, { status: 403 });
  }

  let downloadUrl: string | null = null;
  try {
    const svc = createServiceClient();
    if (svc) {
      const { data } = await svc.storage
        .from(CAD_BUCKET)
        .createSignedUrl(storagePath, SIGNED_URL_TTL);
      downloadUrl = data?.signedUrl ?? null;
    }
  } catch {
    downloadUrl = null;
  }

  const isGuest = user.is_anonymous === true;
  const sizeLabel = formatFileSize(fileSize);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://gestaltung360.com";

  // Stored message (read by lib/admin/lead-parse.ts): the project is a link so
  // the dashboard can find it; Storage lets it mint a fresh download link.
  const message =
    `CAD file attached to a project — quote by hand.\n` +
    `Project: ${project.name} — ${siteUrl}/${locale}/projects/${project.id}\n` +
    `File: ${fileName}${sizeLabel ? ` (${sizeLabel})` : ""}\n` +
    `Storage: ${CAD_BUCKET}/${storagePath}\n` +
    (downloadUrl ? `Download (valid 7 days): ${downloadUrl}\n` : "") +
    `Customer: ${user.email ?? (isGuest ? "guest — no account yet" : "—")}\n`;

  let saved = false;
  let emailed = false;

  try {
    const { error } = await supabase.from("inquiries").insert({
      name: user.email ?? "Project owner",
      phone: "",
      email: user.email ?? null,
      message,
      locale,
      status: "new",
    });
    saved = !error;
  } catch {
    saved = false;
  }

  try {
    const mail = renderLeadEmail({
      title: "CAD file added to a project",
      name: user.email ?? "Project owner",
      email: user.email ?? null,
      file: { name: fileName, sizeBytes: fileSize || undefined },
      downloadUrl,
      projectName: project.name as string,
      language: locale,
      siteUrl,
    });
    emailed = await sendEmail({
      to: [OWNER_EMAIL],
      subject: `CAD file on project "${project.name}"`,
      html: mail.html,
      text: mail.text,
    });
  } catch {
    emailed = false;
  }

  if (!saved && !emailed) {
    return NextResponse.json({ error: "not_delivered" }, { status: 502 });
  }

  return NextResponse.json({ ok: true, saved, emailed });
}
