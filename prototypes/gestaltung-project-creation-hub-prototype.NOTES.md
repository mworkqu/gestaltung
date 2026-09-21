# Project Creation Hub — prototype notes

Open `gestaltung-project-creation-hub-prototype.html` directly in a browser. It is one self-contained file: no network, no frameworks, no backend. The fonts are embedded.

## Design tokens reused (nothing new invented)

| Source | Reused |
|---|---|
| `app/globals.css` | canvas `#eef2f7`, ink/heading `#1c2434`, muted `#5a6677`, border `#d3dbe6`, cobalt primary `#0e59c5`, destructive `hsl(4 74% 51%)`, `--buy` / `--inventory` signal pairs, `--radius: .9rem`, `.neu`, `.neu-hover`, `.neu-inset`, `.bg-blueprint-grid` |
| `tailwind.config.ts` | `cobalt.hover #0c4eb0`, `azure.light #3b82f6`, `panel #e6ebf2`, `body #475569`, `faint #94a3b8`, `shadow-neu`, `-sm`, `-lg`, `-hover`, `-inset`, spring easing `cubic-bezier(.32,.72,0,1)` |
| `app/[locale]/layout.tsx` | Outfit (300–800), JetBrains Mono (400–500), IBM Plex Sans Arabic (400–700). These are the same woff2 files `next/font` serves, taken from `.next/static/media` and inlined |
| `components/header.tsx` | neu header bar (h-16), ink logo chip with the real `LogoMark` path, uppercase `tracking-[.12em]` brand name, mono 9px tagline, EN·ع pill switcher |
| `components/ui/tag.tsx` | Tag pill (11px, semibold, rounded-full). Added `cobalt` / `danger` / `superseded` variants using existing colours at 10% opacity |
| `components/projects/*` | inline name input (focus → `bg-panel` + inset), `bg-panel shadow-neu-sm` rows, soft buttons (`hover:text-cobalt`), cobalt primary, material pills, inset textarea with cobalt/60 focus ring |
| `how-it-works/page.tsx` | kicker pill, mono uppercase `tracking-[.18em]` labels (Arabic drops mono and letter-spacing), spec readout tiles, blueprint well, ink CTA band |

## What is mocked, and what each needs to be real

| Mocked feature | Needed to make it real |
|---|---|
| AI project understanding, confidence, open questions | LLM call over brief + images + constraints returning structured claims `{text, confidence, assumption}`. Store per-claim status (pending/confirmed/corrected) in a `project_claims` table |
| Generate concept (progress, gallery, superseded) | Job queue (Supabase table + edge function / Vercel background function) + image or SVG generation model; `project_concepts` table with status and `superseded_by` |
| Part breakdown + per-part material/process | LLM structured output validated against `PROJECT_MATERIALS` and the process list; `project_parts` table. Compatibility matrix belongs in `lib/` (the prototype's `COMPAT` map is a first draft) |
| Manufacturing recommendation text | Deterministic rules (routes, lead times, warnings) with an LLM only writing the prose; real partner routes and lead times from workshop data |
| Schematics: generate / regenerate / refine / restore / attach | CAD or drawing generation service (e.g. a parametric CAD kernel driven by an LLM), `artifact_revisions` table (rev, status, prompt, parent_rev, error, confidence), SVG/PDF render, storage in a private bucket |
| Generate files (STEP/STL/DXF/PDF), failure + retry | CAD kernel export pipeline + DFM checks (bend relief, wall thickness) that produce the failure messages; files in `cad-files` bucket with signed downloads (already the pattern in `project-cad-card.tsx`) |
| Generate 3D model | Same CAD pipeline plus a web viewer (e.g. three.js) instead of the SVG isometric |
| Assistant chat + suggestion cards | Streaming LLM endpoint with tool calls that return *proposals* only; the client applies a proposal only on an explicit user click (the rule the prototype enforces) |
| Add image analysis, Voice transcription | Vision model on upload to the `project-images` bucket; speech-to-text (browser MediaRecorder → transcription API) |
| Readiness %, stage locking | Derived server-side from the tables above; stage status persisted per project |
| Save / project revision, Share link | Project snapshot table + RLS-scoped share tokens |
| Request quote | Existing `/api/store-lead` / project-cad email flow, fed with confirmed parts + ready files only |

## Known gaps in the spike

- Long AI prose (chat replies, part descriptions, recommendation text) is English only. The chrome, labels, stages, and part and material names are bilingual, and the layout mirrors fully in RTL.
- `FR-4 laminate` is not in `PROJECT_MATERIALS`. It is needed for the PCB part and would have to be added.
- Nothing persists after a reload. All state lives in memory.
