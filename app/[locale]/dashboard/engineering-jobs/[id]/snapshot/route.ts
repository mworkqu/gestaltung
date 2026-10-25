import { NextResponse } from "next/server";

import { getSessionContextCached } from "@/lib/auth/guards";
import { loadPrivateModels } from "@/lib/studio/server/doc";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { UUID_RE } from "@/lib/uuid";

// The Studio document the user submitted (parts list + wiring), as JSON, so
// the engineer works from the exact data. super_admin only.
//
// The stored snapshot never holds the private product models (the owner can
// read their job row — DB-01 G1.2). They are added here, for the admin only,
// from project_studio_private with the service role: the models as they are
// NOW (the design the user unlocked/chose is in snapshot.studio.product).

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionContextCached();
  if (session?.profile.role !== "super_admin") return new NextResponse("Forbidden", { status: 403 });
  if (!UUID_RE.test(id)) return new NextResponse("Not found", { status: 404 });

  const supabase = await createClient();
  const { data, error } = await supabase.from("engineering_jobs").select("snapshot, project_id").eq("id", id).maybeSingle();
  if (error || !data || data.snapshot == null) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(JSON.stringify(await withPrivateModels(data.snapshot, data.project_id), null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="job-${id.slice(0, 8)}-snapshot.json"`,
      "Cache-Control": "no-store",
    },
  });
}

async function withPrivateModels(snapshot: unknown, projectId: string | null): Promise<unknown> {
  const snap = snapshot as { studio?: unknown } | null;
  if (!projectId || !snap || typeof snap.studio !== "object" || snap.studio === null) return snapshot;
  const service = createServiceClient();
  if (!service) return snapshot;
  const priv = await loadPrivateModels(service, projectId, null);
  if (!priv.ok || !priv.priv) return snapshot;
  return { ...snap, studio: { ...(snap.studio as Record<string, unknown>), productPrivate: priv.priv } };
}
