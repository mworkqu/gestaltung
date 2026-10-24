import { z } from "zod";

import { getSessionContext } from "@/lib/auth/get-session";
import { submitStepJob } from "@/lib/engineering/server";
import { requireAccount } from "@/lib/auth/guards";
import { jsonError, jsonOk } from "@/lib/http";

// POST /api/engineering/jobs {projectId, note?} — Engineers level: queue a full,
// editable STEP file of the project (STEP_JOB.tokens ideation tokens, pass
// tokens first). Answers {job} or {error: no_tokens | already_open | …}.

export const dynamic = "force-dynamic";

const Body = z.object({ projectId: z.string().uuid(), note: z.string().max(1000).optional().default("") });

export async function POST(request: Request) {
  const auth = await requireAccount();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("bad_request", 400);

  const session = await getSessionContext(user).catch(() => null);
  const r = await submitStepJob(supabase, { id: user.id, isAdmin: session?.profile.role === "super_admin" }, parsed.data.projectId, parsed.data.note);
  if (!r.ok) {
    const status = { not_found: 404, no_tokens: 402, already_open: 409, not_configured: 503, failed: 500 }[r.error];
    return Response.json({ error: r.error }, { status });
  }
  return jsonOk({ job: r.job });
}
