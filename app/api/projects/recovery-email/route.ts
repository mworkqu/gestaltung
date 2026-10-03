import { NextResponse } from "next/server";

import { sendEmail } from "@/lib/email";
import { projectLinkEmail } from "@/lib/projects/link-email";
import { isUuid, projectLinkUrl, siteUrlFor } from "@/lib/projects/recovery";
import { isPlausibleEmail } from "@/lib/store/shipping";
import { createClient } from "@/lib/supabase/server";

// D6: the optional email on /projects/new. Called once, right after the
// project is created, by the session that created it. project_recovery_begin
// (0045) checks the caller owns the project, that it is < 1 h old, that it was
// never emailed, and caps a session at 3 project emails a day; it returns the
// secret key that goes into the link. Before 0045 runs this answers
// { sent: false, reason: "not_ready" } and the form carries on.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    projectId?: unknown;
    email?: unknown;
    locale?: unknown;
  } | null;
  const projectId = isUuid(body?.projectId) ? (body?.projectId as string) : null;
  const email = typeof body?.email === "string" ? body.email.trim().slice(0, 254) : "";
  const locale = body?.locale === "ar" ? "ar" : "en";
  if (!projectId || !isPlausibleEmail(email)) {
    return NextResponse.json({ sent: false, reason: "bad_request" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ sent: false, reason: "not_signed_in" }, { status: 401 });

  const { data, error } = await supabase.rpc("project_recovery_begin", { p_project: projectId, p_email: email });
  if (error) {
    const missing = error.code === "PGRST202" || error.code === "42883";
    if (!missing) console.error("[recovery-email] project_recovery_begin failed", error);
    return NextResponse.json({ sent: false, reason: missing ? "not_ready" : "error" });
  }
  const res = (data ?? {}) as { ok?: boolean; reason?: string; token?: string; name?: string; email?: string };
  if (!res.ok || !isUuid(res.token) || !res.email) {
    return NextResponse.json({ sent: false, reason: res.reason ?? "refused" });
  }

  const url = projectLinkUrl(siteUrlFor(request.url), locale, projectId, res.token);
  const mail = projectLinkEmail({ locale, projectName: res.name ?? "", url, kind: "created" });
  const sent = await sendEmail({ to: [res.email], ...mail });
  if (!sent) console.error("[recovery-email] send failed (RESEND_API_KEY missing or Resend error)");
  return NextResponse.json({ sent });
}
