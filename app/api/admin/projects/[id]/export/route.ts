import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buildProjectExport } from "@/lib/admin/project-export";

// GET /api/admin/projects/<id>/export — the owner-only diagnostic JSON.
// super_admin only: checked here against the caller's profile, and every read
// goes through RLS as that super_admin. ?download=1 sends it as a file.
//
// Local test hook, never in production: EXPORT_DEV_OWNER=1 also lets a
// project's own owner export it, so the export can be tried without an admin
// account. RLS still applies, so admin-only sections (AI usage) come back
// empty for them, and `_notes` says so.

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response(null, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response(null, { status: 401 });

  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  let exportedBy = "super_admin";
  if (me?.role !== "super_admin") {
    const devOwner = process.env.NODE_ENV !== "production" && process.env.EXPORT_DEV_OWNER === "1";
    if (!devOwner) return new Response(null, { status: 403 });
    const { data: own } = await supabase.from("projects").select("user_id").eq("id", id).maybeSingle();
    if (own?.user_id !== user.id) return new Response(null, { status: 403 });
    exportedBy = "project owner (EXPORT_DEV_OWNER dev hook)";
  }

  const data = await buildProjectExport(supabase, id, { service: createServiceClient(), exportedBy });
  if (!data) return new Response(null, { status: 404 });
  if (exportedBy !== "super_admin")
    (data._notes as string[]).push("exported by the project owner through the local dev hook: admin-only sections (AI usage) are hidden by RLS");

  const download = new URL(request.url).searchParams.get("download") === "1";
  const name = String((data.project as { name?: string }).name ?? "project")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(download
        ? { "content-disposition": `attachment; filename="project-${encodeURIComponent(name)}-${id.slice(0, 8)}.json"` }
        : {}),
    },
  });
}
