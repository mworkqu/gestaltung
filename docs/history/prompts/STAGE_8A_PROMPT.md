# Stage 8A — Security Review + Quick Conversion Wins

Read CLAUDE.md for full project context before starting. Stack: Next.js 15 App Router, TypeScript, Tailwind, shadcn/ui, next-intl, Supabase. Stages 1–7 are complete and live.

---

## Part 1: Security & Code Review

Audit the codebase and produce a `SECURITY_REVIEW.md` in the project root. Cover:

**Auth & Session**
- `lib/supabase/middleware.ts` — verify `updateSession` runs on all protected routes; check for auth bypass edge cases
- `lib/auth/get-session.ts` — confirm server-side session reads are not cacheable across users (no `cache: 'force-cache'` on auth calls)
- `app/[locale]/dashboard/*` — verify every page/layout has an auth gate; look for routes that rely solely on UI hiding instead of server-side redirect

**Server Actions**
- `app/[locale]/dashboard/inventory/actions.ts`
- `app/[locale]/dashboard/jobs/actions.ts`
- Confirm every action uses the server Supabase client (not the browser client); confirm no service-role key is used in actions; confirm input is validated before DB write

**RLS**
- Review `supabase/migrations/0001–0007` for: policies that use `auth.uid()` correctly, no `USING (true)` on sensitive tables, SECURITY DEFINER functions have `search_path=''`

**Dependency Hygiene**
- Run `npm audit --audit-level=high` and list HIGH/CRITICAL findings

**Output format for SECURITY_REVIEW.md:**
```
## Critical   — must fix before next deploy
## High       — fix this stage
## Medium     — fix next stage
## Info       — notes / best practice
```
For each finding: file + line, description, recommended fix.

After writing the report, **apply all Critical and High fixes directly** to the source files. Do not wait — fix them inline.

---

## Part 2: Social Proof Section (Homepage)

File: `app/[locale]/page.tsx` and `messages/{en,ar}.json`

Add a "Trusted By" or "Who We Work With" section between the feature cards and the footer. Keep it minimal and believable for a Qatar-market launch:

- Heading: "Built for Qatar's Engineering Community" (en) / "مبني لمجتمع الهندسة في قطر" (ar)
- Subtext: "Serving engineers, makers, and institutions across Doha and the wider Gulf."
- 3–4 placeholder institution tiles (styled as grayscale logo boxes with text): `Qatar University`, `Texas A&M at Qatar`, `QatarEnergy`, `Qatar Foundation` — clearly marked as illustrative placeholders using a small `*` footnote: "Representative institutions. Partner logos will be shown with permission."
- Design: dark background, faint border tiles, matches existing azure/panel theme. RTL-safe.

All copy via `messages/{en,ar}.json` keys under `Social` namespace. No hardcoded strings.

---

## Part 3: Local Advantage Banner

File: `app/[locale]/page.tsx` (add above or below the feature cards row)

A compact 3-item horizontal strip (stacks to 1 col on mobile):

| Icon | Headline | Subtext |
|------|----------|---------|
| 🏭 | Zero Import Delays | Parts produced inside Qatar — no customs, no 4-week shipping waits. |
| 📦 | Next-Day Delivery in Doha | Workshop network covers Doha, Lusail, and Industrial Area. |
| 🇶🇦 | Qatar-First Pricing | No international freight markups. Pay only for the part and the craft. |

Use lucide-react icons (replace emoji with `Factory`, `PackageCheck`, `ShieldCheck`). All copy in `messages/{en,ar}.json` under `LocalAdvantage` namespace.

---

## Part 4: CAD Design Assistance Service Page

Replace the "AI design — soon" placeholder with a real paid-service page.

**New route:** `app/[locale]/cad-assistance/page.tsx`

**Page content:**
- Hero: "Don't have a CAD file? We'll draw it for you." / "ليس لديك ملف CAD؟ سنرسمه لك."
- Body copy: Describe the service — client sends a sketch, photo, or dimensions via WhatsApp; the team returns a manufacturing-ready STEP/IGES file within 48 hours; starts from 200 QAR.
- Pricing table (3 tiers):
  | Tier | Description | Price |
  |------|-------------|-------|
  | Simple Part | Single-body, no assembly | 200 QAR |
  | Assembly | Up to 5 components | 450 QAR |
  | Complex / Reverse Engineering | From a physical sample or broken part | From 800 QAR |
- CTA: WhatsApp button linking to `https://wa.me/974XXXXXXXX` (use the existing WhatsApp number from the contact form or a `NEXT_PUBLIC_WHATSAPP_NUMBER` env var; fall back to `#contact` if unset)
- All copy in `messages/{en,ar}.json` under `CadAssistance` namespace

**Update nav:** In `components/header.tsx`, add a "CAD Assistance" nav link (between "How it Works" and "About"). Add `Nav.cadAssistance` to `messages/{en,ar}.json`.

**Update homepage hero:** Change the "AI Design — soon" chip/tag to link to `/cad-assistance` and update its label to "CAD Drawing Service — from 200 QAR" / "خدمة رسم CAD — من 200 ر.ق."

---

## Testing Checklist (verify before Stage 8B)

- [ ] `SECURITY_REVIEW.md` exists; all Critical/High items patched
- [ ] `npm audit --audit-level=high` returns zero HIGH/CRITICAL (or all documented)
- [ ] `/en` and `/ar` homepage show Social Proof and Local Advantage sections; AR is RTL-correct
- [ ] `/en/cad-assistance` and `/ar/cad-assistance` render; WhatsApp button works (or falls back cleanly)
- [ ] Header nav shows "CAD Assistance" on both locales
- [ ] Homepage hero chip updated; links to `/cad-assistance`
- [ ] `npm run build` passes with zero TypeScript errors
