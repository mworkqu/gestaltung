import { createClient } from "@/lib/supabase/server";
import { jsonError, jsonOk } from "@/lib/http";

// POST /api/engineering/jobs/<id>/cancel — a queued job only; the tokens come back.

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonError("bad_request", 400);
  const supabase = await createClient();
  const { error } = await supabase.rpc("engineering_job_cancel", { p_job: id });
  if (error) return jsonError(error.message.includes("not_open") ? "not_open" : "failed", 409);
  return jsonOk({ ok: true });
}
