import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

// POST /api/engineering/jobs/<id>/return {path} — the user's edited STEP, uploaded to
// engineering-files/<uid>/…, sent back to us to manufacture (a ready job only).

export const dynamic = "force-dynamic";

const Body = z.object({ path: z.string().min(3).max(300) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "bad_request" }, { status: 400 });
  const supabase = await createClient();
  const { error } = await supabase.rpc("engineering_job_return", { p_job: id, p_path: parsed.data.path });
  if (error) return Response.json({ error: error.message.includes("bad_path") ? "bad_path" : "not_ready" }, { status: 409 });
  return Response.json({ ok: true });
}
