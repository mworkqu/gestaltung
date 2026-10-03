#!/usr/bin/env node
// Generates the per-SKU store-category mapping inside
// supabase/migrations/0048_store_categories.sql (C5, 2026-10-04).
//
// What it does
//   1. Reads every PUBLISHED product through the public (anon) REST API —
//      read-only, the same rows the storefront can see. URL + anon key come
//      from .env.local (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY);
//      keys are never printed.
//   2. Classifies each product into one of the nine store categories
//      (lib/store/store-categories.ts) with the name rules below: the first
//      matching rule for its source category (parts.category) wins, else the
//      source category's default. These are the rules the owner approved in
//      the C5 review (eight categories), plus the ninth, "3D printing": every
//      product from the three 3D source categories, and 3D items that sat
//      elsewhere (resins, printers, scanner, AMS accessories, filament sensor).
//   3. Rewrites the block between "-- BEGIN GENERATED MAPPING" and
//      "-- END GENERATED MAPPING" in 0048 (the rule-table seed and the
//      (sku, store_category) values list) and prints counts per category
//      (all published / listed = has a delivery date).
//
// Usage (from the project folder, Node 24+ for the .ts import):
//   node scripts/build-category-migration.mjs                 # fetch + write 0048
//   node scripts/build-category-migration.mjs --dry           # fetch + print only
//   node scripts/build-category-migration.mjs --baseline f.json   # also diff against an
//        earlier classification (array of {sku, name, nc}) and list new/removed SKUs
//   node scripts/build-category-migration.mjs --input rows.json   # classify a saved
//        snapshot instead of fetching; --save-input rows.json saves the fetched rows
//
// After 0048 has run in Supabase, re-running this script only matters for a
// NEW migration: 0048 fills rows whose store_category is still empty, and new
// products get theirs from store_category_rules via the trigger.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  STORE_CATEGORIES,
  SOURCE_CATEGORY_DEFAULTS,
} from "../lib/store/store-categories.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATION = path.join(ROOT, "supabase", "migrations", "0048_store_categories.sql");
export const GIFT_CARD_SKU = "VLT-44331994546493";

const [B, S, M, I, P, Mo, C, T, D3] = STORE_CATEGORIES;

// ── Rules: [store category, name pattern], first match wins per source category.
const RULES = {
  "Chips & ICs": [[P, /fuse/i], [M, /relay module|multiplexer module|amplifier board/i], [S, /reflective object sensor/i], [T, /heat sink/i], [C, /ic socket/i]],
  Motors: [[S, /water flow sensor/i], [M, /motor driver|servo driver|h-bridge/i], [C, /cable/i]],
  Microcontrollers: [[I, /logic ic|crystal|oscillator/i], [T, /enclosure/i], [S, /mmwave/i], [M, /converter|adapter module|can bus|usb.to.ttl|serial adapter|programmer|expansion|adapter board|picowbell|breadboard adapter|terminal expansion/i]],
  Modules: [[S, /ir sensor receiver|ir receiver diode|ultrasonic sensor|microphone module/i], [I, /infrared transmitter led|l293d dual h-bridge motor driver ic/i], [C, /pigtail/i], [B, /ttgo|sumo robot controller/i], [P, /wireless charging|ups module/i], [T, /logic analyzer/i]],
  Displays: [[S, /sensor/i]],
  // AMS = Bambu Lab's filament system: a 3D-printer accessory.
  Power: [[C, /t-connector|adapter cable|barrel jack to|barrel jack splitter|barrel jack.*cable/i], [I, /tl431|mcp4725 - 12 bit/i], [M, /mcp4725 12bit|m\.2 nvme/i], [D3, /\bams\b/i]],
  Tools: [[C, /header|hook up wire|hook-up wire|flat ribbon|screw terminal/i], [M, /thermoelectric|peltier|tec1|tes1/i]],
  Prototyping: [[C, /jumper|dupont/i], [M, /gpio extension/i], [T, /breadboard/i]],
  Sensors: [[T, /electrode pad/i], [D3, /filament sensor/i]],
  Components: [
    [T, /esd|workbench mat|helping hands|magnifying|copper foil|conductive thread|cable organizer|toggle switch cover|potentiometer knob|led holder|bulb socket/i],
    [Mo, /pneumatic/i],
    [S, /touch sensor|limit switch module/i],
    [C, /cable|wire\b|connector|jack|socket|breakout|dip adapter|adapter|bnc|banana|test lead|test hook|xt\d|jst|deans|splitter|terminal|rj45|alligator|\bplug\b|dip board/i],
    [M, /switch|button|potentiometer|joystick|keypad|led module|led strip|led stick|led matrix|traffic light|bulb|littlebits|cob led|pre-wired|gamepad|dome/i],
    [I, /./],
  ],
  "Raspberry Pi": [
    [B, /raspberry pi (400|500)|compute module 5 (single|development)/i],
    [M, /build hat(?! power)|monitor|10\.5-inch/i],
    [Mo, /robot|car\b|quadruped/i],
    [P, /power supply|power adapter|ups hat|psu/i],
    [C, /cable|adapter|otg/i],
    [S, /camera module|ai camera|noir|sense hat|high quality camera module|high quality camera – m12/i],
    [T, /lens|case|heatsink|cooler|mouse|keyboard|hub\b|debug probe|monitor\b/i],
    [M, /hat|touch display|display|build hat|poe|m\.2|io board|oled/i],
    [B, /./],
  ],
  Kits: [
    [I, /resistors kit|capacitor kit/i],
    [T, /breadboard|cutting upgrade|vacuum sucker|soldering practice/i],
    [T, /buzz wire/i],
    [Mo, /brushless dc motor|fpv motor|propeller|esc|diy kit|servo mount/i],
    [P, /power module|power expansion/i],
    [S, /gps|sensors kit/i],
    [M, /ppm encoder/i],
    [B, /./],
  ],
  Other: [
    [D3, /\bresin\b|3d printer|3d scanner|spool holder|\bams\b/i],
    [Mo, /gearmotor|pneumatic|solenoid|linear actuator|tyres|wheel|magnet|air pressure tube|xarm/i],
    [S, /lidar|thermal imaging/i],
    [C, /fuse holder|plug|rj45 sl jack|db9/i],
    [I, /mcp3008|ads1115/i],
    [M, /flysky|micro:bit|micro:mate|joystick:bit|sim7600e|littlebits|capture card|pwm signal/i],
    [B, /blue pill|black pill|teensy|fpga|flight controller|lilygo|spike prime/i],
    [T, /./],
  ],
};

/** Store category for a product: name rules for its source category, else the source default, else the fallback. */
export function classify({ name, category }) {
  for (const [cat, re] of RULES[category] ?? []) if (re.test(name ?? "")) return cat;
  return SOURCE_CATEGORY_DEFAULTS[category] ?? T;
}

// ── IO ───────────────────────────────────────────────────────────────────────

function readEnv() {
  const env = {};
  const file = path.join(ROOT, ".env.local");
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

async function fetchPublished() {
  const env = { ...readEnv(), ...process.env };
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing in .env.local");
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(
      `${url}/rest/v1/parts?select=id,sku,name,category,lead_time_class,merged_into&is_published=eq.true&order=id`,
      { headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 999}` } },
    );
    if (!res.ok) throw new Error(`parts fetch failed: HTTP ${res.status}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

const sqlText = (s) => `'${String(s).replace(/'/g, "''")}'`;

function generatedBlock(mapping, counts) {
  const rules = Object.entries(SOURCE_CATEGORY_DEFAULTS)
    .map(([src, cat]) => `  (${sqlText(src)}, ${sqlText(cat)})`)
    .join(",\n");
  const values = mapping.map((r) => `  (${sqlText(r.sku)}, ${sqlText(r.store_category)})`).join(",\n");
  const countLines = STORE_CATEGORIES.map(
    (c) => `--   ${c.padEnd(28)} ${String(counts[c].all).padStart(5)} / ${String(counts[c].listed).padStart(5)}`,
  ).join("\n");
  return `-- BEGIN GENERATED MAPPING (scripts/build-category-migration.mjs — do not edit by hand)
-- ${mapping.length} published products classified; counts per store category
-- (all published / listed = has a delivery date) when generated:
${countLines}

insert into public.store_category_rules (source_category, store_category) values
${rules}
on conflict (source_category) do nothing;

create temp table _m0048_map (sku text primary key, store_category text not null) on commit drop;
insert into _m0048_map (sku, store_category) values
${values};
-- END GENERATED MAPPING`;
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const input = arg("--input");
  const rows = input ? JSON.parse(fs.readFileSync(input, "utf8")) : await fetchPublished();
  const save = arg("--save-input");
  if (save) fs.writeFileSync(save, JSON.stringify(rows));

  const products = rows.filter((r) => !r.merged_into && r.sku !== GIFT_CARD_SKU);
  const mapping = products
    .map((r) => ({ sku: r.sku, name: r.name, source: r.category, listed: !!r.lead_time_class, store_category: classify(r) }))
    .sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0));

  const counts = Object.fromEntries(STORE_CATEGORIES.map((c) => [c, { all: 0, listed: 0 }]));
  for (const r of mapping) {
    counts[r.store_category].all++;
    if (r.listed) counts[r.store_category].listed++;
  }
  console.log(`published products read: ${rows.length} (gift card ${rows.some((r) => r.sku === GIFT_CARD_SKU) ? "still published — 0048 unpublishes it" : "not published"})`);
  console.table(Object.fromEntries(STORE_CATEGORIES.map((c) => [c, counts[c]])));

  const baseline = arg("--baseline");
  if (baseline) {
    const old = new Map(JSON.parse(fs.readFileSync(baseline, "utf8")).map((r) => [r.sku, r]));
    const now = new Map(mapping.map((r) => [r.sku, r]));
    const added = mapping.filter((r) => !old.has(r.sku));
    const removed = [...old.values()].filter((r) => !now.has(r.sku) && r.sku !== GIFT_CARD_SKU);
    const moved = mapping.filter((r) => old.has(r.sku) && old.get(r.sku).nc !== r.store_category);
    console.log(`\nnew since baseline (${added.length}):`);
    for (const r of added) console.log(`  ${r.sku} | ${r.name} | ${r.source} -> ${r.store_category}`);
    console.log(`\nno longer published (${removed.length}):`);
    for (const r of removed) console.log(`  ${r.sku} | ${r.name}`);
    const movedBy = {};
    for (const r of moved) movedBy[`${old.get(r.sku).nc} -> ${r.store_category}`] = (movedBy[`${old.get(r.sku).nc} -> ${r.store_category}`] ?? 0) + 1;
    console.log(`\nchanged vs baseline (${moved.length}):`, movedBy);
    for (const r of moved.filter((x) => !/^3D/.test(x.source))) console.log(`  ${r.sku} | ${r.name} | ${r.source}: ${old.get(r.sku).nc} -> ${r.store_category}`);
  }

  if (process.argv.includes("--dry")) return;
  const sql = fs.readFileSync(MIGRATION, "utf8");
  const re = /-- BEGIN GENERATED MAPPING[\s\S]*?-- END GENERATED MAPPING/;
  if (!re.test(sql)) throw new Error("generated-mapping markers not found in 0048");
  fs.writeFileSync(MIGRATION, sql.replace(re, () => generatedBlock(mapping, counts)));
  console.log(`\nwrote ${mapping.length} rows into ${path.relative(ROOT, MIGRATION)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
