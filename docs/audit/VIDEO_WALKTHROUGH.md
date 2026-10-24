# Walkthrough outline (10–15 minutes, screen recording)

1. Scope and rules kept (1 min): read-only audit of main 88a6473; no push, no deploy, no migration
   run, no production data; all proposed changes live on a local branch and in the diffs here.
2. Method (1 min): four parallel security reviews (database/RLS/RPC/storage, API routes and server
   actions, AI/CAD routes and credits, web layer), two code-quality reviews, every fix re-reviewed by
   a fresh reviewer that tried to break it. Show BASELINE.md → FINAL_REPORT.md.
3. The High findings (5 min), one minute each, showing the evidence line in the repo:
   - projects.studio private models readable / unlock forgeable through PostgREST (DB-01).
   - log_ai_usage: one call pauses all AI features for everyone (DB-02).
   - stored XSS against the super admin via schematic SVG (WEB-01).
   - payment auto-approval from an unverified screenshot (API-01) and the service-job consequence.
   - CAD voucher path via client-callable cad_set_code (G-C1).
   - AI-02 (model reaches the browser before unlock) and AI-03 (sandbox is a filter) as decisions.
4. Proposed fixes (3 min): open proposed-migrations/0100 and 0103, show a PGlite test that fails
   before and passes after; show the headers() CSP (report-only) and the admin page guard test.
5. Code quality (2 min): cycles 20 → 0, the one-home primitives table, checkout maths into a tested
   module, CLAUDE.md 1,624 → 295 lines with history preserved, test count 3,246 → 3,855.
6. What needs the owner (2 min): the decision table in FINAL_REPORT §6 — payments, Studio model
   exposure, class benefits, legacy v1 pages and Engineer view; migration run order; CAPTCHA state.
7. Close (30 s): where everything is saved (this folder), and that no code was changed in the
   owner's repository.
