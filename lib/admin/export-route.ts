// The shared body of the two owner export routes
// (GET /api/admin/customers/<id>/export, GET /api/admin/projects/<id>/export):
// id check, session, the super_admin gate, the local dev-owner hook, the 404,
// and the JSON response (?download=1 adds a Content-Disposition file name).
// Every read runs through RLS as the caller; the service client is passed to
// the loader for the sections RLS hides from a super_admin's own session.

import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

type ExportData = Record<string, unknown>;

export type ExportConfig = {
  /** Build the export, or null when there is no such record (404). */
  load: (db: SupabaseClient, id: string, opts: { service: SupabaseClient | null; exportedBy: string }) => Promise<ExportData | null>;
  /** The attachment name used when ?download=1. */
  filename: (data: ExportData, id: string) => string;
  /**
   * Local test hook (EXPORT_DEV_OWNER=1, never in production): may a
   * non-admin export this record? Only called when the hook is enabled.
   */
  devOwner: {
    isOwn: (db: SupabaseClient, id: string, userId: string) => Promise<boolean>;
    exportedBy: string;
    /** Appended to `_notes` so the reader knows RLS hid the admin-only sections. */
    note: string;
  };
};

/** Seams for tests: the two Supabase clients and the environment. */
export type ExportDeps = {
  userClient: () => Promise<SupabaseClient>;
  serviceClient: () => SupabaseClient | null;
  env: { NODE_ENV?: string; EXPORT_DEV_OWNER?: string };
};

const UUID_LIKE = /^[0-9a-f-]{36}$/i;

/** The dev-owner hook is on only outside production AND with EXPORT_DEV_OWNER=1. */
export function devOwnerEnabled(env: ExportDeps["env"]): boolean {
  return env.NODE_ENV !== "production" && env.EXPORT_DEV_OWNER === "1";
}

const status = (code: number) => new Response(null, { status: code });

export function createExportHandler(config: ExportConfig, deps: ExportDeps) {
  return async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
    const { id } = await params;
    if (!UUID_LIKE.test(id)) return status(400);

    const supabase = await deps.userClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return status(401);

    const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    let exportedBy = "super_admin";
    if (me?.role !== "super_admin") {
      if (!devOwnerEnabled(deps.env)) return status(403);
      if (!(await config.devOwner.isOwn(supabase, id, user.id))) return status(403);
      exportedBy = config.devOwner.exportedBy;
    }

    const data = await config.load(supabase, id, { service: deps.serviceClient(), exportedBy });
    if (!data) return status(404);
    if (exportedBy !== "super_admin") (data._notes as string[]).push(config.devOwner.note);

    const download = new URL(request.url).searchParams.get("download") === "1";
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        ...(download ? { "content-disposition": `attachment; filename="${config.filename(data, id)}"` } : {}),
      },
    });
  };
}

/** The route handler wired to the real clients and environment. */
export function exportHandler(config: ExportConfig) {
  return createExportHandler(config, {
    userClient: () => createClient(),
    serviceClient: () => createServiceClient(),
    env: process.env,
  });
}
