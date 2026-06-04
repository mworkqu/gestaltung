# DESIGN.md — Gestaltung

The single source of truth for how Gestaltung should look and feel. Distilled from the
owner's reference build in `Design that I like/gestaltung`. Read this before generating any UI.
Pairs with the installed `impeccable` and `taste-skill` skills in `.claude/skills/`.

## 1. Visual theme & atmosphere
Swiss / Constructivist precision meets soft tactile hardware. The page should feel like a
machined instrument panel: rational 12-column grids, blueprint motifs, monospace telemetry,
and bento cards that look extruded from the surface rather than drawn on it. Calm, expensive,
engineering-literate — never flashy. Density is moderate; whitespace does the talking.

Default surface style: **soft neomorphic, light**. (The reference also ships glass/clay/cream
variants; light neomorphic is the chosen production direction.)

## 2. Color palette & roles
- Canvas / surface: `#eef2f7` (cards share the canvas color; depth comes from shadow, not fill)
- Recessed surface: `#e6ebf2`
- Pure white highlight edge: `rgba(255,255,255,0.6–0.95)`
- Ink / heading: `#1c2434` (near-black slate, never pure `#000`)
- Body text: `#475569`
- Muted text: `#64748b`
- Faint text / mono labels: `#94a3b8`
- Hairline border: `#d3dbe6`
- **Accent — Cobalt `#0e59c5`** (primary). Hover `#0c4eb0`.
- Accent text on cobalt: white.
- Status green (telemetry dot only): `#10b981`
Color is a cognitive cue, never background noise. One accent at a time.

## 3. Typography
- Display / UI sans: **Outfit** (300–800). Tight tracking, heavy weights for headings.
- Mono: **JetBrains Mono** — used for eyebrows, telemetry, indices, spec readouts, labels.
- Arabic: **IBM Plex Sans Arabic**. Never apply letter-spacing or uppercase to Arabic.
- Headings: `font-black`, `tracking-tight`, `leading-[1.05]`. Uppercase only in English.
- Eyebrow tags: mono, `text-[10px]`, `uppercase tracking-[0.2em]`, muted.

## 4. Component stylings
- **Neomorphic card (`.neu`)**: bg `#eef2f7`, 1px white/60 inner edge, radius 28px,
  shadow `6px 6px 16px rgba(163,177,198,.5), -6px -6px 16px rgba(255,255,255,.85)`.
  Hover lifts the shadow. Inset variant (`.neu-inset`) for wells / blueprint panels.
- **Buttons**: solid ink/cobalt pills, mono uppercase label (EN), generous padding, press-scale `0.98`.
- **Eyebrow badge**: pill, dot + mono label.
- **Telemetry bar**: thin top strip, mono uppercase, status dot, location, formats.
- **Blueprint panel**: inset well with faint dashed grid + concentric circles + the G mark.
- Icons: Lucide at `strokeWidth 1.5–1.75` only (thin, precise). No thick/filled icons.

## 5. Layout principles
12-column rational grid, `max-w-7xl` centered. Asymmetric bento (e.g. 7/5 hero split).
Macro-whitespace between sections (`py-16`→`py-28`). Mobile collapses to single column,
all `col-span` reset, generous vertical gaps.

## 6. Depth & elevation
Depth is dual soft shadows (cool blue-grey lower-right, white upper-left), never harsh dark
drop shadows. Recessed wells use inset shadows. Layer order: telemetry < content < sticky header.

## 7. Do's and don'ts
- DO use blueprint/grid/index motifs, mono labels, concentric geometry, the rotated-diamond G.
- DO keep Arabic perfectly RTL and free of latin typographic tics (no tracking, no uppercase).
- DON'T use Inter/Roboto/Arial, harsh `shadow-md`, pure black, gray-on-color text, or nested
  cards-in-cards without the double-bezel rationale.
- DON'T introduce a second accent color or rainbow gradients.

## 8. Responsive behavior
Mobile-first collapse below `768px`: single column, `px-4`, reduced shadow spread. Touch
targets ≥ 44px. Use `min-h-[100dvh]` not `h-screen`. Telemetry bar scrolls horizontally.

## 9. Agent prompt guide
When building a new Gestaltung screen: "Build a [screen] in the Gestaltung light-neomorphic
Swiss style — cobalt accent, Outfit + JetBrains Mono, bento grid, soft dual shadows, blueprint
motifs, bilingual EN/AR with correct RTL, all copy from messages/{en,ar}.json." Then run
`/impeccable polish` or the `redesign-existing-projects` taste skill to refine.
