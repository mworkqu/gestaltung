import { exportHandler } from "@/lib/admin/export-route";
import { buildProjectExport } from "@/lib/admin/project-export";

// GET /api/admin/projects/<id>/export — the owner-only diagnostic JSON.
// super_admin only: checked against the caller's profile, and every read
// goes through RLS as that super_admin. ?download=1 sends it as a file.
//
// Local test hook, never in production: EXPORT_DEV_OWNER=1 also lets a
// project's own owner export it, so the export can be tried without an admin
// account. RLS still applies, so admin-only sections (AI usage) come back
// empty for them, and `_notes` says so. The shared flow is lib/admin/export-route.ts.

export const dynamic = "force-dynamic";

export const GET = exportHandler({
  load: buildProjectExport,
  filename: (data, id) => {
    const name = String((data.project as { name?: string }).name ?? "project")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
    return `project-${encodeURIComponent(name)}-${id.slice(0, 8)}.json`;
  },
  devOwner: {
    isOwn: async (db, id, userId) => {
      const { data: own } = await db.from("projects").select("user_id").eq("id", id).maybeSingle();
      return own?.user_id === userId;
    },
    exportedBy: "project owner (EXPORT_DEV_OWNER dev hook)",
    note: "exported by the project owner through the local dev hook: admin-only sections (AI usage) are hidden by RLS",
  },
});
