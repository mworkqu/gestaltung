import { z } from "zod";

import { getSessionContext } from "@/lib/auth/get-session";
import { submitStepJob } from "@/lib/engineering/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/engineering/jobs {projectId, note?} — Engineers level: queue a full,
// editable STEP file of the project (STEP_JOB.tokens ideation tokens, pass
// tokens first). Answers {job} or {error: no_tokens | already_open | …}.

export const dynamic = "force-dynamic";

const Body = z.object({ projectId: z.string().uuid(), note: z.string().max(1000).optional().default("") });

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.is_anonymous) return Response.json({ error: "sign_in" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });

  const session = await getSessionContext(user).catch(() => null);
  const r = await submitStepJob(supabase, { id: user.id, isAdmin: session?.profile.role === "super_admin" }, parsed.data.projectId, parsed.data.note);
  if (!r.ok) {
    const status = { not_found: 404, no_tokens: 402, already_open: 409, not_configured: 503, failed: 500 }[r.error];
    return Response.json({ error: r.error }, { status });
  }
  return Response.json({ job: r.job });
}
