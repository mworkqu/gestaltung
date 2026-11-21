#!/usr/bin/env node
// Origin budget check (2026-11). Reads the BUILD OUTPUT in .next and says
// which routes are rendered per request, so a change cannot quietly turn a
// public page dynamic again.
//
// Why: every dynamic render leaves our functions and is billed as Vercel "Fast
// Origin Transfer". A static/ISR page is served from the CDN and costs nothing
// after the first render. The storefront, the marketing pages and the legal
// pages are therefore meant to stay static or ISR for ever (CLAUDE.md, "Hard
// rules"), and sitemap.xml / robots.txt with them.
//
// It NEVER fails the build: it prints and exits 0. Run after `next build`
// (npm run build does), or on its own once a build exists:
//   node scripts/origin-budget.mjs
// `--json` prints the classification as JSON instead.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const next = path.join(root, ".next");
const asJson = process.argv.includes("--json");

/**
 * Public routes that MUST NOT be dynamic. App-router route ids as the
 * manifests spell them (no locale value: /[locale] is the segment).
 * Keep in step with lib/seo.ts SITEMAP_STATIC_PATHS — anything a crawler can
 * reach in numbers belongs here.
 */
const MUST_BE_CACHED = [
  "/[locale]",
  "/[locale]/store",
  "/[locale]/store/[sku]",
  "/[locale]/store/collections/[id]",
  "/[locale]/about",
  "/[locale]/contact",
  "/[locale]/how-it-works",
  "/[locale]/pricing",
  "/[locale]/design",
  "/[locale]/design/drawing",
  "/[locale]/design/quote",
  "/[locale]/students",
  "/[locale]/schools",
  "/[locale]/institutions",
  "/[locale]/trust",
  "/[locale]/partners/schools",
  "/[locale]/partners/accelerators",
  "/[locale]/case-studies",
  "/[locale]/case-studies/[slug]",
  "/[locale]/delivery-returns",
  "/[locale]/warranty",
  "/[locale]/terms",
  "/[locale]/privacy",
  "/sitemap.xml",
  "/robots.txt",
];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(next, file), "utf8"));
  } catch {
    return null;
  }
}

function classify() {
  const appRoutes = readJson("app-path-routes-manifest.json"); // { "/x/page": "/x" }
  const prerender = readJson("prerender-manifest.json"); // { routes, dynamicRoutes }
  if (!appRoutes || !prerender) return null;

  // Rendered paths -> the route that produced them. "/en/store/ABC" came from
  // "/[locale]/store/[sku]"; the prerender manifest keys the concrete paths in
  // `routes` and the parameterised ones in `dynamicRoutes`.
  const cached = new Map(); // route id -> { kind, revalidate }
  for (const [p, entry] of Object.entries(prerender.routes ?? {})) {
    const id = entry.srcRoute || p;
    const revalidate = entry.initialRevalidateSeconds;
    const kind = revalidate === false || revalidate == null ? "static" : "isr";
    const seen = cached.get(id);
    if (!seen || seen.kind === "static") cached.set(id, { kind, revalidate });
  }
  for (const [id, entry] of Object.entries(prerender.dynamicRoutes ?? {})) {
    if (cached.has(id)) continue;
    const revalidate = entry.fallbackRevalidate ?? entry.initialRevalidateSeconds;
    cached.set(id, { kind: typeof revalidate === "number" ? "isr" : "static", revalidate });
  }

  const rows = [];
  for (const route of new Set(Object.values(appRoutes))) {
    const hit = cached.get(route);
    rows.push({
      route,
      kind: hit ? hit.kind : "dynamic",
      revalidate: hit && typeof hit.revalidate === "number" ? hit.revalidate : null,
    });
  }
  rows.sort((a, b) => a.route.localeCompare(b.route));
  return rows;
}

function main() {
  const rows = classify();
  if (!rows) {
    console.log("origin-budget: no build output in .next (run `next build` first) — skipped.");
    return;
  }
  if (asJson) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const byKind = (k) => rows.filter((r) => r.kind === k);
  const dynamic = byKind("dynamic");
  const isr = byKind("isr");
  console.log(
    `origin-budget: ${rows.length} routes — ${byKind("static").length} static, ${isr.length} ISR, ${dynamic.length} rendered per request.`
  );
  if (isr.length) {
    console.log("  ISR (re-rendered at most every N s):");
    for (const r of isr) console.log(`    ${r.route}  revalidate=${r.revalidate ?? "?"}`);
  }

  const regressions = MUST_BE_CACHED.filter((route) => {
    const hit = rows.find((r) => r.route === route);
    return hit && hit.kind === "dynamic";
  });
  const missing = MUST_BE_CACHED.filter((route) => !rows.some((r) => r.route === route));

  if (regressions.length) {
    console.warn("");
    console.warn("  WARNING: these public routes are now rendered per request (Fast Origin Transfer):");
    for (const r of regressions) console.warn(`    ${r}`);
    console.warn("  Likely cause: cookies(), headers(), searchParams, a no-store fetch or");
    console.warn("  `export const dynamic` in the page or in a layout above it.");
  }
  if (missing.length) {
    console.warn("");
    console.warn(`  NOTE: ${missing.length} route(s) in the must-stay-cached list were not in this build:`);
    for (const r of missing) console.warn(`    ${r}`);
    console.warn("  Renamed or removed? Update MUST_BE_CACHED in scripts/origin-budget.mjs.");
  }
  if (!regressions.length && !missing.length) console.log("  Every public route in the must-stay-cached list is static or ISR.");
}

try {
  main();
} catch (e) {
  // A warning must never fail a build.
  console.log(`origin-budget: skipped (${e instanceof Error ? e.message : e}).`);
}
