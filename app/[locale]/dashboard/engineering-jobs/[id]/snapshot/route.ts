import { NextResponse } from "next/server";

import { getSessionContext } from "@/lib/auth/get-session";
import { createClient } from "@/lib/supabase/server";
import { UUID_RE } from "../../../ai-costs/format";

// The Studio document the user submitted (parts list + wiring), as JSON, so
// the engineer works from the exact data. super_admin only.

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionContext();
  if (session?.profile.role !== "super_admin") return new NextResponse("Forbidden", { status: 403 });
  if (!UUID_RE.test(id)) return new NextResponse("Not found", { status: 404 });

  const supabase = await createClient();
  const { data, error } = await supabase.from("engineering_jobs").select("snapshot").eq("id", id).maybeSingle();
  if (error || !data || data.snapshot == null) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(JSON.stringify(data.snapshot, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="job-${id.slice(0, 8)}-snapshot.json"`,
      "Cache-Control": "no-store",
    },
  });
}
