// Design Studio JS budget (P5-15e): gzip size of the JS the Studio route loads
// beyond a base page. Run after `npm run build`:
//
//   node scripts/studio-bundle-size.mjs [--base /[locale]/pricing/page] [--budget 350]
//
// Reads .next/app-build-manifest.json (initial chunks per app route) and
// .next/react-loadable-manifest.json (next/dynamic + import() chunks, keyed by
// the importing file). Counted:
//   initial  = chunks of /[locale]/projects/[id]/studio/page not on the base page
//   lazy     = chunks behind dynamic imports from components/studio/** or lib/studio/**
//              that are not already initial (the 3D viewer, PrintStep's builds, STL export…)
//   worker   = the geometry Web Worker bundle(s) (own file, fetched by the worker only)
// Budget = initial + lazy (what a visitor's main thread downloads to see the Studio).
// The worker is reported separately (it runs off the main thread, fetched when the
// first case is built). Exit code 1 when over budget.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const ROUTE = arg("--route", "/[locale]/projects/[id]/studio/page");
const BASE = arg("--base", "/[locale]/pricing/page");
const BUDGET_KB = Number(arg("--budget", "350"));
const NEXT = path.resolve(arg("--dir", ".next"));

const readJson = (p) => JSON.parse(readFileSync(path.join(NEXT, p), "utf8"));
if (!existsSync(path.join(NEXT, "app-build-manifest.json"))) {
  console.error("No .next/app-build-manifest.json — run `npm run build` first.");
  process.exit(2);
}

const pages = readJson("app-build-manifest.json").pages;
if (!pages[ROUTE]) {
  console.error(`Route ${ROUTE} not in app-build-manifest. Known studio routes: ${Object.keys(pages).filter((k) => k.includes("studio")).join(", ")}`);
  process.exit(2);
}
const js = (list) => (list ?? []).filter((f) => f.endsWith(".js"));
const routeFiles = new Set(js(pages[ROUTE]));
const baseFiles = new Set(js(pages[BASE]));

const sizeCache = new Map();
function gz(file) {
  if (!sizeCache.has(file)) {
    const buf = readFileSync(path.join(NEXT, file));
    sizeCache.set(file, { raw: buf.length, gz: gzipSync(buf, { level: 9 }).length });
  }
  return sizeCache.get(file);
}
const kb = (n) => (n / 1024).toFixed(1);

const initial = [...routeFiles].filter((f) => !baseFiles.has(f));

// Lazy chunks: every dynamic import made from studio code.
const loadable = existsSync(path.join(NEXT, "react-loadable-manifest.json")) ? readJson("react-loadable-manifest.json") : {};
const lazyBy = new Map(); // file -> importers
for (const [key, entry] of Object.entries(loadable)) {
  const from = key.split(" -> ")[0].replace(/\\/g, "/");
  if (!/^(components\/studio|lib\/studio)\//.test(from)) continue;
  for (const f of js(entry.files)) {
    if (routeFiles.has(f) || baseFiles.has(f)) continue;
    if (!lazyBy.has(f)) lazyBy.set(f, new Set());
    lazyBy.get(f).add(key.replace(/\\/g, "/"));
  }
}
// The geometry worker's synchronous fallback (`import("./job")` in lib/studio/geometry/client.ts)
// is only fetched where no Worker can start (never in a modern browser): reported apart.
const FALLBACK_ONLY = /\/geometry\/client\.ts -> \.\/job$/;
const lazy = [];
const fallback = [];
for (const [f, keys] of lazyBy) ([...keys].every((k) => FALLBACK_ONLY.test(k)) ? fallback : lazy).push(f);

// Worker bundles: webpack emits each `new Worker(new URL(...))` target as its own chunk
// (found by the "[studio-geometry-worker]" tag in its code) plus the chunks it loads with
// importScripts (listed in its own webpack runtime: `"static/chunks/"+(…)+"."+({id:"hash"})[e]+".js"`).
const chunkDir = path.join(NEXT, "static", "chunks");
const workers = new Set();
for (const f of readdirSync(chunkDir)) {
  if (!f.endsWith(".js")) continue;
  const text = readFileSync(path.join(chunkDir, f), "utf8");
  if (!text.includes("[studio-geometry-worker]")) continue;
  workers.add(`static/chunks/${f}`);
  const m = text.match(/"static\/chunks\/"\+\(([^)]*)\)\+"\."\+\(\{([^}]*)\}\)\[\w+\]\+"\.js"/);
  if (!m) continue;
  const names = new Map([...m[1].matchAll(/(\d+)===\w+\?"([^"]+)"/g)].map((x) => [x[1], x[2]]));
  for (const [, id, hash] of m[2].matchAll(/(\d+):"([0-9a-f]+)"/g)) {
    const file = `static/chunks/${names.get(id) ?? id}.${hash}.js`;
    if (existsSync(path.join(NEXT, file))) workers.add(file);
  }
}
const shared = (f) => (lazy.includes(f) || routeFiles.has(f) ? "  (shared with the main thread: one download)" : "");

function table(title, files, note) {
  const rows = files.map((f) => ({ f, ...gz(f) })).sort((a, b) => b.gz - a.gz);
  const total = rows.reduce((t, r) => t + r.gz, 0);
  console.log(`\n${title}: ${kb(total)} kB gz (${rows.length} files)`);
  for (const r of rows) console.log(`  ${kb(r.gz).padStart(7)} kB gz  ${kb(r.raw).padStart(7)} kB raw  ${r.f}${note ? note(r.f) : ""}`);
  return total;
}

console.log(`Studio route: ${ROUTE}\nBase page:    ${BASE}`);
const tBase = table("Base page JS", [...baseFiles]);
const tInit = table("Studio initial JS beyond the base page", initial);
const tLazy = table("Studio lazy JS (dynamic imports from studio code)", lazy, (f) => `  ← ${[...lazyBy.get(f)].map((k) => k.split(" -> ")[1]).join(", ")}`);
const tFall = table("Fallback only (no Worker: never fetched in a modern browser)", fallback);
const tWork = table("Geometry worker bundle (off the main thread)", [...workers], shared);
const workerOnly = [...workers].filter((f) => !shared(f)).reduce((t, f) => t + gz(f).gz, 0);

const total = tInit + tLazy;
console.log(`\nBase page: ${kb(tBase)} kB gz`);
console.log(`Studio beyond base (initial + lazy): ${kb(total)} kB gz  (budget ${BUDGET_KB} kB)`);
console.log(`Worker: ${kb(tWork)} kB gz in all, ${kb(workerOnly)} kB gz of it not shared with the main thread`);
console.log(`Fallback (not counted): ${kb(tFall)} kB gz`);
if (total / 1024 > BUDGET_KB) {
  console.log("OVER BUDGET");
  process.exit(1);
}
console.log("Within budget");
