# Security review: AI + CAD routes (Gestaltung, audit/code-and-security-2026-10)

Scope: app/api/studio/** (15 route files, 16 handlers), app/api/{cad,project-cad,analyse,brief-chat,firmware,netlist,transcribe,bom/electronics,bom/match}, lib/ai, lib/prototyping/{ai-call,providers,analysis*}, lib/studio/server/*, lib/studio/ai/*, lib/studio/product/*, lib/cad/*, lib/credits/*, lib/engineering/*, services/cad-worker/app/*, and the SQL behind them (0015, 0020, 0023/0031, 0024, 0042, 0043, 0052, 0068, 0088/0089, 0090, 0096, 0099).
Method: read-only static review. No AI, Supabase or network call was made. Two local proofs ran in the scratchpad with no network (pure Python): the worker's `sandbox.check()` against candidate escape inputs, and pyparsing's `parse_file` behaviour. Probe files were deleted afterwards.

Conventions: "owner" = `projects.user_id = auth.uid()`; RLS also lets `is_super_admin()` through (0015:137-151) and 0096 adds a teacher SELECT on class projects. "Guests" are Supabase anonymous users; they carry the `authenticated` role, so every `grant ... to authenticated` applies to them.

---

## 1. ROUTE TABLE

| Route | Auth / guest | Ownership check | Credit/token charge point | Validation / size | Rate limit | Prompt-injection exposure | Notes |
|---|---|---|---|---|---|---|---|
| POST /api/analyse | session; guests + Turnstile (if on) | none up front; `projectId` only used for RLS reads/inserts, a foreign id silently skips reuse + persistence | none (free); metered only | zod in + zod out (`Disciplines/Requirements/AnalysisSchema`) + `honestSources` | `bomRate` (anon 5/user 30 per day) + global quota | brief → Gemini → validated JSON shown as text | reuse via `request_hash` 0099 is server-side; rows client-insertable (AI-13) |
| POST /api/brief-chat | session; guests, **no Turnstile** | none (`projectId` logging only) | none | hand-rolled, **no zod**; 16 msgs×1500, brief 6000 | **global quota only** | brief+chat → Gemini; output only `String().slice`, user clicks "Add to brief" | 502 on paused (should be 429) |
| POST /api/cad | session; guests refused (sign_in) | `canUse` + `cad_begin` re-check owner (0090:47) | **browser engine:** code returned BEFORE charge; `cad_deliver` later from browser. **cloud:** `cad_deliver` server-side before returning | zod Body (req ≤4000) + `validateScad`/`validateCadQuery` | `too_many_failed` (≥5 undelivered-with-code/24h) + quota | **HIGH**: request text → model → CadQuery **executed on cad-worker** (AI-03); OpenSCAD runs in the user's own browser | reads client `x-vercel-oidc-token` (AI-04); tier from user text (AI-07) |
| POST /api/project-cad | session; guests | RLS read of project; storage path must start `uid/` | none | no zod; strings sliced | **none** | none (no AI) | emails owner every call |
| POST /api/firmware | session; guests | `.eq(user_id)` + RLS | none | uuid regex | **global quota only** | brief+netlist → sketch (text, user flashes) | direct `callGemini`, not `validatedCall` |
| POST /api/netlist | session; guests→401 | RLS select | `canUse` → model → save → `spend()` AFTER; returned even if spend fails (AI-05) | body **no zod**; out zod + `crossValidate` | global quota | `projects.bom` (user-writable) → netlist (validated) | |
| POST /api/bom/electronics | session; guests (list) | RLS select | list free; circuit like /api/netlist | **no zod** | `bomRate` + quota | brief/spec → parts+netlist (validated) | Turnstile not applied (noted in code) |
| POST /api/bom/match | session | RLS select | none | **no zod** | none | BOM → `log_sourcing_gap`/`record_bom_demand` (admin lists) | AI-16 |
| POST /api/transcribe | session; guests, no Turnstile | none (projectId logged) | none | 4 MB, MIME-prefix | **global Groq guard only** | audio → text to editor only | no `maxDuration`, no upstream timeout (AI-14) |
| GET/PUT /api/studio/doc | session; guests | RLS | none | 256 KB cap + zod `StudioDocSchema`; server-owned keys merged from DB | none | none | same column writable/readable directly via PostgREST (AI-01) |
| POST /api/studio/spec | studioRequest (session, zod, RLS, AI-consent) | RLS | tokens: `ideaStatus` → model → `ideaCharge` AFTER; cost from client `current` (AI-06) | zod SpecBody (idea ≤4000) | tokens (bypassable) + quota | idea/chat → spec (validated+clamped+guards) | shared in-memory LRU keyed by content |
| POST /api/studio/pick | studioRequest, consent | RLS | free | zod; output vs library index | `bomRate` | spec → part ids (library-constrained) | |
| POST /api/studio/wiring | studioRequest, no consent | RLS | `canUse` → rules → save → `spend()` AFTER; returned even on spend fail (AI-05) | zod (≤40 comps) | credit only | none (deterministic) | |
| POST /api/studio/enclosure | studioRequest, consent | RLS + cad_begin | `canUse` → begin → set_code → **deliver before response** (correct) | zod + `validateEnclosure` + clamp | `too_many_failed`+quota | spec name / labels (≤60) → EnclosureSpec | tier from `components.length` (AI-07); model-fail default free |
| POST /api/studio/mech | studioRequest, consent | RLS | free | zod + `validateMech` | `bomRate` | doc summary → clamped params | |
| POST /api/studio/firmware | studioRequest, consent | RLS | free | zod | **global quota only** | spec text → sketch (pin block re-synced) | |
| GET /api/studio/tokens | session | RLS read + RPC `owns_project` | none (grants 5 welcome tokens on first sight, guests too) | regex | none | none | |
| POST /api/studio/product/design | studioRequest, consent | RLS | regen: `regenCost(regens)` pre → model → save → `ideaCharge` AFTER; `regens` from client-writable JSON (AI-01/06) | zod (feedback ≤400) | guests 3/day (non-atomic, fail-open); **signed-in unlimited** | brief+feedback → designs (validated) | **response includes full `model`** (AI-02) |
| POST /api/studio/product/check | studioRequest, consent | RLS + designId | free | zod + PNG sig ≤1.5 MB ×3 | **global quota only** | client images → vision → allow-listed patches (`applyPatches`) | **returns `model`** incl. when skipped (AI-02) |
| POST /api/studio/product/choose | studioRequest, no consent | RLS | free | zod | none | none | |
| POST /api/studio/product/preview | studioRequest, no consent | RLS read → service-role upload to fixed `<pid>/<did>.png` | free | zod + PNG sig ≤3 MB | none | none | path from validated ids (OK) |
| POST /api/studio/product/unlock | studioRequest, no consent | RLS + cad_begin | `canUse` → begin → set_code → **deliver before response** | zod | `too_many_failed` | none | tier from client-writable doc (AI-07) |
| GET /api/studio/product/model | session | RLS + `product.unlockedId===designId` or super_admin | gate only | zod | none | none | `unlockedId` in client-writable `projects.studio` (AI-01) |
| GET /api/studio/product/engineer | session + `role=super_admin` | RLS | none | zod | none | none | OK |

All routes are `force-dynamic` and read the body with no Next.js cap; the Vercel ~4.5 MB platform limit is the effective cap (not verified for this project).

---

## 2. FINDINGS

### AI-01 — High — `projects.studio` (server-owned product keys, unlock flag, private models) is directly readable AND writable by the owner through PostgREST
- Evidence:
  - `supabase/migrations/0015_projects.sql:148-151`: `create policy projects_update ... using (user_id = auth.uid() or public.is_super_admin()) with check (...)`, with a table-wide `update` grant to `authenticated` (0015:130).
  - `supabase/migrations/0068_design_studio.sql:12-13`: "RLS unchanged: the existing projects policies ... already cover every column; the Studio API routes write through them." No trigger guards the `studio` column (0042's `projects_guard_credit_columns` covers only the credit columns).
  - `lib/studio/product/private.ts:83-86`: "the page's doc with the server-owned keys replaced by the stored ones (a page can't erase, forge or unlock anything)" — this protection lives only inside `saveDoc`/`mergeServerOwned`, i.e. only on the `/api/studio/doc` path.
  - `app/api/studio/product/model/route.ts:30`: `const unlocked = cur.owned.product.unlockedId === q.data.designId;`
- Exploit (owner, with the public anon key + own JWT, not the app):
  1. `PATCH /rest/v1/projects?id=eq.<own>` with `{"studio":{...,"product":{...,"unlockedId":"d_xxx","regens":0}}}`. `GET /api/studio/product/model?...&designId=d_xxx` then returns the final model with no CAD credit spent; `/product/design` regenerations stay free because `regenCost` reads `cur.owned.product?.regens`.
  2. `GET /rest/v1/projects?select=studio->productPrivate&id=eq.<own>` reads every private design model directly.
  3. The 256 KB `DOC_MAX_BYTES` cap and `StudioDocSchema` shape are enforced only in the route, so a direct PATCH can store arbitrary/oversized JSON.
- Fix: move `product`/`productPrivate`/`regens`/`unlockedId` into a table with no client grants, written only by SECURITY DEFINER RPCs or the service role (RLS cannot hide a jsonb sub-key from SELECT, so a trigger alone does not fix the read side). Minimum stop-gap: a BEFORE UPDATE trigger (pattern of `projects_guard_credit_columns`) that restores `new.studio->'product'`/`'productPrivate'` from `old` unless a server-set flag is on, plus `pg_column_size(new.studio) <= 262144`.
- Test: PGlite migration test — as owner, `update projects set studio = jsonb_set(studio,'{product,unlockedId}','"d_x"')` and assert the stored value is unchanged; `select studio->'productPrivate'` returns null once moved.

### AI-02 — High — the paid "Create my CAD" model reaches the browser before payment, via `/product/design` and `/product/check`
- Evidence:
  - `app/api/studio/product/design/route.ts:89`: response maps `model: d.model` for every design.
  - `app/api/studio/product/check/route.ts:43,61,87`: returns `{model}` on `skipped:"no_key"`, `skipped:"quota"`, and on success `model: changed ? after.model : model`.
  - `lib/studio/product/private.ts:117`: `finalModel = (d) => d.best?.model ?? d.model` — `/check` returns the same model that `/product/model` gates behind `unlock`.
  - `app/api/studio/product/unlock/route.ts` spends a CAD credit to set `unlockedId`; `/product/model/route.ts:31` is the only gated reader.
- Exploit: call `/product/check` (consent only, no credit) with three minimal valid PNGs for any designId and read `model` from the response — the geometry the unlock credit is supposed to buy. STL/STEP are built client-side from that model, so unlock buys nothing extra.
- Fix: needs an owner decision (previews are rendered client-side by the Studio worker, which needs geometry). Options: render previews server-side; ship a reduced/obfuscated preview mesh; or accept the model as public and price the export server-side. Either way, drop `model` from `/check` responses and from `/design` once a server preview exists.
- Test: route test — `/check` and `/design` response bodies contain no `model` key.

### AI-03 — High — cad-worker static sandbox is a denylist with confirmed bypasses, over a namespace that exposes the real `cadquery` package
- Area: services/cad-worker (executes AI-written CadQuery in a child process).
- Evidence:
  - `services/cad-worker/app/sandbox.py:149-168`: the AST walk inspects `ast.Name`, `ast.Attribute`, import aliases, function/lambda arg names, keyword args, except/match-capture *names*. It does **not** inspect `ast.MatchClass` keyword-pattern attribute names (`kwd_attrs`), which are plain strings the interpreter turns into attribute reads via `getattr`.
  - `services/cad-worker/app/runner.py:198`: `make_namespace({"cadquery": cq, "math": math, "cadhelpers": cadhelpers}, log)` hands the model the real top-level `cadquery` module, so every non-denylisted submodule (`cq.selectors`, `cq.cq`, `cq.sketch`, `cq.assembly`, `cq.utils`, …) and anything they import at module scope is reachable by attribute access.
  - `services/cad-worker/app/sandbox.py:40-50`: `BANNED_ATTRIBUTES`/`BANNED_ATTRIBUTE_PREFIXES` is a fixed denylist (`format`, `export*`, `cqgi`, `OCP`, …); any dunder-free, prefix-free attribute on a reachable object is allowed.
  - `lib/cad/validate.ts:91-96`: the TS pre-check is also regex denylist only.
- Proven locally (pure Python, `python3 -I`, no network), without quoting the payloads here:
  - `sandbox.validate()` ACCEPTS a `match`/`case` class-pattern whose keyword-pattern attribute name is a dunder; at runtime under the restricted builtins this binds a local to a dunder attribute of the subject (e.g. its class), re-opening the introspection path the name/attribute checks were meant to close.
  - pyparsing 3.x `ParserElement.parse_file(path)` opens and reads an arbitrary file and places its full contents in the resulting exception's `.pstr`; pyparsing is a CadQuery dependency reachable through the exposed `cadquery` object. A model that triggers such a parse and catches the exception can read file contents (the child env is scrubbed of secrets, but this still reads the container filesystem).
- Impact: with defence-in-depth intact (child process, rlimits, `block_network`, scrubbed env, 45 s kill, and — critically — Cloud Run gVisor + an SA with no roles + no-unauthenticated/`CAD_WORKER_TOKEN`), a static-check bypass yields in-sandbox file read / introspection, not host compromise. The static check must not be relied on as a security boundary on its own, and `block_network` is applied inside the same `exec` namespace it is protecting.
- Fix:
  - Treat sandbox.py as a convenience filter, not a boundary; keep the runtime controls as the real boundary and document that in the README (the current README calls the layers collectively "the sandbox").
  - Strengthen the static check: reject `ast.Match` (or inspect `MatchClass.kwd_attrs`/`MatchMapping.keys` for dunder/banned names); switch imports/attributes to an allowlist of cadquery surface rather than a denylist; or run the model against a stub cadquery facade exposing only the needed classes instead of the full package.
  - Confirm production is deployed `--no-allow-unauthenticated` with `CAD_WORKER_TOKEN` set and the zero-role SA (docs/CAD_CLOUD.md:79 shows this; deployment not verifiable from the repo — mark unverified).
- Test: add sandbox unit tests asserting `check()` rejects `match`-statement dunder keyword patterns and `parse_file`/file-reading attribute chains; a worker test asserting an attempted file read returns `ok:false` with no file contents in `error`/`log`.

### AI-04 — Medium — `/api/cad` forwards the client's `x-vercel-oidc-token` header as the WIF subject token (checked at coordinator's request)
- Evidence:
  - `app/api/cad/route.ts:116`: `oidcToken: request.headers.get("x-vercel-oidc-token")` — the **incoming request** header, passed into `runCloudCad`.
  - `lib/cad/cloud-flow.ts:228,257`: forwarded as `{ oidcToken: ctx.oidcToken }` to `buildWithRetry`.
  - `lib/cad/cloud.ts:106-108`: `vercelOidcToken(passed)` returns `passed.trim()` first when truthy, ahead of the Vercel request-context value and `process.env.VERCEL_OIDC_TOKEN`.
  - `lib/cad/cloud.ts:165-174`: that value becomes `subjectToken` in the Google STS token-exchange.
- Confirmation: a client-supplied header value **does** reach the STS exchange; it overrides the server's own OIDC token. It is not logged (cloud.ts:17 comment; `googleError` records status/code only). The read is reachable only from `/api/cad` (studio enclosure/unlock/product routes store JSON and never call the cloud path).
- Assessment: not a direct escalation as long as the WIF provider's trust conditions (issuer/audience/attribute) accept only Vercel-issued OIDC tokens for this deployment — an arbitrary attacker token then fails STS and the build simply falls back to the browser path. The residual risks are: (a) if the WIF provider is configured permissively, a client could substitute a token they control to mint SA credentials; (b) a server-controlled secret (the platform OIDC token) is being overridden by untrusted client input for no functional reason. The request-context/env fallbacks already supply the correct token on Vercel.
- Fix: stop reading the token from the client request — drop the `oidcToken: request.headers.get(...)` argument and let `vercelOidcToken()` read the Vercel request context / env only. Separately, verify (ops) that the WIF provider's attribute conditions pin the Vercel project/issuer.
- Test: route test asserting the cloud build path ignores a caller-supplied `x-vercel-oidc-token` header (the value sent to the STS mock equals the env/context token, not the header).

### AI-05 — Medium — wiring charge is a check-then-spend in app code with the model result already returned, so a race or a `spend` failure yields free wiring
- Evidence:
  - `app/api/netlist/route.ts:47-59`: `canUse("wiring")` → `buildElectronics` → `spend(...)`; the response returns `charged: paid.ok ? paid.charged : false` regardless of whether the spend succeeded.
  - `app/api/studio/wiring/route.ts:57-83` and `app/api/bom/electronics/route.ts:51-62`: same shape — `canUse` then (after work) `spend`.
  - `lib/credits/server.ts:43-62`: `spend` swallows a missing-RPC error as `{ok:true,charged:false}` and logs other failures but the route still returns the result.
  - Contrast `cad_deliver` (0043:141, 0090:103), which does `spend_credit` and the status flip atomically under `for update`; wiring has no equivalent single RPC.
- Exploit: `canUse` only checks `balance >= 1` (0096:308) without locking; two concurrent wiring calls on a 1-credit project both pass `canUse`, both build, and `spend_credit` serialises on the advisory lock so one charges and the other raises `no_credits` — but the route has already produced and saved the circuit and returns it. Net: the second circuit is delivered unpaid. Also, any `spend` RPC error path returns the circuit with `charged:false`.
- Fix: make wiring atomic like CAD — a `wiring_deliver`-style RPC that re-checks the balance and spends in one SECURITY DEFINER call under `for update`, called before the circuit is returned; or have `canUse`+`spend` share one advisory-locked RPC. At minimum, treat a `spend` failure other than admin/`none` as a hard error and do not return the circuit.
- Test: PGlite concurrency test — two parallel `spend_credit('wiring', p)` on a 1-credit project, assert exactly one `charged:true` and a ledger of −1; route test asserting a spend error does not return a netlist.

### AI-06 — Medium — ideation-token cost is derived from client-supplied `current`/`spec`, so a caller can steer the price down
- Evidence:
  - `app/api/studio/spec/route.ts:33-39`: `current = body.current`; `cost = turnCost({ started, editTurnsSoFar, current })`.
  - `lib/studio/tiers.ts:101-111`, `125-128`: `turnCost`/`regenCost` multiply by `tierOf(current)/tierOf(spec).multiplier` — tier comes entirely from the client-sent spec.
  - `app/api/studio/product/design/route.ts:50-54`: `cost = regenCost(regensSoFar, doc.spec)` — here `doc.spec` is server-loaded (good), but `regensSoFar = cur.owned.product?.regens` is from client-writable JSON (see AI-01).
- Exploit: in the spec route, send a low-tier `current` (e.g. `explorer`) to pay the explorer multiplier while the saved card is a higher tier; the charge tier is `tierOf(after)` but the *amount* uses `cost` computed from the client `current`. Combined with AI-01, a direct PATCH setting `regens` to 0 keeps design regenerations in the free band.
- Fix: compute token cost from the server-stored spec/`idea_sessions` row, not from the request body; keep `regens`/`edit_turns` server-owned (AI-01). The SQL `idea_token_charge` already clamps amount 0..20 and ignores admin, but trusts the amount the route passes.
- Test: route test sending a mismatched low-tier `current` and asserting the charged amount matches the server-stored tier.

### AI-07 — Low — CAD credit cost (tier) is derived from user-controlled input
- Evidence: `app/api/cad/route.ts:89` `classifyCadRequest(asked)` (tier from the request text); `app/api/studio/enclosure/route.ts:66` and `product/unlock/route.ts:62` `studioCadTier(components.length)` — part count from the client doc. `cad_tier_cost` maps simple/standard/complex → 1/2/3 (0090:20-23).
- Impact: a user can phrase a complex request to classify as "simple" and pay 1 credit instead of 3; the worker still builds it (subject to the 45 s/size caps). Revenue leak, not an auth issue.
- Fix: owner decision — accept it, or derive tier from the produced geometry (worker bbox/part count) before `cad_deliver` takes the extra credits.
- Test: n/a (pricing policy).

### AI-08 — Low — guest design limit is non-atomic and fails open; signed-in users have no per-day design cap
- Evidence: `lib/studio/server/product.ts:151-168` `guestDesignLimit` does `hits` then `bump` (read-then-write, no lock) and returns `allowed:true` on any store error or missing service key; `app/api/studio/product/design/route.ts:42-45` applies it only `if (isAnonymous)`. Signed-in users hit only the global Gemini guard.
- Impact: concurrent guest requests can exceed 3/day; a logged-in user can call the (token-gated but see AI-06) design endpoint without a per-day ceiling.
- Fix: atomic increment (the `bom_rate_check` upsert pattern) and a per-user cap or rely on token balance once AI-06 is fixed.
- Test: concurrency test on `guestDesignLimit`.

### AI-09 — Low — `/api/brief-chat` and `/api/transcribe` accept guests with no Turnstile and no per-user/IP rate limit, only the shared daily quota
- Evidence: `app/api/brief-chat/route.ts:28-51` (session + global `quota` only); `app/api/transcribe/route.ts:27-53` (session + Groq `quota` only). `/api/analyse` gates guests with Turnstile (analyse route 69-72) and `bomRate`; these two do not.
- Impact: an anonymous session (cheap to mint) can burn the shared free Gemini/Groq allowance for all users (the daily guard then pauses the feature for everyone). DoS / quota exhaustion.
- Fix: apply `bomRate` (or a dedicated per-user/IP limit) and the Turnstile check to brief-chat and transcribe for anonymous sessions.
- Test: route test asserting an anonymous caller is rate-limited after N calls.

### AI-10 — Low — several AI routes read the request body without zod (type-confusion / oversized input)
- Evidence: `/api/brief-chat` (cast only), `/api/netlist` (`projectId` any string), `/api/bom/electronics`, `/api/bom/match`, `/api/project-cad` (manual `String().slice`). Lengths are sliced but shapes are trusted.
- Impact: low (downstream `.eq()` and RLS contain it), but inconsistent with the studio routes and a latent source of bugs.
- Fix: parse every body with a zod schema as the studio routes do (`studioRequest`).

### AI-11 — Low — `/api/project-cad` has no rate limit and emails the owner on every call
- Evidence: `app/api/project-cad/route.ts:22-142`; no `bomRate`/quota; `sendEmail` to `OWNER_EMAIL` per request after the owner/path checks.
- Impact: an owner can be used to flood the owner inbox / lead table (one row + one email per call). Minor.
- Fix: debounce per project, or a small per-user rate limit.

### AI-12 — Info — studio AI usage logging fails constraint checks before 0068/0088 and is best-effort
- Evidence: `lib/studio/server/context.ts:5-8` and `lib/ai/usage.ts:17-19` — feature `"studio"` is rejected by the `ai_usage`/`analysis_runs` CHECK until 0068 runs; `logUsage` only warns. So before those migrations, studio calls are unmetered (the daily guard can't see them). Acceptable per the documented migration-gating pattern; listed for completeness.

### AI-13 — Info — `analysis_runs` rows are client-insertable; reuse hinges on server-computed `request_hash`
- Evidence: `supabase/migrations/0024_project_diagnostics.sql:56-58` grants INSERT to owners (`with check (owns_project(project_id) and (user_id is null or user_id = auth.uid()))`). A user could pre-insert a row with a chosen `request_hash` and `parsed_response`; `/api/analyse:103` re-parses the stored value through `AnalysisSchema` before reuse, so the worst case is a self-served (already free) analysis. No charge is tied to analyse, so impact is nil — but if a paid feature ever reuses from this table, the client-controlled rows would matter.

### AI-14 — Info — `/api/transcribe` has no `maxDuration` and the quota guard is the only backpressure
- Evidence: `app/api/transcribe/route.ts:19` sets only `dynamic`; the Groq fetch uses `request.signal` (client abort) but no server timeout. A slow upstream holds the function for the platform max. Minor; the audio size cap (4 MB) bounds payload.

### AI-15 — Info — SVG shown via `dangerouslySetInnerHTML` is server/rule-generated, not model-authored
- Evidence: `components/studio/steps/wiring/SchematicFrame.tsx:454`, `components/prototyping/schematics-stage.tsx:320`, `components/prototyping/svg-frame.tsx:111`. All three render SVG produced by `lib/studio/schematic.ts` / `lib/prototyping/schematic.ts`, which escape text with `esc()` (schematic.ts:204,509,525,628,634,639-649) from template strings — no model/user HTML string reaches the sink. The AI produces netlist/structure JSON, not the SVG. `project_schematic_revisions.svg` is RLS-scoped to the owner (0020:236-241) and the prototyping page is super_admin-only (prototyping/page.tsx:48). Checked, safe — provided the drawing library is never changed to pass user HTML through.

### AI-16 — Info — provider keys are server-only; no `NEXT_PUBLIC_` secret leak found
- Evidence: `GEMINI_API_KEY`/`GROQ_API_KEY` referenced only in server modules (`gemini-client.ts:42`, `transcribe/route.ts:36`, admin pages) and only as booleans on the dashboard (`dashboard/usage/page.tsx:175-176`). `NEXT_PUBLIC_*` vars are all non-secret (Supabase URL/anon, Turnstile site key, Google client/app id, GA id, site URL). `lib/admin/project-export.ts:48-66` redacts live key values and key-shaped patterns from exports. Error paths return provider status/code only (`cloud.ts:121-131`, `gemini-client.ts:94-95`), never the key. Checked, safe.

---

## 3. DATA-FLOW NOTE (AI paths)

Brief path: client brief → `POST /api/analyse` (RLS user; Turnstile for guests; `bomRate`) → `loadProvider`/`callGemini` (Gemini, `GEMINI_API_KEY`) → zod (`Disciplines/Requirements/AnalysisSchema`) → stored raw+parsed in `analysis_runs` (feature `analyse`, 0024; `request_hash` 0099) → metered in `ai_usage` via `log_ai_usage` (0023/0088). Reuse: newest `analysis_runs` row with matching `request_hash`, re-validated, no provider call.

Studio product path: `projects.studio` (JSONB, 0068; `studio_version` optimistic lock) holds the page doc; server-owned `studio.product` (page-safe) + `studio.productPrivate` (models) are merged in by `saveDoc`/`mergeServerOwned` (private.ts) — but only on the route path (AI-01). Steps: spec chat (`/studio/spec`, ideation tokens `idea_sessions`/`credits_ledger` kind `idea`/`idea_pass` via `idea_token_status`/`idea_token_charge`, 0088/0089) → parts `/studio/pick` (library-constrained, `bomRate`) → wiring `/studio/wiring` or `/api/netlist`/`/api/bom/electronics` (`wiring` credit via `credit_can_use`/`spend_credit`, 0042/0052/0096) → enclosure `/studio/enclosure` + mech `/studio/mech` (CAD credit via `cad_begin`/`cad_set_code`/`cad_deliver`, 0043/0090; `cad_generations`) → product designs `/studio/product/design` (vision `/check`, choose, preview to `project-images` bucket under `studio-previews/<pid>/<did>.png` via service role) → unlock `/studio/product/unlock` (CAD credit) → `/studio/product/model` gated on `unlockedId`.

CAD code path: `/api/cad` → `cad_begin` (pending `cad_generations` row, re-checks `credit_can_use` + 24 h cap) → Gemini writes OpenSCAD or (cloud engine) CadQuery, `validatedCall` + `validateScad`/`validateCadQuery` → **browser engine:** code to the browser, which renders (OpenSCAD WASM) and calls `cad_deliver` to spend; **cloud engine:** `runCloudCad` → Google WIF (`GCP_WIF_PROVIDER`+`GCP_CAD_SA_EMAIL`, else `GCP_CAD_SA_KEY`) mints an ID token (audience `GCP_CAD_URL`) → `POST {GCP_CAD_URL}/build` (optional `CAD_WORKER_TOKEN`) → worker runs the code in `python -I runner.py` child (static check, rlimits, no-network, scrubbed env) → STEP/STL/SVG+manifest uploaded to the `cad-files` bucket (`CAD_BUCKET`) → `cad_deliver` spends server-side. OIDC subject token can be influenced by the client header (AI-04).

Tables/buckets/RPCs touched: `projects(.studio,.studio_version,.bom,.netlist,.firmware,.build_route,.spec, credit cols)`, `cad_generations`, `analysis_runs`, `ai_usage`, `ai_rate_limits`, `credits_ledger`, `idea_sessions`/`idea_passes`, `sourcing_gaps`, `demand_signals`, `inquiries`, `project_schematic(_revisions)`; buckets `cad-files`, `project-images`; RPCs `credit_can_use`, `spend_credit`, `cad_begin/set_code/deliver/fail`, `set_cad_request`, `bom_rate_check`, `idea_token_status/charge`, `log_ai_usage`, `ai_usage_totals`, `log_sourcing_gap`, `record_bom_demand`. Env: `GEMINI_API_KEY`, `GEMINI_MODEL/FALLBACK_MODEL`, `GROQ_API_KEY`, `GROQ_WHISPER_MODEL`, `GCP_CAD_URL`, `GCP_WIF_PROVIDER`, `GCP_CAD_SA_EMAIL`, `GCP_CAD_SA_KEY`, `CAD_WORKER_TOKEN`, `VERCEL_OIDC_TOKEN`, `AI_RATE_SALT`, `AI_LIMIT_*`, `AI_GUARD_THRESHOLD`.

---

## 4. CROSS-CUTTING

- Duplicated provider-call code: `/api/firmware` and `/api/studio/firmware` both call `callGemini` directly with near-identical system prompts and their own `logUsage`, instead of `validatedCall`; `/api/brief-chat` is a third hand-rolled Gemini caller. Three slightly different error-mappings result (brief-chat returns 502 for `paused`, while `validatedCall`-based routes map `paused`→429 via `callErrorStatus`). Consolidate on `validatedCall`/`studioCall`.
- Inconsistent error shapes: `{error}` strings vs NDJSON (analyse), different HTTP codes for the same condition (`paused` → 429 in cad/studio, 502 in brief-chat; `not_ready` 409 vs 503). A shared mapper (http.ts `callErrorStatus`/`creditDenied`) exists but is not used by the standalone routes.
- Missing/loose timeouts: `/api/transcribe` has no `maxDuration` and no server-side upstream timeout; `callGemini` uses a 25 s default but `validatedCall` passes 90 s and studio 45 s — fine. Cloud worker calls are bounded (60 s) and auth calls (10 s).
- Charge ordering is inconsistent: CAD/enclosure/unlock spend atomically via `cad_deliver` before responding (good); wiring/netlist/bom-electronics check-then-spend in app code after producing the result (AI-05).
- Body validation is inconsistent: studio routes use zod via `studioRequest`; analyse/cad use zod; brief-chat/netlist/bom/project-cad do not (AI-10).

---

## 5. TEN-LINE SUMMARY OF THE WORST ISSUES

1. AI-01 (High): `projects.studio` is client-readable/writable via PostgREST, so owners can read private design models and forge `unlockedId`/`regens` — bypassing the CAD paywall and regen charges. The route-layer `mergeServerOwned` guard does not protect direct DB access.
2. AI-02 (High): `/studio/product/check` (and `/design`) return the full design `model` without a credit; since STLs are built client-side from it, the "Create my CAD" unlock credit buys nothing already obtainable.
3. AI-03 (High): the cad-worker static check is a denylist with two confirmed bypasses (match-statement dunder keyword patterns; pyparsing `parse_file` file read) over a namespace exposing the real `cadquery`; it must not be treated as the security boundary — the runtime/gVisor/IAM controls must be (deployment hardening unverified).
4. AI-04 (Medium): `/api/cad` forwards the client's `x-vercel-oidc-token` header as the WIF subject token (confirmed reachable); safe only if the WIF provider trust is strictly pinned — the header pass-through should be removed.
5. AI-05 (Medium): wiring credit is check-then-spend in app code after the circuit is already built and returned; a race or a `spend` failure yields unpaid circuits (CAD does this atomically, wiring does not).
6. AI-06 (Medium): ideation-token cost is computed from the client-supplied `current` spec (and client-writable `regens`), letting a caller pay a lower tier than the saved build.
7. AI-07 (Low): CAD tier/price is derived from user-controlled request text / part counts — a revenue leak.
8. AI-08/09 (Low): guest design limit is non-atomic and fails open with no signed-in cap; brief-chat and transcribe accept guests with no Turnstile and only the shared daily quota — anonymous sessions can exhaust the free provider allowance for everyone.
9. Good: provider keys are server-only, no `NEXT_PUBLIC_` secret leak, exports redact keys, error messages carry status/code only, and the SVG `dangerouslySetInnerHTML` sinks render only escaped rule-generated markup (AI-15/16).
10. Unverified: production deployment of the cad-worker (`--no-allow-unauthenticated` + `CAD_WORKER_TOKEN` + zero-role SA) and the WIF provider's attribute conditions cannot be checked from the repo; both must be confirmed in GCP/Vercel.
