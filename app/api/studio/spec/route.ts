import { specCache } from "@/lib/studio/ai/cache";
import { runSpecChat, cleanMessages, ruleTurn, IDEA_MAX } from "@/lib/studio/ai/spec";
import { callErrorStatus, SpecBody } from "@/lib/studio/server/http";
import { logClamp, studioCall, studioRequest } from "@/lib/studio/server/context";
import { ideaCharge, ideaStatus, tokenInfo } from "@/lib/studio/server/tokens";
import { tierOf, turnCost } from "@/lib/studio/tiers";

// POST /api/studio/spec — one idea-chat turn. Answers {question, choices} or
// {spec}. Same limits as /api/brief-chat (a session, guests count; last 16
// messages × 1,500 chars; the daily guard → 429). Needs the project's AI
// consent. After 4 questions the spec is forced. With `current` (W3 + Part A)
// the answer is {reply, changed, spec?}: a reply always, a spec only when the
// message changed the card. A vague idea, a greeting, thanks, an insult or an
// emoji is answered by our own rules (spec-guards.ts) without a model call.
//
// Ideation tokens (2026-10-18, migration 0088): a turn that reaches the model
// costs what lib/studio/tiers.ts turnCost() says — a new idea 1, then 1 every
// N edit turns, × the build tier. No tokens → 402 no_tokens before the model is
// called. Rule-answered turns are free. Every answer carries `tokens` (balance,
// tier, next charge, tierChange when the build moved tier).

export const dynamic = "force-dynamic";
// Up to two model calls of 45 s.
export const maxDuration = 120;

export async function POST(request: Request) {
  const ctx = await studioRequest(request, SpecBody, { consent: true });
  if (ctx instanceof Response) return ctx;
  const { supabase, body, project } = ctx;

  const idea = body.idea.slice(0, IDEA_MAX);
  const messages = cleanMessages(body.messages);
  const current = body.current;
  const before = tierOf(current);

  // Tokens: only a turn the model answers costs anything.
  const free = ruleTurn(idea, messages, body.locale, current) !== null;
  const status = free ? null : await ideaStatus(supabase, project.id);
  const cost = status ? turnCost({ started: status.started, editTurnsSoFar: status.edit_turns, current }) : null;
  if (status && cost && status.role !== "admin" && cost.amount > status.balance) {
    return Response.json(
      { error: "no_tokens", need: cost.amount, tokens: tokenInfo({ status, spec: current }) },
      { status: 402 },
    );
  }

  const r = await runSpecChat({
    call: studioCall(supabase, project.id),
    idea,
    messages,
    locale: body.locale,
    current,
    cache: specCache, // W8: the same chat + card is not asked twice
  });
  if (!r.ok) return Response.json({ error: r.error }, { status: callErrorStatus(r.error) });
  logClamp("spec", project.id, r.clampLog, r.source, r.problems);
  const v = r.value;

  const after = (v.kind === "spec" || v.kind === "reply") && v.spec ? v.spec : current;
  // The model answered (or its safe default stood in): charge the turn. Tier = the build as it now stands.
  const charge =
    status && cost && r.source !== "rules"
      ? await ideaCharge(supabase, project.id, r.source === "model" ? cost.amount : 0, tierOf(after).id, cost.edit)
      : null;
  const tokens = tokenInfo({ status, charge, spec: after, before: current ? before : undefined });

  if (v.kind === "question") return Response.json({ question: v.question, choices: v.choices, tokens });
  if (v.kind === "spec") return Response.json(v.reply ? { spec: v.spec, reply: v.reply, tokens } : { spec: v.spec, tokens });
  // Part A: once the card exists — always a reply; a spec only when the card changed.
  return Response.json(
    v.spec ? { reply: v.reply, spec: v.spec, changed: v.changed, tokens } : { reply: v.reply, changed: [], tokens },
  );
}
