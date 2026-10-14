# CAD Champions: brief for every build agent (read fully before coding)

Repo root: `C:\Users\mmamr\Desktop\projects\Gestaltung company webpage\Gestaltung — a manufacturing marketplace and inventory platform for Qatar`. The path has spaces and an em-dash, so always quote it. Windows; Git Bash is available. Branch `cad-champions`. **Never push to main.** Commit only when your task brief says so. The orchestrator normally commits.

The owner's full plan, including the PROJECT CONTEXT block and Prompts 1–12, is in `docs/cad-champions/PROMPTS.md`. Your task names the prompt and steps to build. Follow them exactly, except where an owner decision below overrides them.

## Owner decisions (override the plan text)
0. **Competition alignment:** read `docs/COMPETITION_ALIGNMENT.md` first. It wins over PROMPTS.md wherever they conflict (three tracks inventor|fusion|solidworks with Inventor default and recommended; 4 competition modules M1–M4 as data; measurement vs judgement 0–3 marking via cc_task_aspects; per_task vs module_package uploads; in-person session mode; drawing rubric accepts first OR third angle). Its section P lists what changes per prompt. Never copy text from the PDFs in docs/reference/.
1. **Language:** English is the default (NOT Arabic).
   - Locale order: `cc_profiles.preferred_locale` (signed in) → `cc_locale` cookie → `en`. Never use Accept-Language.
   - The language switcher updates the cookie, and the profile too when signed in.
2. **Accounts:** CC profile data lives in `cc_profiles` (id = auth.users.id), NOT the site `profiles` table. Never alter `public.profiles`, its role constraint or its RLS.
   - CC roles: student / instructor / admin.
   - A site `super_admin` (`public.profiles.role = 'super_admin'`, helper `public.is_super_admin()`) is automatically a CC admin.
   - Every CC table is prefixed `cc_`. The plan's column `profiles.track_software` is `cc_profiles.track_software`.
   - One login can have both a site profile and a CC profile.
3. **Design:** the site's light neomorphic tokens (`DESIGN.md`, `app/globals.css`: `.neu`, `.neu-inset`, `.tile`, `.kicker`, cobalt accent).
4. **Payments:** Fawran is a manual proof upload plus admin approval (Prompt 10). SkipCash is built but disabled.
5. **noindex:** every CC route stays noindex until Prompt 12 (middleware header plus layout metadata, already in place).
6. **Migrations:**
   - SQL lives in `supabase/migrations/NNNN_cc_*.sql`. Find the next free number with `ls supabase/migrations`. 0076 was the last before CC.
   - The OWNER runs migrations by hand in Supabase. **Never run SQL against the real database.** `.env.local` points at PRODUCTION Supabase, so do not write to it from scripts or tests either.
   - Every migration must be idempotent where reasonable and carry a header comment saying what it does and "RUN AFTER NNNN".
   - The app must degrade gracefully before a migration has run: a friendly "being set up" state, never a crash.
7. **External paid services** (Anthropic, Bunny, SkipCash, Sentry, Google Cloud) are gated by env vars. Without a key the feature shows a clear disabled state. Never create accounts or keys.

## Where things live (Prompt 1 foundation)
| What | Where |
|---|---|
| Public URLs and pages | Public URLs are `/cad-champions/{en,ar}/…`; middleware rewrites them to `app/[locale]/cad-champions/…`. Build links with `ccPath(locale, "/x")` from `lib/cad-champions/routes.ts`. NEVER use the site's next-intl `Link`/`redirect` (they produce the internal `/ar/cad-champions` form). Use `next/link` and `next/navigation` with ccPath URLs. |
| Middleware decisions | `lib/cad-champions/cc-routing.ts`; locale choice in `lib/cad-champions/locale.ts` (`resolveCcLocale`). |
| Layout | `app/[locale]/cad-champions/layout.tsx` provides `NextIntlClientProvider` with all `CC.*` messages and a `ToastProvider`. The site `[locale]` layout sets `<html lang dir>`. |
| UI kit | `components/cad-champions/ui` (index.ts barrel): `Button` (variant primary/secondary/ghost/danger, loading, loadingText, disabledReason), `Card`, `StatusChip`, `Alert`, `HelpTip` (label, children, learnMoreSlug), `Term` (id: GlossaryId), `EmptyState`, `SkeletonText`/`SkeletonCard`/`SkeletonTableRows`, `Spinner`, `useToast` (success/error/info), `ConfirmDialog`, `Stepper`, `PageHeader` (title, purpose, help, actions), `NeedHelpButton`. Read the source before using it. |
| Shell | `components/cad-champions/shell/*`: `cc-header`, `cc-footer`, `language-switcher`, `signed-in-extras` (NeedHelpButton wrapper), `placeholder-page`. |
| Lib | `lib/cad-champions/*`: `format.ts` (formatNumber, formatDate, formatDateTime, formatQAR, formatFileSize: Western digits, Asia/Qatar), `ltr.tsx` (`<Ltr>`), `glossary.ts`, `analytics.ts` (`track`, `CC_EVENTS`; add new events in `analytics-events.ts`), `site-contact.ts` (`getCcContact`, `buildWhatsAppUrl`), `tokens.ts`, `metadata.ts`. |
| Strings | `messages/cad-champions/{en,ar}/<file>.json`, merged under `CC.<file>`. To add a file: create it in BOTH locales AND add its name to `CC_MESSAGE_FILES` in `i18n/request.ts`. Use `getTranslations({ locale, namespace: "CC.<file>" })` or `useTranslations("CC.<file>")`. `lib/cad-champions/messages.test.ts` checks that literal keys exist. |
| Existing site infra to REUSE | Supabase clients `lib/supabase/{client,server,service}.ts`; email `lib/email.ts` + `lib/email/brand-layout.ts` (Resend); rate limit `lib/rate-limit.ts`; Turnstile `lib/turnstile*.ts`; phone validation `lib/phone.ts`. Read them; don't duplicate. |

## Hard rules
- **Main site:** nothing outside the CC folders changes unless your brief says so.
- **Tailwind:** LOGICAL utilities only (`ms`/`me`/`ps`/`pe`/`start`/`end`/`text-start`/`text-end`/`border-s`/`border-e`/`rounded-s`/`rounded-e`). `npm run lint` runs `scripts/cc-rtl-check.mjs` and fails on `ml-`/`mr-`/`pl-`/`pr-`/`left-`/`right-`/`text-left`/`text-right`. Directional icons get `rtl:-scale-x-100`.
- **Strings:** every user-facing string comes from the message files (en + ar, identical keys; `npm run i18n:check`). Arabic is natural, friendly Modern Standard Arabic: short sentences, second person, not literal translation. Digits are always Western 0-9. Wrap file names, codes, emails and measurements in `<Ltr>`.
- **Explanation standard** (from the plan's PROJECT CONTEXT), on every page:
  - a PageHeader with a purpose sentence
  - HelpTip or Term on technical terms
  - an empty state for every list
  - a loading state for every async action (skeletons for pages, spinner + text for buttons, progress bars for uploads)
  - errors that say what happened, what to do next, and link help where useful; never show raw errors (log them with `console.error`)
  - a success toast or screen that says what happens next
  - a ConfirmDialog for irreversible actions
  - the NeedHelpButton on signed-in pages
- **Trademark:** never use "WorldSkills" in titles, URLs or brand. In body text it may appear only alongside the disclaimer.
- **Placeholders:** never invent facts, prices, dates, policies or bios. Use `[TODO-MO: …]` placeholders and add each one to `docs/CONTENT_TODO.md` (file + page). Write help text, tooltips, empty states and errors yourself in both languages.
- **Server safety:** every server action and route checks auth and role server-side. Never send secrets to the client (only `NEXT_PUBLIC_*` vars reach the browser).
- **Accessibility:** keyboard reachable, visible focus, aria labels, 44px touch targets, WCAG AA contrast. Mobile-first at 360px.
- **Tables:** a repo test requires `overflow-x-auto` within 3 lines above any `<table`. Don't write the literal string `<table` in comments.
- **Tests:** vitest only includes `lib/**`, so put pure logic in `lib/cad-champions/**` with `*.test.ts` next to it. Playwright e2e lives in `e2e/` with a write guard: never let a test write to production Supabase.
- **New env vars:** add each one to `.env.example` with a comment.

## Before you finish
Run these and fix what you broke:
- `npx tsc --noEmit -p .`
- `npm run lint`
- `npm run i18n:check`
- `npx vitest run lib/cad-champions` (plus any other folders you touched)

Do NOT run `next dev` or `next build` unless your brief says so (the orchestrator does). Your final message lists:
- files created and changed (flag main-site files)
- migrations written (name + what it does)
- env vars
- `[TODO-MO]` placeholders
- anything left undone
