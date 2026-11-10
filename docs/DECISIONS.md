# Owner decisions

D1-D13 (site review, 2026-10-03), then later decisions further down.

Owner site review, 2026-10-03. Source prompt: `docs/history/prompts/STAGE_SITE_REVIEW_FIXES_PROMPT.md`. One commit per phase (A-I). Copied from the pre-audit `CLAUDE.md` (`docs/history/CLAUDE-2026-10-full.md`, "Site review decisions"). These are in force unless the owner says otherwise.

| # | Topic | Decision |
|---|---|---|
| D1 | Shipping | QAR 50 for every tier, handling 0. Free delivery over QAR 300 goods subtotal on **Standard only**; Express is never free (Economy also stays QAR 50). |
| D2 | Handling fee | Removed (0, line hidden when 0). |
| D3 | Checkout total | The checkout total is binding. Cart line: "This is your final price. We confirm your order on WhatsApp." |
| D4 | VLT codes | Hide VLT codes from customers (cards, product page, cart). Keep them in the product URL, the order confirmation email and admin pages. |
| D5 | Guests | Guests on /dashboard and /inventory are redirected to /projects. |
| D6 | Projects | Projects stay in this browser; optional email on /projects/new; when given, email the project link to it. |
| D7 | Cookies and analytics | Cookie notice (Accept / Decline); GA4 only after Accept; no Google Signals. |
| D8 | Legal pages | Legal pages come from `LEGAL_PAGES_DRAFT.md` exactly as written (EN + AR, four routes: /delivery-returns, /warranty, /terms, /privacy). Keep "Last updated". Skip the header note. Do not soften wording. |
| D9 | Products | Keep all published products. |
| D10 | WhatsApp | Publish WhatsApp +974 3366 4265 on Contact, footer, checkout, 404. |
| D11 | About page | Founded 2026; Prusa MK4 3D printer, CNC machining, laser cutting, electronics prototyping; no photo for now. |
| D12 | Address and hours | Address: Rafal Tower, Lusail, Qatar. Hours not given, so omit them. |
| D13 | Categories | Category consolidation: show the mapping table and wait for approval. |

## Related items from the same review

- **B7:** do NOT publish "1 free revision; you own the files". /design/drawing gets one line "See what the price includes" -> /warranty.
- **Phase A:** migration 0044 sets shipping outright, makes email required server-side for bank transfer, rejects 0-total orders, adds the free-delivery threshold.
- **Phase I:** the 30-day expiry of the QAR 20 redemption runs from the day the credit is earned.

## Build levels, ideation tokens, engineering (owner, 2026-10-18 and 2026-10-23)

Recovered 2026-11-10 from an uncommitted note in the old `cad-champions` checkout; main had no record of it.
Migrations 0088-0093 are RUN (owner confirmed 2026-10-23).

- **Levels** (`lib/studio/tiers.ts` is the one config): Explorers (1 controller, up to 3 sensors, up to 2 movers,
  tokens x1, default model), Makers (up to 6 sensors, up to 4 movers, x2, stronger model `TIER_MODEL_MAKER`, deep
  electronics check every turn), Engineers (anything bigger, x3, `TIER_MODEL_ENGINEER`). LEDs, buzzers and screens
  do not count. Today the level is computed from the build size (`tierOf(spec)`); `idea_sessions.tier` stores it.
- **Ideation tokens** (0088, kind `idea`): 5 welcome tokens per account, a new idea costs 1 x level, every 5th edit
  turn 1 x level, first 3D redesign free then 1 x level. `idea:<project>` spends are not redeemable at checkout.
- **Billing** (0089, `lib/billing/*`): token packs never expire; optional Maker Pass (30 days, one-month rollover
  cap); Fawran screenshot goes to the `payment-proofs` bucket, a vision check auto-approves or sends it to
  `/dashboard/payments`. Admin costs at `/dashboard/ai-costs`.
- **CAD by complexity** (0090): simple 1 / standard 2 / complex 3 CAD credits. Rewards: delivered order gives 2
  idea tokens, completed print gives 1 CAD credit (`store_settings.rewards`).
- **Engineering** (0091-0092, `lib/engineering/*`): our engineers deliver a full editable STEP of the whole
  project by hand (not the cloud CadQuery worker), about 10 idea tokens, promised 1-3 working hours. Never name the
  CAD program in copy. Failed or cancelled job returns the tokens. Paid services by Fawran
  (`store_settings.engineer_services`): assembly 100 + 5/component + 2/connection, CAD by engineer 200 + 60/h,
  PCB/Gerber 150 + 5/component.
- **Owner decisions 2026-10-23, NOT BUILT YET** (prompt `docs/history/prompts/STAGE_STUDIO_LEVEL_CHOICE_PROMPT.md`):
  - The user chooses to upgrade. Explorers is the default; Makers and Engineers are an explicit upgrade.
  - Models: Explorers = Gemini, Makers = Claude Sonnet 5.5, Engineers = Claude Opus 5.5 (never Fable), hidden from
    clients, Gemini as fallback.
  - 1 token = QAR 5 (was 2); prices rounded up to whole tokens.
  - Chat edits are always free; the cost is taken upfront per new idea (Explorers no charge, Makers 7 tokens,
    Engineers 14 tokens). Wiring and CAD stay paid at every level.
  - 10x guarantee: each idea gets an AI budget of price / 10; after it, edits continue on Gemini. At least USD 1
    per idea. The price is shown before every paid action.
- School classes (0096/0097) are the kids path; CAD Champions is the competition path. Both are separate from the levels.

## Consolidation stage, 2026-11-10 and 2026-11-11

Owner decisions taken during the 2026-11 consolidation and hosting-split stage. Branch `consolidation-2026-11`; report: `docs/history/2026-11-consolidation.md`. The ids O1-O5 come from the stage prompt (`docs/history/prompts/STAGE_CONSOLIDATION_AND_HOSTING_SPLIT_PROMPT.md`); the audit list that defines O1-O15 is `docs/audit/CODE_QUALITY_AUDIT.md`.

1. **O1-O5, as decided by the stage prompt.**
   - O1: delete the v1 public pages and the `site_v2` flag. The former `/v2` pages are the public pages; `/:locale/v2/*` redirects to them.
   - O2: keep the Engineer view (`/projects/[id]/prototyping`, admin only).
   - O3: drop the workshop/tenant inventory (`inventory_items`); `/inventory` redirects to `/my-inventory`. The customer inventory stays.
   - O4: drop the jobs tables; keep the redirects.
   - O5: drop `project_claims`.
2. **Previews are off.** Vercel builds `main` only. Test locally.
3. **The worker is a Node service in this same repo, on the Mac Mini.** The tunnel is Cloudflare Tunnel (the owner created a Cloudflare account on 2026-11-10; it needs the domain's nameservers on Cloudflare; Tailscale Funnel is the documented fallback). On 2026-11-11 the owner said to skip the Mac Mini step for now. The worker stays off.
4. **Google Cloud Run stays for now.** Retiring it depends on worker Part B. Open question, not answered: keep Cloud Run for good if it costs nothing?
5. **Product library with downloadable 3D models. Not built; it is the next project after this stage.**
   - Files live on Cloudflare R2 (private bucket `gestaltung-models`, created 2026-11-10, free tier, 10 GB, downloads not billed). R2 has no hard spending cap.
   - All access goes through ONE storage module, so the host can change later.
   - A model download costs QAR 1 at the store checkout. This is real money, not a credit.
   - Expected size: about 500 models of about 1.5 MB.
   - Never serve model files through Vercel.
   - Host only models the owner drew or is licensed to share.
   - An R2 API token does not exist yet.
6. **The website stays on Vercel.** The Cloudflare Workers free plan allows 10 ms CPU per request; real use would need the US$5 per month paid plan, which the no-subscription rule forbids. CAD and grading do not move to Cloudflare either (Containers need the paid plan).
7. **Claude API: allowed in principle, nothing built.** It would be the first paid AI service, so ask before adding it. (The 2026-10-23 model-per-level decision above still stands.)

## Notes

- The pre-audit `CLAUDE.md` still said in its permanent notes that the WhatsApp number was not published yet (env var `NEXT_PUBLIC_WHATSAPP_NUMBER`, falling back to /contact; "owner chose not to publish the number publicly until launch"). D10 (above) is the later, dated decision; the current `CLAUDE.md` keeps that permanent note unchanged.
- Other owner rules (no paid subscriptions, no reprint promises, legal wording unchanged) are in `CLAUDE.md` "Hard rules".
