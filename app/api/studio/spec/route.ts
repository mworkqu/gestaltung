import { runSpecChat, cleanMessages, IDEA_MAX } from "@/lib/studio/ai/spec";
import { callErrorStatus, SpecBody } from "@/lib/studio/server/http";
import { logClamp, studioCall, studioRequest } from "@/lib/studio/server/context";

// POST /api/studio/spec — one idea-chat turn. Answers {question, choices} or
// {spec}. Free (no credit); same limits as /api/brief-chat (a session, guests
// count; last 16 messages × 1,500 chars; the daily guard → 429). Needs the
// project's AI consent. After 4 questions the spec is forced.

export const dynamic = "force-dynamic";
// Up to two model calls of 45 s.
export const maxDuration = 120;

export async function POST(request: Request) {
  const ctx = await studioRequest(request, SpecBody, { consent: true });
  if (ctx instanceof Response) return ctx;
  const { supabase, body, project } = ctx;

  const r = await runSpecChat({
    call: studioCall(supabase, project.id),
    idea: body.idea.slice(0, IDEA_MAX),
    messages: cleanMessages(body.messages),
    locale: body.locale,
  });
  if (!r.ok) return Response.json({ error: r.error }, { status: callErrorStatus(r.error) });
  logClamp("spec", project.id, r.clampLog, r.source, r.problems);
  return Response.json(
    r.value.kind === "spec" ? { spec: r.value.spec } : { question: r.value.question, choices: r.value.choices }
  );
}
