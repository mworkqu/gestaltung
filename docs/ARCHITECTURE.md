# CAD Champions: architecture

CAD Champions (أبطال التصميم بالحاسوب) is a training platform for the Mechanical Engineering CAD skills competition. It lives inside the gestaltung360.com Next.js app as a route section. It must never change or restyle the rest of the site.

## Decisions (owner, 2026-10-14)

**`docs/COMPETITION_ALIGNMENT.md` overrides any older task text where they conflict.** It aligns the platform with the official Mechanical Engineering CAD technical descriptions (PDFs in `docs/reference/`, never copied into the site). Three software tracks: Inventor (recommended, default), Fusion, SOLIDWORKS.
| Topic | Decision |
|---|---|
| Integration | Option 1: a route section inside the existing app. One deploy, one login, one Supabase project. |
| URLs | Public URLs are `/cad-champions/{en,ar}/…`. Internally they map to `app/[locale]/cad-champions/…`. |
| Default language | English. A visitor who picks Arabic keeps it on every visit. Order: `cc_profiles.preferred_locale` (Prompt 2), then the `cc_locale` cookie, then `en`. Browser language is not used. |
| Accounts | Each CC account has a row in `cc_profiles`, keyed by the same auth user id. The site's `profiles` table and its roles are not touched. CC roles are student / instructor / admin. A site `super_admin` is treated as CC admin. Every CC table is prefixed `cc_`. |
| Design | The site's light neomorphic tokens (`DESIGN.md`, `app/globals.css`). |
| Payments | Fawran is a manual proof upload that an admin approves. SkipCash comes later behind the same interface (Prompt 10). |
| Indexing | Every CC route is noindex (meta robots plus the `X-Robots-Tag` header) until Prompt 12. |
| Git | Work happens on branch `cad-champions` and is checked on Vercel preview deployments. It is never pushed to main without the owner's go-ahead. |

## How a request flows
1. `middleware.ts` runs a CC branch first. The decision logic is pure code in `lib/cad-champions/cc-routing.ts`. It handles only these paths:
   - `/cad-champions` or `/cad-champions/<not-a-locale>/…` → 307 redirect to `/cad-champions/<locale>/…`, using the locale from `resolveCcLocale()`.
   - `/cad-champions/{en,ar}/…` → rewrite to `/{locale}/cad-champions/…`, with the next-intl locale header and `X-Robots-Tag: noindex, nofollow`.
   - `/{en,ar}/cad-champions/…`, the internal form → 308 redirect to the public form.

   Every other path runs the original middleware unchanged: next-intl, site_v2, then the Supabase session refresh.
2. `app/[locale]/layout.tsx`, the site root layout, sets `<html lang dir>` from the locale. Arabic CC pages therefore get `lang="ar" dir="rtl"` from the same code that already serves `/ar/*`. Main-site pages are not affected.
3. `app/[locale]/cad-champions/layout.tsx` adds the following:
   - the CC font wrapper (IBM Plex Sans with IBM Plex Sans Arabic; line-height 1.5 for English and 1.7 for Arabic)
   - its own `NextIntlClientProvider`, holding the site base messages plus `CC.*`
   - the toast provider
   - the CC header and footer
   - noindex metadata

   `HeaderGate`, `FooterGate` and `TrustGate` hide the site chrome on `/cad-champions`.

## Folders
| Path | What |
|---|---|
| `app/[locale]/cad-champions/` | CC pages, plus `not-found`, `error`, a `[...rest]` catch-all and the dev gallery `dev/ui` (404 in production unless `CC_DEV_GALLERY=1`). |
| `components/cad-champions/ui/` | The CC UI kit: Button, Card, StatusChip, Alert, HelpTip, Term, EmptyState, Skeleton*, Spinner, Toast, ConfirmDialog, Stepper, PageHeader, NeedHelpButton. The site's `components/ui` is separate and untouched. |
| `components/cad-champions/shell/` | CC header, footer, language switcher and the signed-in extras (Need help). |
| `lib/cad-champions/` | Shared code (see below). |
| `messages/cad-champions/{en,ar}/*.json` | CC strings, merged by `i18n/request.ts` under the `CC` namespace (`CC.shell`, `CC.pages`, `CC.errors`, `CC.ui`, `CC.gallery`). The site's `messages/{en,ar}.json` are untouched. |
| `scripts/cc-i18n-check.mjs` | `npm run i18n:check`: en/ar key parity. CC files fail on a mismatch; the site files only warn. |
| `scripts/cc-rtl-check.mjs` | Fails on physical Tailwind classes (`ml-`, `mr-`, `left-`, `text-left`, …) in CC code. It runs as part of `npm run lint`. |

The shared code in `lib/cad-champions/` is:
- `routes.ts`: `ccPath`
- `cc-routing.ts` and `locale.ts`: routing and locale choice
- `format.ts`: Western digits, Asia/Qatar dates, QAR, file sizes
- `ltr.tsx`: the `<Ltr>` wrapper for codes, file names and units
- `glossary.ts`: 31 terms in English and Arabic
- `analytics.ts`: `track()`, which logs in dev and is a no-op in production
- `site-contact.ts`: WhatsApp and support email
- `tokens.ts`: design tokens

## Rules for later prompts
- Build links with `ccPath(locale, "/x")`. Never use the site's next-intl `Link`, which produces the internal `/ar/cad-champions` form.
- Put every string in `messages/cad-champions/*`. After any change, run `npm run i18n:check` and `npm run lint`.
- Use logical Tailwind utilities only.
- New tables are prefixed `cc_`, with RLS on. Do not touch the existing `profiles` table, its roles, or the RLS of existing tables.
- `services/cad-worker/` already holds a Python CadQuery worker on Google Cloud Run, used by the store's CAD generation (`docs/CAD_CLOUD.md`). Prompt 6 (STEP auto-grader) should review it before creating a new service. It may reuse the base image, the deploy steps and the keyless Vercel→GCP auth (`lib/cad/cloud.ts`). The grader would still be its own service (`/grader`), so the store's CAD worker stays unaffected.
