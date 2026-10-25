import { specCache } from "@/lib/studio/ai/cache";
import { runSpecChat, cleanMessages, ruleTurn, IDEA_MAX } from "@/lib/studio/ai/spec";
import { callErrorStatus, SpecBody } from "@/lib/studio/server/http";
import { logClamp, studioCall, studioRequest } from "@/lib/studio/server/context";
import { ideaStatus, planTurn, priceTurn } from "@/lib/studio/server/tokens";
import { tierModel, tierOf } from "@/lib/studio/tiers";
import { jsonOk, jsonError } from "@/lib/http";

// POST /api/studio/spec — one idea-chat turn. Answers {question, choices} or
// {spec}. Same limits as /api/brief-chat (a session, guests count; last 16
// messages × 1,500 chars; the daily guard → 429). Needs the project's AI
// consent. After 4 questions the spec is forced. With `current` (W3 + Part A)
// the answer is {reply, changed, spec?}: a reply always, a spec only when the
// message changed the card. A vague idea, a greeting, thanks, an insult or an
// emoji is answered by our own rules (spec-guards.ts) without a model call.
//
// IDEATION TOKENS (owner, 2026-10-25; migrations 0088 + 0106)
// An idea is paid for UPFRONT at its complexity tier — Tier 1 free, Tier 2 7,
// Tier 3 14 tokens (lib/studio/tiers.ts is the one config). Three cases:
//   1. refining the SAME idea is free, however many turns it takes;
//   2. a turn that grows the same idea into a higher TIER costs the difference;
//   3. a turn that replaces the product with a DIFFERENT product costs the new
//      product's full tier price (lib/studio/identity.ts decides, conservatively).
// The tier comes from OUR code — the understanding's part counts plus the `scope`
// the model returns on the same turn — and the amount is never read from the
// request body. The model never names a price.
//
// CHECKPOINT: cases 2 and 3 never charge silently. Nothing is charged and the
// card is NOT handed over; the answer is
//   200 {needsApproval: {kind, fromTier, tier, level, tokens, reasons}, reply, tokens}
// so the UI can show the exact cost and offer "approve and continue" or "keep
// refining what we have". Approval resends the same turn with `approveTier`; the
// model answer comes from the turn cache, our code classifies it again and charges
// EXACTLY the agreed amount. A replay charges once: the stored tier covers an
// escalation and 0106's unique idea key covers a new product. Too few tokens for
// the agreed amount → 402 no_tokens.

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

  // Our own rules answer some turns without a model call; those never involve tokens.
  const free = ruleTurn(idea, messages, body.locale, current) !== null;
  const status = free ? null : await ideaStatus(supabase, project.id);

  const r = await runSpecChat({
    call: studioCall(supabase, project.id, ctx.userId),
    idea,
    messages,
    locale: body.locale,
    current,
    cache: specCache, // W8: the same chat + card is not asked twice
    // Makers / Engineers: a stronger model and a deeper electronics check (costs are logged per call).
    model: tierModel(before),
    deep: before.deep,
  });
  if (!r.ok) return jsonError(r.error, callErrorStatus(r.error));
  logClamp("spec", project.id, r.clampLog, r.source, r.problems);
  const v = r.value;

  const produced = (v.kind === "spec" || v.kind === "reply") && v.spec ? v.spec : null;
  const after = produced ?? current;

  // What this turn is: a free refinement, a tier escalation, or a different product
  // (planTurn runs the conservative identity check; the browser's approveTier can
  // only allow a charge, never price it — AI-06).
  const plan = planTurn({
    status,
    before: current,
    produced,
    hint: v.kind === "reply" ? v.newProduct : false,
    approved: body.approveTier,
  });

  // Balance, checkpoint, charge and telemetry, in that order (priceTurn).
  const money = await priceTurn(supabase, project.id, plan, {
    status,
    before: current,
    after,
    previousTier: current ? before : undefined,
    spend: r.cached ? null : r.spend,
    model: r.model ?? null,
    source: r.cached ? "cache" : r.source,
  });
  if (money.refused) return Response.json(money.refused.body, { status: money.refused.status });
  if (money.pause) {
    // Paused: say what it would cost, and keep the model's own sentence so the chat
    // is not silent. The new card is deliberately withheld until the visitor agrees.
    const reply = v.kind === "spec" || v.kind === "reply" ? v.reply : undefined;
    return jsonOk({ ...money.pause, ...(reply ? { reply } : {}) });
  }
  const { tokens } = money;

  if (v.kind === "question") return jsonOk({ question: v.question, choices: v.choices, tokens });
  if (v.kind === "spec") return jsonOk(v.reply ? { spec: v.spec, reply: v.reply, tokens } : { spec: v.spec, tokens });
  // Part A: once the card exists — always a reply; a spec only when the card changed.
  return Response.json(
    v.spec ? { reply: v.reply, spec: v.spec, changed: v.changed, tokens } : { reply: v.reply, changed: [], tokens },
  );
}
