#!/usr/bin/env node
// CAD Champions launch check (Prompt 12 Step A): scans the CLIENT build output
// (.next/static, the only files the browser downloads) for server secrets.
// Run after `next build`:  node scripts/cc-secret-scan.mjs
//
// - Every non-NEXT_PUBLIC_ value of 12+ characters in .env.local / .env is
//   looked for verbatim. Only the variable NAME is printed, never the value.
// - Plus fixed markers: a service_role JWT payload, and secret env var names
//   that should never be referenced in browser code.
// - Source check: every "use client" file under app/, components/, lib/ is
//   checked for process.env reads that are not NEXT_PUBLIC_* (or NODE_ENV),
//   and for imports of the service-role client (lib/supabase/service).
// Exit code 1 when anything is found, 2 when there is no build to scan.
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const STATIC_DIR = path.join(ROOT, ".next", "static");

function readEnvSecrets() {
  const secrets = {};
  for (const file of [".env.local", ".env"]) {
    const p = path.join(ROOT, file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      const value = m[2].replace(/^["']|["']$/g, "");
      if (m[1].startsWith("NEXT_PUBLIC_") || value.length < 12) continue;
      secrets[m[1]] = value;
    }
  }
  return secrets;
}

function listFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p));
    else if (/\.(js|mjs|html|json|css|txt|map)$/.test(e.name)) out.push(p);
  }
  return out;
}

// base64 of '"role":"service_role"' as it appears inside a Supabase JWT payload.
const MARKERS = [
  "InJvbGUiOiJzZXJ2aWNlX3JvbGUi",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GRADER_SECRET",
  "SKIPCASH_WEBHOOK_KEY",
  "SKIPCASH_SECRET",
  "TURNSTILE_SECRET_KEY",
  "ANTHROPIC_API_KEY",
  "BUNNY_TOKEN_KEY",
  "CRON_SECRET",
  "RESEND_API_KEY",
];

function listSource(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listSource(p));
    else if (/\.(tsx?|jsx?|mjs)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}

const sourceHits = [];
for (const f of ["app", "components", "lib"].flatMap((d) => listSource(path.join(ROOT, d)))) {
  const text = fs.readFileSync(f, "utf8");
  if (!/^\s*(\/\/[^\n]*\n\s*)*["']use client["']/.test(text)) continue;
  for (const m of text.matchAll(/process\.env\.([A-Z0-9_]+)|process\.env\[/g)) {
    const name = m[1];
    if (name && (name.startsWith("NEXT_PUBLIC_") || name === "NODE_ENV")) continue;
    sourceHits.push(`${path.relative(ROOT, f)}: process.env.${name ?? "[dynamic]"}`);
  }
  if (/from\s+["'][^"']*supabase\/service["']/.test(text)) sourceHits.push(`${path.relative(ROOT, f)}: imports the service-role client`);
}
console.log(`Checked "use client" sources: ${sourceHits.length} problem(s).`);
for (const h of sourceHits) console.log(`FOUND ${h}`);

if (!fs.existsSync(STATIC_DIR)) {
  console.error("No .next/static folder: run `next build` first.");
  process.exit(2);
}
const files = listFiles(STATIC_DIR);
const secrets = readEnvSecrets();
const hits = new Map();
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  for (const [name, value] of Object.entries(secrets)) if (text.includes(value)) hits.set(`value of ${name}`, [...(hits.get(`value of ${name}`) ?? []), f]);
  for (const m of MARKERS) if (text.includes(m)) hits.set(`marker ${m}`, [...(hits.get(`marker ${m}`) ?? []), f]);
}
console.log(`Scanned ${files.length} client files for ${Object.keys(secrets).length} secret values and ${MARKERS.length} markers.`);
if (hits.size === 0 && sourceHits.length === 0) {
  console.log("CC secret scan: OK (nothing found).");
  process.exit(0);
}
for (const [what, where] of hits) console.log(`FOUND ${what} in ${where.length} file(s): ${where.slice(0, 3).map((p) => path.relative(ROOT, p)).join(", ")}`);
process.exit(1);
