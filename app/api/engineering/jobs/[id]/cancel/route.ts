import { createClient } from "@/lib/supabase/server";

// POST /api/engineering/jobs/<id>/cancel — a queued job only; the tokens come back.

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "bad_request" }, { status: 400 });
  const supabase = await createClient();
  const { error } = await supabase.rpc("engineering_job_cancel", { p_job: id });
  if (error) return Response.json({ error: error.message.includes("not_open") ? "not_open" : "failed" }, { status: 409 });
  return Response.json({ ok: true });
}
