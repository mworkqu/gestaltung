# Baseline — audit/code-and-security-2026-10

Recorded 2026-10-22 on a fresh clone of `mworkqu/gestaltung` at `main` = `88a6473`, Node v24.15.0, npm 11.12.1, macOS. No `.env.local` is present in this checkout, so nothing here can reach the production Supabase; the build ran with no Supabase env (pages degrade to their empty states, middleware no-ops).

## Check results

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | **FAIL** — 1 error: `lib/schools/db/schools-migration.test.ts` imports `@electric-sql/pglite`, which is not in package.json or the lockfile |
| Lint | `npm run lint` | pass, 1 warning (unused eslint-disable in `app/[locale]/opengraph-image.tsx:101`) |
| Unit tests | `npm run test` | **FAIL** — 231 files / 3246 tests pass; 1 file fails to load (same PGlite import). `lib/notifications/kinds-sync.test.ts` PASSES on main (the brief expected it to fail; `engineering_job_ready` is already in `lib/notifications/decide.ts` and `lib/email/templates/index.ts`) |
| i18n parity | `node scripts/check-i18n-parity.mjs` | pass — en 5330 / ar 5330 keys |
| Legal pages | `node scripts/split-legal-draft.mjs --check` | pass |
| Build | `npm run build` | pass (3 webpack cache warnings from next-intl's extractor, pre-existing) |
| npm audit (prod) | `npm audit --omit=dev` | 11 vulnerabilities (8 high, 3 moderate); see below |

## npm audit --omit=dev

```
# npm audit report
braces  *
Severity: high
braces vulnerable to stack-exhaustion denial of service through deeply nested patterns - https://github.com/advisories/GHSA-vfj7-8cjw-p6xm
Will install tailwindcss@4.3.3, which is a breaking change
node_modules/braces
  chokidar  2.0.0 - 3.6.0
  Depends on vulnerable versions of braces
  node_modules/chokidar
    tailwindcss  <=0.0.0-oxide-insiders.ff2c25f || 0.5.0 - 3.4.19
    Depends on vulnerable versions of chokidar
    Depends on vulnerable versions of fast-glob
    Depends on vulnerable versions of micromatch
    Depends on vulnerable versions of postcss-nested
    Depends on vulnerable versions of postcss-selector-parser
    node_modules/tailwindcss
  micromatch  >=0.2.0
  Depends on vulnerable versions of braces
  node_modules/micromatch
    fast-glob  *
    Depends on vulnerable versions of micromatch
    node_modules/fast-glob
next  9.3.4-canary.0 - 16.3.0-preview.10
Severity: moderate
Next.js has cache poisoning of SSG and ISR pages in self-hosted applications - https://github.com/advisories/GHSA-4jqv-mc3x-m676
Next.js has cache poisoning in SSG/ISR rendering that leads to cross-user content substitution and persistent denial of service - https://github.com/advisories/GHSA-mcj8-r9mp-w47p
Depends on vulnerable versions of postcss
node_modules/next
postcss  <=8.5.22
Severity: high
PostCSS has XSS via Unescaped </style> in its CSS Stringify Output - https://github.com/advisories/GHSA-qx2v-qp2m-jg93
PostCSS: Arbitrary file read and information disclosure via attacker-controlled sourceMappingURL in CSS comments - https://github.com/advisories/GHSA-6g55-p6wh-862q
PostCSS: incomplete fix of GHSA-6g55-p6wh-862q — attacker-controlled sourceMappingURL reads arbitrary .map files when `from` is unset - https://github.com/advisories/GHSA-fxqj-rqcc-2cmp
PostCSS: Path Traversal in Previous Source Map Auto-Loading (sourceMappingURL) leads to Arbitrary .map File Disclosure - https://github.com/advisories/GHSA-r28c-9q8g-f849
node_modules/next/node_modules/postcss
postcss-selector-parser  <7.1.6
Severity: moderate
PostCSS: Quadratic complexity in flat selector parsing allows CPU exhaustion - https://github.com/advisories/GHSA-rj75-hqrm-r3gf
Will install tailwindcss@4.3.3, which is a breaking change
node_modules/postcss-selector-parser
  postcss-nested  2.0.3 - 6.2.0
  Depends on vulnerable versions of postcss-selector-parser
  node_modules/postcss-nested
sharp  <0.35.5
Severity: high
sharp : Vulnerability in librsvg dependency CVE-2026-96889 - https://github.com/advisories/GHSA-wq5f-xc86-pv6w
node_modules/sharp
source-map-js  1.0.0 - 1.2.1
Severity: high
source-map-js allows event-loop denial of service through indexed source-map section offsets - https://github.com/advisories/GHSA-68fv-2mgg-jv7q
node_modules/source-map-js
11 vulnerabilities (3 moderate, 8 high)
audit exit 1
```

## npm outdated

```
Package                 Current    Wanted   Latest  Location                            Depended by
@playwright/test         1.64.0    1.64.0   1.64.1  node_modules/@playwright/test       gestaltung
@radix-ui/react-slot      1.2.4     1.5.0    1.5.0  node_modules/@radix-ui/react-slot   gestaltung
@react-three/fiber        9.8.1     9.8.1    9.8.2  node_modules/@react-three/fiber     gestaltung
@supabase/ssr            0.10.3    0.10.3   0.12.7  node_modules/@supabase/ssr          gestaltung
@supabase/supabase-js   2.107.0   2.118.0  2.118.0  node_modules/@supabase/supabase-js  gestaltung
@types/node            20.19.41  20.19.43   26.6.5  node_modules/@types/node            gestaltung
@types/react            19.2.15    19.3.0   19.3.0  node_modules/@types/react           gestaltung
@types/react-dom         19.2.3    19.3.0   19.3.0  node_modules/@types/react-dom       gestaltung
@types/three            0.180.0   0.180.0  0.186.0  node_modules/@types/three           gestaltung
autoprefixer             10.5.0    10.6.1   10.6.1  node_modules/autoprefixer           gestaltung
eslint                   9.39.5    9.39.5  10.13.0  node_modules/eslint                 gestaltung
eslint-config-next      15.5.18   15.5.28   16.4.2  node_modules/eslint-config-next     gestaltung
google-auth-library      11.2.0    11.3.1   11.3.1  node_modules/google-auth-library    gestaltung
lucide-react            0.469.0   0.469.0   1.61.0  node_modules/lucide-react           gestaltung
next                    15.5.25   15.5.28   16.4.2  node_modules/next                   gestaltung
next-intl                4.14.5    4.14.9   4.14.9  node_modules/next-intl              gestaltung
postcss                  8.5.28    8.5.31   8.5.31  node_modules/postcss                gestaltung
react                    19.2.6    19.3.1   19.3.1  node_modules/react                  gestaltung
react-dom                19.2.6    19.3.1   19.3.1  node_modules/react-dom              gestaltung
sharp                    0.35.4    0.35.5   0.35.5  node_modules/sharp                  gestaltung
tailwind-merge            2.6.1     2.6.1    3.7.0  node_modules/tailwind-merge         gestaltung
tailwindcss              3.4.19    3.4.19    4.3.3  node_modules/tailwindcss            gestaltung
three                   0.180.0   0.180.0  0.186.1  node_modules/three                  gestaltung
typescript                5.9.3     5.9.3    7.0.2  node_modules/typescript             gestaltung
vitest                   4.1.11    4.1.12    5.0.5  node_modules/vitest                 gestaltung
zod                       4.6.5     4.6.7    4.6.7  node_modules/zod                    gestaltung
```

## Static analysis (npx, not added to package.json)

| Tool | Result |
|---|---|
| knip 5 | 23 unused files (21 are `scripts/*.mjs` run by hand + `components/account-bar.tsx`, `components/payment/home-trust.tsx`, `lib/prototyping/providers/gemini.ts`, `lib/studio/cad-setting.ts`), 382 unused exports, 354 unused exported types, 3 duplicate exports, 1 unused devDependency (`eslint-config-next` — false positive, used via FlatCompat), 4 unlisted dependencies (`three-stdlib`, `@eslint/eslintrc`, `@electric-sql/pglite`, `postcss-load-config`) |
| jscpd (min 70 tokens / 8 lines, app+components+lib, tests excluded) | 88 clones, 1217 duplicated lines (0.90 %), 9012 tokens (0.85 %) |
| madge --circular | 20 import cycles (StudioShell ↔ steps ×13, lib/studio/schema ↔ product/schema ×3, bom ↔ electronics-rules, supabase/types ↔ prototyping/bom, youtube-upload ↔ youtube-retire, netlist ↔ plain-checks, wiring3d layout ↔ rails) |

## Pattern counts (app, components, lib, scripts, i18n, middleware.ts)

```
--- counts
: any|<any>|as any => 15
as unknown as => 97
@ts-ignore|@ts-expect-error => 0
eslint-disable => 65
console\.log\( => 77
TODO|FIXME|HACK => 3
dangerouslySetInnerHTML => 8
SUPABASE_SERVICE_ROLE_KEY|createServiceClient|service\.ts => 76
force-dynamic => 137
revalidateStorefront => 76
```

## Largest source files (lines, tests excluded)

```
  135882 total
    1402 components/studio/steps/wiring/Wiring3DView.tsx
    1387 lib/studio/product/solve.ts
    1370 components/prototyping/workspace.tsx
    1080 components/projects/project-workspace.tsx
    1008 lib/studio/netlist.ts
     965 components/prototyping/bom-table.tsx
     889 lib/studio/schema.ts
     856 components/studio/StudioShell.tsx
     841 components/studio/steps/PartsStep.tsx
     829 lib/studio/wiring3d/layout.ts
     776 components/studio/viewer/Viewer.tsx
     758 lib/studio/schematic.ts
     741 lib/studio/geometry/product-kernel.ts
     698 lib/studio/wiring-drawing.ts
     693 components/admin/videos-youtube.tsx
     691 app/[locale]/dashboard/customers/[id]/page.tsx
     661 components/studio/steps/IdeaStep.tsx
     655 lib/studio/enclosure/build.ts
     638 lib/prototyping/electronics-rules.ts
     637 components/admin/fix-list.tsx
     628 lib/studio/product/forms/geometry.ts
     619 components/prototyping/idea-stage.tsx
     594 components/admin/quick-entry.tsx
     575 components/studio/steps/EnclosureTemplate.tsx
```

## Build route table and First Load JS

```
Route (app)                                                Size  First Load JS  Revalidate  Expire
┌ ○ /                                                     338 B         104 kB          1d      1y
├ ○ /_not-found                                           174 B         104 kB          1d      1y
├ ● /[locale]                                           1.92 kB         148 kB          1d      1y
├   ├ /en                                                                               1d      1y
├   └ /ar                                                                               1d      1y
├ ƒ /[locale]/[...rest]                                   338 B         104 kB
├ ● /[locale]/about                                     1.95 kB         121 kB          1d      1y
├   ├ /en/about                                                                         1d      1y
├   └ /ar/about                                                                         1d      1y
├ ● /[locale]/case-studies                              1.95 kB         121 kB          1d      1y
├   ├ /en/case-studies                                                                  1d      1y
├   └ /ar/case-studies                                                                  1d      1y
├ ● /[locale]/case-studies/[slug]                       1.95 kB         121 kB          1d      1y
├   ├ /en/case-studies/nori-slider                                                      1d      1y
├   └ /ar/case-studies/nori-slider                                                      1d      1y
├ ● /[locale]/contact                                   4.42 kB         129 kB          1d      1y
├   ├ /en/contact                                                                       1d      1y
├   └ /ar/contact                                                                       1d      1y
├ ● /[locale]/dashboard                                 1.95 kB         121 kB
├   ├ /en/dashboard
├   └ /ar/dashboard
├ ● /[locale]/dashboard/ai-costs                        1.95 kB         121 kB
├   ├ /en/dashboard/ai-costs
├   └ /ar/dashboard/ai-costs
├ ƒ /[locale]/dashboard/ai-costs/[userId]               1.95 kB         121 kB
├ ● /[locale]/dashboard/contact                         3.38 kB         119 kB
├   ├ /en/dashboard/contact
├   └ /ar/dashboard/contact
├ ● /[locale]/dashboard/credits                         1.95 kB         121 kB
├   ├ /en/dashboard/credits
├   └ /ar/dashboard/credits
├ ● /[locale]/dashboard/customers                       1.95 kB         121 kB
├   ├ /en/dashboard/customers
├   └ /ar/dashboard/customers
├ ƒ /[locale]/dashboard/customers/[id]                  1.95 kB         121 kB
├ ● /[locale]/dashboard/engineering-jobs                4.99 kB         131 kB
├   ├ /en/dashboard/engineering-jobs
├   └ /ar/dashboard/engineering-jobs
├ ƒ /[locale]/dashboard/engineering-jobs/[id]/snapshot    338 B         104 kB
├ ● /[locale]/dashboard/leads                           2.91 kB         122 kB
├   ├ /en/dashboard/leads
├   └ /ar/dashboard/leads
├ ƒ /[locale]/dashboard/leads/[id]                      3.17 kB         124 kB
├ ● /[locale]/dashboard/notifications                   3.69 kB         129 kB
├   ├ /en/dashboard/notifications
├   └ /ar/dashboard/notifications
├ ● /[locale]/dashboard/overview                          338 B         104 kB
├   ├ /en/dashboard/overview
├   └ /ar/dashboard/overview
├ ● /[locale]/dashboard/payments                        1.95 kB         121 kB
├   ├ /en/dashboard/payments
├   └ /ar/dashboard/payments
├ ● /[locale]/dashboard/projects                        3.25 kB         122 kB
├   ├ /en/dashboard/projects
├   └ /ar/dashboard/projects
├ ● /[locale]/dashboard/reviews                         1.95 kB         121 kB
├   ├ /en/dashboard/reviews
├   └ /ar/dashboard/reviews
├ ● /[locale]/dashboard/store                           5.37 kB         131 kB
├   ├ /en/dashboard/store
├   └ /ar/dashboard/store
├ ƒ /[locale]/dashboard/store/[id]/edit                 6.31 kB         141 kB
├ ● /[locale]/dashboard/store/attributes                6.08 kB         140 kB
├   ├ /en/dashboard/store/attributes
├   └ /ar/dashboard/store/attributes
├ ● /[locale]/dashboard/store/discounts                   338 B         104 kB
├   ├ /en/dashboard/store/discounts
├   └ /ar/dashboard/store/discounts
├ ● /[locale]/dashboard/store/fix                         174 B         136 kB
├   ├ /en/dashboard/store/fix
├   └ /ar/dashboard/store/fix
├ ● /[locale]/dashboard/store/gaps                      1.95 kB         121 kB
├   ├ /en/dashboard/store/gaps
├   └ /ar/dashboard/store/gaps
├ ● /[locale]/dashboard/store/import                    6.65 kB         132 kB
├   ├ /en/dashboard/store/import
├   └ /ar/dashboard/store/import
├ ● /[locale]/dashboard/store/new                         177 B         135 kB
├   ├ /en/dashboard/store/new
├   └ /ar/dashboard/store/new
├ ● /[locale]/dashboard/store/occasions                 6.68 kB         152 kB
├   ├ /en/dashboard/store/occasions
├   └ /ar/dashboard/store/occasions
├ ● /[locale]/dashboard/store/orders                      320 B         134 kB
├   ├ /en/dashboard/store/orders
├   └ /ar/dashboard/store/orders
├ ƒ /[locale]/dashboard/store/orders/[id]               1.04 kB         135 kB
├ ● /[locale]/dashboard/store/overview                  3.84 kB         123 kB
├   ├ /en/dashboard/store/overview
├   └ /ar/dashboard/store/overview
├ ● /[locale]/dashboard/store/quick                     6.94 kB         132 kB
├   ├ /en/dashboard/store/quick
├   └ /ar/dashboard/store/quick
├ ● /[locale]/dashboard/store/restock                    8.4 kB         134 kB
├   ├ /en/dashboard/store/restock
├   └ /ar/dashboard/store/restock
├ ● /[locale]/dashboard/store/schools                   3.48 kB         145 kB
├   ├ /en/dashboard/store/schools
├   └ /ar/dashboard/store/schools
├ ● /[locale]/dashboard/store/stock                     3.27 kB         136 kB
├   ├ /en/dashboard/store/stock
├   └ /ar/dashboard/store/stock
├ ● /[locale]/dashboard/store/suppliers                  6.6 kB         132 kB
├   ├ /en/dashboard/store/suppliers
├   └ /ar/dashboard/store/suppliers
├ ● /[locale]/dashboard/store/suppliers/import          5.34 kB         128 kB
├   ├ /en/dashboard/store/suppliers/import
├   └ /ar/dashboard/store/suppliers/import
├ ● /[locale]/dashboard/store/suppliers/lookup           6.6 kB         135 kB
├   ├ /en/dashboard/store/suppliers/lookup
├   └ /ar/dashboard/store/suppliers/lookup
├ ● /[locale]/dashboard/store/suppliers/voltaat         4.84 kB         131 kB
├   ├ /en/dashboard/store/suppliers/voltaat
├   └ /ar/dashboard/store/suppliers/voltaat
├ ● /[locale]/dashboard/store/youtube                   10.5 kB         141 kB
├   ├ /en/dashboard/store/youtube
├   └ /ar/dashboard/store/youtube
├ ● /[locale]/dashboard/studio-library                  7.23 kB         169 kB
├   ├ /en/dashboard/studio-library
├   └ /ar/dashboard/studio-library
├ ƒ /[locale]/dashboard/studio-library/[id]             4.98 kB         246 kB
├ ● /[locale]/dashboard/usage                           3.27 kB         126 kB
├   ├ /en/dashboard/usage
├   └ /ar/dashboard/usage
├ ● /[locale]/delivery-returns                          1.95 kB         121 kB          1d      1y
├   ├ /en/delivery-returns                                                              1d      1y
├   └ /ar/delivery-returns                                                              1d      1y
├ ● /[locale]/design                                      137 B         132 kB          1d      1y
├   ├ /en/design                                                                        1d      1y
├   └ /ar/design                                                                        1d      1y
├ ● /[locale]/design/drawing                              138 B         132 kB          1d      1y
├   ├ /en/design/drawing                                                                1d      1y
├   └ /ar/design/drawing                                                                1d      1y
├ ● /[locale]/design/quote                              10.5 kB         204 kB          1d      1y
├   ├ /en/design/quote                                                                  1d      1y
├   └ /ar/design/quote                                                                  1d      1y
├ ● /[locale]/e2e-fixtures/cad-cloud                    7.07 kB         133 kB
├   ├ /en/e2e-fixtures/cad-cloud
├   └ /ar/e2e-fixtures/cad-cloud
├ ● /[locale]/e2e-fixtures/dashboard                    2.09 kB         140 kB
├   ├ /en/e2e-fixtures/dashboard
├   └ /ar/e2e-fixtures/dashboard
├ ● /[locale]/e2e-fixtures/dashboard-fix                  297 B         136 kB
├   ├ /en/e2e-fixtures/dashboard-fix
├   └ /ar/e2e-fixtures/dashboard-fix
├ ● /[locale]/e2e-fixtures/hero-poster                  1.42 kB         105 kB
├   ├ /en/e2e-fixtures/hero-poster
├   └ /ar/e2e-fixtures/hero-poster
├ ● /[locale]/e2e-fixtures/orders                         320 B         134 kB
├   ├ /en/e2e-fixtures/orders
├   └ /ar/e2e-fixtures/orders
├ ● /[locale]/e2e-fixtures/quote-calc                   2.17 kB         119 kB
├   ├ /en/e2e-fixtures/quote-calc
├   └ /ar/e2e-fixtures/quote-calc
├ ● /[locale]/e2e-fixtures/studio                       32.7 kB         354 kB
├   ├ /en/e2e-fixtures/studio
├   └ /ar/e2e-fixtures/studio
├ ● /[locale]/e2e-fixtures/studio-request               1.95 kB         121 kB
├   ├ /en/e2e-fixtures/studio-request
├   └ /ar/e2e-fixtures/studio-request
├ ● /[locale]/forgot-password                           2.48 kB         201 kB
├   ├ /en/forgot-password
├   └ /ar/forgot-password
├ ● /[locale]/how-it-works                                138 B         132 kB          1d      1y
├   ├ /en/how-it-works                                                                  1d      1y
├   └ /ar/how-it-works                                                                  1d      1y
├ ● /[locale]/institutions                              1.95 kB         121 kB          1d      1y
├   ├ /en/institutions                                                                  1d      1y
├   └ /ar/institutions                                                                  1d      1y
├ ● /[locale]/institutions/proposal                       137 B         130 kB          1d      1y
├   ├ /en/institutions/proposal                                                         1d      1y
├   └ /ar/institutions/proposal                                                         1d      1y
├ ● /[locale]/inventory                                 6.16 kB         132 kB
├   ├ /en/inventory
├   └ /ar/inventory
├ ƒ /[locale]/inventory/[id]/edit                       2.29 kB         132 kB
├ ● /[locale]/inventory/new                             2.29 kB         132 kB
├   ├ /en/inventory/new
├   └ /ar/inventory/new
├ ● /[locale]/join                                      7.65 kB         201 kB          1d      1y
├   ├ /en/join                                                                          1d      1y
├   └ /ar/join                                                                          1d      1y
├ ● /[locale]/my-inventory                              6.75 kB         203 kB
├   ├ /en/my-inventory
├   └ /ar/my-inventory
├ ● /[locale]/opengraph-image                             338 B         104 kB
├   ├ /en/opengraph-image
├   └ /ar/opengraph-image
├ ● /[locale]/orders                                    1.95 kB         121 kB
├   ├ /en/orders
├   └ /ar/orders
├ ƒ /[locale]/orders/[id]                               4.87 kB         131 kB
├ ● /[locale]/partners/accelerators                     1.95 kB         121 kB          1d      1y
├   ├ /en/partners/accelerators                                                         1d      1y
├   └ /ar/partners/accelerators                                                         1d      1y
├ ● /[locale]/partners/schools                          1.95 kB         121 kB          1d      1y
├   ├ /en/partners/schools                                                              1d      1y
├   └ /ar/partners/schools                                                              1d      1y
├ ● /[locale]/pricing                                   9.33 kB         161 kB          1d      1y
├   ├ /en/pricing                                                                       1d      1y
├   └ /ar/pricing                                                                       1d      1y
├ ● /[locale]/privacy                                   1.95 kB         121 kB          1d      1y
├   ├ /en/privacy                                                                       1d      1y
├   └ /ar/privacy                                                                       1d      1y
├ ● /[locale]/projects                                    10 kB         201 kB
├   ├ /en/projects
├   └ /ar/projects
├ ƒ /[locale]/projects/[id]                             17.2 kB         226 kB
├ ƒ /[locale]/projects/[id]/engineering                   11 kB         137 kB
├ ƒ /[locale]/projects/[id]/prototyping                 88.5 kB         338 kB
├ ƒ /[locale]/projects/[id]/request                     1.95 kB         121 kB
├ ƒ /[locale]/projects/[id]/studio                       1.2 kB         326 kB
├ ● /[locale]/projects/new                              11.9 kB         237 kB
├   ├ /en/projects/new
├   └ /ar/projects/new
├ ● /[locale]/reset-password                            2.45 kB         198 kB
├   ├ /en/reset-password
├   └ /ar/reset-password
├ ● /[locale]/schools                                   1.95 kB         121 kB          1d      1y
├   ├ /en/schools                                                                       1d      1y
├   └ /ar/schools                                                                       1d      1y
├ ● /[locale]/schools/classes                           2.12 kB         132 kB
├   ├ /en/schools/classes
├   └ /ar/schools/classes
├ ƒ /[locale]/schools/classes/[id]                      3.44 kB         138 kB
├ ƒ /[locale]/schools/classes/[id]/sheet                  137 B         130 kB
├ ƒ /[locale]/schools/classes/[id]/teams/[teamId]       4.87 kB         131 kB
├ ● /[locale]/sign-in                                   2.23 kB         204 kB
├   ├ /en/sign-in
├   └ /ar/sign-in
├ ● /[locale]/sign-up                                   3.07 kB         205 kB
├   ├ /en/sign-up
├   └ /ar/sign-up
├ ● /[locale]/store                                       150 B         147 kB          1d      1y
├   ├ /en/store                                                                         1d      1y
├   └ /ar/store                                                                         1d      1y
├ ● /[locale]/store/[sku]                               2.74 kB         209 kB
├ ● /[locale]/store/cart                                8.98 kB         208 kB          1d      1y
├   ├ /en/store/cart                                                                    1d      1y
├   └ /ar/store/cart                                                                    1d      1y
├ ● /[locale]/store/checkout                            7.98 kB         212 kB
├   ├ /en/store/checkout
├   └ /ar/store/checkout
├ ● /[locale]/store/checkout/success                    5.95 kB         136 kB          1d      1y
├   ├ /en/store/checkout/success                                                        1d      1y
├   └ /ar/store/checkout/success                                                        1d      1y
├ ● /[locale]/store/collections/[id]                      209 B         141 kB
├ ● /[locale]/store/search                                151 B         147 kB
├   ├ /en/store/search
├   └ /ar/store/search
├ ● /[locale]/students                                  1.95 kB         121 kB          1d      1y
├   ├ /en/students                                                                      1d      1y
├   └ /ar/students                                                                      1d      1y
├ ● /[locale]/terms                                     1.95 kB         121 kB          1d      1y
├   ├ /en/terms                                                                         1d      1y
├   └ /ar/terms                                                                         1d      1y
├ ● /[locale]/tokens                                    5.52 kB         128 kB
├   ├ /en/tokens
├   └ /ar/tokens
├ ● /[locale]/trust                                     1.95 kB         121 kB          1d      1y
├   ├ /en/trust                                                                         1d      1y
├   └ /ar/trust                                                                         1d      1y
├ ● /[locale]/v2                                        3.64 kB         149 kB          1d      1y
├   ├ /en/v2                                                                            1d      1y
├   └ /ar/v2                                                                            1d      1y
├ ● /[locale]/v2/design                                 4.39 kB         135 kB          1d      1y
├   ├ /en/v2/design                                                                     1d      1y
├   └ /ar/v2/design                                                                     1d      1y
├ ● /[locale]/v2/how-it-works                             138 B         132 kB          1d      1y
├   ├ /en/v2/how-it-works                                                               1d      1y
├   └ /ar/v2/how-it-works                                                               1d      1y
├ ● /[locale]/v2/store                                    151 B         147 kB          1d      1y
├   ├ /en/v2/store                                                                      1d      1y
├   └ /ar/v2/store                                                                      1d      1y
├ ● /[locale]/warranty                                  1.95 kB         121 kB          1d      1y
├   ├ /en/warranty                                                                      1d      1y
├   └ /ar/warranty                                                                      1d      1y
├ ƒ /api/admin/customers/[id]/export                      338 B         104 kB
├ ƒ /api/admin/drive-import                               338 B         104 kB
├ ƒ /api/admin/notifications/test                         338 B         104 kB
├ ƒ /api/admin/projects/[id]/export                       338 B         104 kB
├ ƒ /api/admin/site-v2-preview                            338 B         104 kB
├ ƒ /api/admin/sourcing-backup                            338 B         104 kB
├ ƒ /api/admin/starter-parts                              338 B         104 kB
├ ƒ /api/admin/store-cleanup                              338 B         104 kB
├ ƒ /api/admin/voltaat-import                             338 B         104 kB
├ ƒ /api/admin/voltaat-sync                               338 B         104 kB
├ ƒ /api/admin/youtube/callback                           338 B         104 kB
├ ƒ /api/admin/youtube/connect                            338 B         104 kB
├ ƒ /api/admin/youtube/upload                             338 B         104 kB
├ ƒ /api/analyse                                          338 B         104 kB
├ ƒ /api/auth/callback                                    338 B         104 kB
├ ƒ /api/auth/claim-guest                                 338 B         104 kB
├ ƒ /api/billing/checkout                                 338 B         104 kB
├ ƒ /api/billing/proof                                    338 B         104 kB
├ ƒ /api/billing/service                                  338 B         104 kB
├ ƒ /api/bom/electronics                                  338 B         104 kB
├ ƒ /api/bom/match                                        338 B         104 kB
├ ƒ /api/brief-chat                                       338 B         104 kB
├ ƒ /api/cad                                              338 B         104 kB
├ ƒ /api/cron/anonymous-cleanup                           338 B         104 kB
├ ƒ /api/cron/delivery-promises                           338 B         104 kB
├ ƒ /api/cron/notifications                               338 B         104 kB
├ ƒ /api/cron/supplier-refresh                            338 B         104 kB
├ ƒ /api/cron/voltaat-sync                                338 B         104 kB
├ ƒ /api/cron/youtube-retire                              338 B         104 kB
├ ƒ /api/demand                                           338 B         104 kB
├ ƒ /api/design-quote                                     338 B         104 kB
├ ƒ /api/engineering/jobs                                 338 B         104 kB
├ ƒ /api/engineering/jobs/[id]/cancel                     338 B         104 kB
├ ƒ /api/engineering/jobs/[id]/return                     338 B         104 kB
├ ƒ /api/firmware                                         338 B         104 kB
├ ƒ /api/netlist                                          338 B         104 kB
├ ƒ /api/notifications/unsubscribe                        338 B         104 kB
├ ƒ /api/orders/confirmation                              338 B         104 kB
├ ƒ /api/orders/rate                                      338 B         104 kB
├ ƒ /api/orders/review                                    338 B         104 kB
├ ƒ /api/project-cad                                      338 B         104 kB
├ ƒ /api/projects/claim                                   338 B         104 kB
├ ƒ /api/projects/name                                    338 B         104 kB
├ ƒ /api/projects/recovery-email                          338 B         104 kB
├ ƒ /api/store-lead                                       338 B         104 kB
├ ƒ /api/store/search                                     338 B         104 kB
├ ƒ /api/studio/doc                                       338 B         104 kB
├ ƒ /api/studio/enclosure                                 338 B         104 kB
├ ƒ /api/studio/firmware                                  338 B         104 kB
├ ƒ /api/studio/mech                                      338 B         104 kB
├ ƒ /api/studio/pick                                      338 B         104 kB
├ ƒ /api/studio/product/check                             338 B         104 kB
├ ƒ /api/studio/product/choose                            338 B         104 kB
├ ƒ /api/studio/product/design                            338 B         104 kB
├ ƒ /api/studio/product/engineer                          338 B         104 kB
├ ƒ /api/studio/product/model                             338 B         104 kB
├ ƒ /api/studio/product/preview                           338 B         104 kB
├ ƒ /api/studio/product/unlock                            338 B         104 kB
├ ƒ /api/studio/spec                                      338 B         104 kB
├ ƒ /api/studio/tokens                                    338 B         104 kB
├ ƒ /api/studio/wiring                                    338 B         104 kB
├ ƒ /api/transcribe                                       338 B         104 kB
├ ○ /apple-icon                                           338 B         104 kB
├ ○ /icon.svg                                               0 B            0 B
├ ○ /manifest.webmanifest                                 338 B         104 kB
├ ○ /robots.txt                                           338 B         104 kB
└ ○ /sitemap.xml                                          338 B         104 kB          1h      1y
+ First Load JS shared by all                            104 kB
  ├ chunks/1255-623a1bc706ecd6cc.js                     46.1 kB
  ├ chunks/4bd1b696-100b9d70ed4e49c1.js                 54.2 kB
  └ other shared chunks (total)                         3.28 kB


ƒ Middleware                                             103 kB

○  (Static)   prerendered as static content
●  (SSG)      prerendered as static HTML (uses generateStaticParams)
ƒ  (Dynamic)  server-rendered on demand

build exit 0
```
