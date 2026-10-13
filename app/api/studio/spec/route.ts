import { specCache } from "@/lib/studio/ai/cache";
import { runSpecChat, cleanMessages, IDEA_MAX } from "@/lib/studio/ai/spec";
import { callErrorStatus, SpecBody } from "@/lib/studio/server/http";
import { logClamp, studioCall, studioRequest } from "@/lib/studio/server/context";

// POST /api/studio/spec — one idea-chat turn. Answers {question, choices} or
// {spec}. Free (no credit); same limits as /api/brief-chat (a session, guests
// count; last 16 messages × 1,500 chars; the daily guard → 429). Needs the
// project's AI consent. After 4 questions the spec is forced. With `current`
// (W3 + Part A) the answer is {reply, changed, spec?}: a reply always, a spec only
// when the message changed the card. A vague idea, a greeting, thanks, an insult or
// an emoji is answered by our own rules (spec-guards.ts) without a model call.

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
    current: body.current,
    cache: specCache, // W8: the same chat + card is not asked twice
  });
  if (!r.ok) return Response.json({ error: r.error }, { status: callErrorStatus(r.error) });
  logClamp("spec", project.id, r.clampLog, r.source, r.problems);
  const v = r.value;
  if (v.kind === "question") return Response.json({ question: v.question, choices: v.choices });
  if (v.kind === "spec") return Response.json(v.reply ? { spec: v.spec, reply: v.reply } : { spec: v.spec });
  // Part A: once the card exists — always a reply; a spec only when the card changed.
  return Response.json(v.spec ? { reply: v.reply, spec: v.spec, changed: v.changed } : { reply: v.reply, changed: [] });
}
