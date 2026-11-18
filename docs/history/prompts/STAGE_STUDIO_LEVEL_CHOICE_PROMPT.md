# Studio — the user chooses the build level (owner, 2026-10-23)

Paste everything below into Claude Code.

```
Work on main: `git checkout main && git pull` first (the local main is behind origin/main; the level code
landed there on 2026-10-21). Read CLAUDE.md (section "BUILD LEVELS, IDEATION TOKENS, ENGINEERING" — if your
main copy lacks it, copy it in from the cad-champions branch's CLAUDE.md as your first commit), DESIGN.md,
lib/studio/tiers.ts, lib/studio/server/tokens.ts, app/api/studio/spec/route.ts,
app/api/studio/product/design/route.ts, components/studio/steps/UnderstandingPanel.tsx,
app/[locale]/projects/[id]/engineering/page.tsx and migration 0088 (idea_sessions).
Use delegation defaults. Commit per step; run typecheck, lint, vitest, i18n parity, build, Playwright.
Stop and ask before: any migration, deleting data, any paid service.

GOAL: the build level (Explorers / Makers / Engineers) is the USER'S CHOICE, not computed from the build size.

RULES
1. Every project starts at Explorers. The chosen level lives in idea_sessions.tier (server-written, as today).
   If writing it needs a new SQL function or policy, stop and ask (that is a migration).
2. Size only RECOMMENDS. Keep tierOf(spec) but rename its role to recommendedLevel(spec). When the build is
   bigger than the chosen level, show one calm card under the understanding:
   "This idea is bigger than Explorers. Makers gives it a stronger designer and a deeper wiring check."
   Buttons: "Upgrade to Makers" / "Keep Explorers". "Keep" hides the card for that level on that project.
   Never block, never trim the user's parts because of the level.
3. A level picker the user can open any time (Studio header, next to the token balance): three cards with what
   each level gives, in plain words, and its token rate (x1 / x2 / x3). Choosing is free; the level only
   changes what later turns cost. Downgrading is allowed; it applies from the next turn.
4. Charges use the CHOSEN level: turnCost, regenCost and ideaCharge take the chosen level, not tierOf(spec).
   The model choice (tierModel / deep check) follows the chosen level too.
5. Engineers-only features follow the chosen level: the Engineering page's "Get the full STEP file" job is
   offered only at Engineers; at lower levels the page shows the upgrade card instead. Engineer services
   (assembly, CAD by engineer, PCB) stay open to everyone (they are paid separately).
6. Admins (super_admin) can pick any level and are never charged (as today).
7. School class projects (is_class_project) are locked to Explorers: no picker, no upgrade card.
8. Existing projects: read their stored idea_sessions.tier as the chosen level (no data change).
9. Copy EN + AR (RTL), no engineering words, no "free" in buttons, Western digits. Never promise a time the
   studio can't keep: keep the existing "1–3 working hours" text only where it already is.
10. Analytics: track level_upgraded {from, to, where: "card" | "picker"} and level_declined {level}.

TESTS: vitest for the cost rules at each chosen level (incl. a 7-sensor build kept at Explorers = x1, and an
Explorers-size build chosen at Engineers = x3), class lock, admin no charge. Playwright on the studio fixture:
big idea → card → upgrade → balance line shows x2; picker downgrade; class fixture shows no picker; EN + AR,
375 + 1366, no overflow.

DONE: update CLAUDE.md (the BUILD LEVELS entry: "the user chooses" is now built), and give me a 5-minute test
on the live site.
```

---

# Part 2 — Claude models per level, QAR 5 tokens, upfront prices, free edits, 10x guarantee (owner, 2026-10-23)

Paste this into the same Claude Code session after Part 1 (or together with it).

```
Read lib/studio/tiers.ts, lib/billing/config.ts, lib/ai/prices.ts, lib/ai/usage.ts, lib/studio/server/tokens.ts,
the gemini client (lib/prototyping/providers/gemini-client.ts) and the studio call wrapper used by
app/api/studio/spec/route.ts. Same rules as Part 1 (commit per step, all checks, stop before any migration,
deleting data or a paid service — the Anthropic key is already approved by the owner).

A. MODELS (hidden from the client; never name a model or AI company in any client copy or reply)
   - Explorers: Gemini as today (GEMINI_MODEL).
   - Makers: Claude Sonnet 5.5 (env TIER_MODEL_MAKER, default "claude-sonnet-5-5").
   - Engineers: Claude Opus 5.5 (env TIER_MODEL_ENGINEER, default "claude-opus-5-5").
   - Never Fable.
   - Add a Claude provider beside the Gemini one (plain fetch to the Anthropic Messages API, no SDK needed;
     env ANTHROPIC_API_KEY, server only). The model id decides the provider ("claude-" prefix → Claude).
     Same JSON-schema validation, retry and clamp path as Gemini; use prompt caching on the fixed system
     prompts. Every call goes through logUsage with provider, model, tokens and cost_usd.
   - Fallback: Claude error / 429 / 5xx / timeout / no key → the strong Gemini model (GEMINI_FALLBACK_MODEL);
     the client never sees an error because of it. Log the fallback in ai_usage.
   - This applies to every Studio AI step on that project (spec chat, parts pick, product design, vision
     check), chosen by the project's CHOSEN level (Part 1).
   - lib/ai/prices.ts: add Claude prices (USD per million tokens, from platform.claude.com pricing, checked
     2026-10-23): haiku 5.5 in 0.10 / out 0.50; sonnet 5.5 in 2 / out 10; opus 5.5 in 4 / out 20;
     cache reads: haiku 0.1x, sonnet and opus 0.05x of input. Keep AI_PRICES env override.

B. TOKEN PRICE: 1 token = QAR 5 (was 2). lib/billing/config.ts TOKEN_PRICE_QAR = 5 → packs 10/25/50 tokens
   = QAR 50/125/250; Maker Pass formula unchanged (QAR 20 → 2 x floor(20/5) = 8 tokens/month, cap 16).
   Tokens already in users' balances stay valid as they are. Update every place that shows a token's QAR
   value (pricing page, Studio balance, payments, admin). EN + AR.

C. PRICES — PAY UPFRONT, CHAT EDITS ARE ALWAYS FREE (owner rule). Every amount rounded UP to whole
   tokens (QAR 5). ONE table in lib/studio/tiers.ts, replacing the x1/x2/x3 multiplier and the
   "1 token every N edit turns" rule (remove IDEA_TURNS_PER_TOKEN charging):
                     new idea            chat edits   new 3D designs (first free)
     Explorers       free                free         free (daily rate limits as today)
     Makers          7 tokens (QAR 35)   free         1
     Engineers       14 tokens (QAR 70)  free         2
   Upgrading an existing idea (Part 1) charges the DIFFERENCE between the two new-idea prices, shown first.
   WIRING AND CAD STAY PAID AT EVERY LEVEL, Explorers included, exactly as today (wiring credit per circuit,
   CAD credits by complexity 1/2/3, existing out-of-credits flow). Do not change those rules.
   Explorers ideation is free but keeps the existing daily limits (guest 5/day, account 30/day) so the free
   Gemini quota can't be drained.
   Engineering STEP job (lib/engineering/config.ts): keep 10 tokens (now QAR 50).

D. THE 10x GUARANTEE (per idea). Constants in lib/studio/tiers.ts: MARGIN = 10, FLOOR_USD = 1,
   USD_TO_QAR = 3.64. The Makers / Engineers new-idea price is sized so that price >= MARGIN x expected AI
   cost of an idea (start + about 25 edits at the level's model). Explorers ideation is free (Gemini, $0);
   its income comes from wiring and CAD. FLOOR_USD = 1 applies to Makers / Engineers only.
   - Each idea gets an AI budget = price_paid_qar / USD_TO_QAR / MARGIN (in USD), stored with the session.
   - Every AI call on the project adds its cost_usd to the idea's spend (ai_usage already logs it).
   - While spend < budget: edits run on the level's model (Sonnet / Opus).
   - When spend reaches the budget: edits STAY FREE but run on the Explorers model (Gemini). Tell the
     user once, plainly, before it happens: "Your Makers edits for this idea are used up; the chat
     continues at the standard level. Start a new Makers idea for more." (EN + AR). Never charge an edit.
   - Paid actions (new idea, new 3D designs, STEP job) show their price BEFORE the action; the amount
     charged equals the amount shown.
   - Pure functions ideaBudgetUsd(), modelForTurn() in lib/studio/tiers.ts with vitest cases: Explorers
     (Gemini, $0) → free idea + unlimited free edits, budget not used; Makers under budget → Sonnet; Makers over budget → Gemini, no
     charge; upgrade charges the difference; admin → 0 and always the level's model.
   - Admin /dashboard/ai-costs: per idea cost USD, paid QAR, ratio (paid ÷ cost), red when < 10x, and the
     average edits per idea per level so the owner can retune the table after the first week.

E. PRIVACY (Consumer Protection + PDPPL): the privacy page and /trust must name Anthropic as a processor
   beside Google for AI features. Edit LEGAL_PAGES_DRAFT.md §4 (EN + AR) and regenerate with
   scripts/split-legal-draft.mjs (never hand-edit content/legal); update the /trust data card copy and bump
   "Last updated". Keep the chat's existing filter that hides model / company names in replies.

F. OWNER SETUP NOTE (write into docs, don't do it): set ANTHROPIC_API_KEY in Vercel (Production + Preview),
   and in the Anthropic Console set a monthly spend limit of USD 25.

DONE: CLAUDE.md entry (models per level, QAR 5 token, meter formula), and a 5-minute live test: one Makers
idea (check ai_usage shows a claude-sonnet row with cost), 10 free edits (balance unchanged), the ratio on
/dashboard/ai-costs.
```
