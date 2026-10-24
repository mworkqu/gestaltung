import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { jsonError, jsonOk } from "@/lib/http";

// POST /api/engineering/jobs/<id>/return {path} — the user's edited STEP, uploaded to
// engineering-files/<uid>/…, sent back to us to manufacture (a ready job only).

export const dynamic = "force-dynamic";

const Body = z.object({ path: z.string().min(3).max(300) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !/^[0-9a-f-]{36}$/i.test(id)) return jsonError("bad_request", 400);
  const supabase = await createClient();
  const { error } = await supabase.rpc("engineering_job_return", { p_job: id, p_path: parsed.data.path });
  if (error) return jsonError(error.message.includes("bad_path") ? "bad_path" : "not_ready", 409);
  return jsonOk({ ok: true });
}
