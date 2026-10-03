import { NextResponse } from "next/server";

import { sendEmail } from "@/lib/email";
import { projectLinkEmail } from "@/lib/projects/link-email";
import { isUuid, projectLinkUrl, siteUrlFor } from "@/lib/projects/recovery";
import { createClient } from "@/lib/supabase/server";

// D6: open an emailed project link (/{locale}/projects/{id}#key={key}) in
// another browser. The page makes sure there is a session (a guest gets an
// anonymous one) and posts the key here. claim_project (0045) moves the
// project to the caller only when the key matches AND the current owner is a
// guest (anonymous) — a signed-up owner never loses a project to a link. The
// key is then rotated and the new link is emailed to the project's address,
// so the newest email always works and the owner hears about every move.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    projectId?: unknown;
    key?: unknown;
    locale?: unknown;
  } | null;
  const projectId = isUuid(body?.projectId) ? (body?.projectId as string) : null;
  const key = isUuid(body?.key) ? (body?.key as string) : null;
  const locale = body?.locale === "ar" ? "ar" : "en";
  if (!projectId || !key) return NextResponse.json({ ok: false, reason: "invalid" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, reason: "not_signed_in" }, { status: 401 });

  const { data, error } = await supabase.rpc("claim_project", { p_project: projectId, p_token: key });
  if (error) {
    const missing = error.code === "PGRST202" || error.code === "42883";
    if (!missing) console.error("[claim] claim_project failed", error);
    return NextResponse.json({ ok: false, reason: missing ? "not_ready" : "error" });
  }

  const res = (data ?? {}) as {
    ok?: boolean;
    status?: string;
    reason?: string;
    token?: string;
    name?: string;
    email?: string | null;
  };
  if (!res.ok) return NextResponse.json({ ok: false, reason: res.reason ?? "invalid" });

  let emailed = false;
  if (res.status === "claimed" && res.email && isUuid(res.token)) {
    const url = projectLinkUrl(siteUrlFor(request.url), locale, projectId, res.token);
    emailed = await sendEmail({ to: [res.email], ...projectLinkEmail({ locale, projectName: res.name ?? "", url, kind: "moved" }) });
    if (!emailed) console.error("[claim] new-link email not sent (RESEND_API_KEY missing or Resend error)");
  }
  return NextResponse.json({ ok: true, status: res.status ?? "claimed", emailed });
}
