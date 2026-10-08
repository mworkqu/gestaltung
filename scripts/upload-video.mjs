// Upload one feature video to the public Supabase bucket `videos` (migration 0049).
//
//   node scripts/upload-video.mjs <folder>
//
// The folder name is the slug (idea-to-kit, file-to-part, sketch-to-drawing,
// wiring-check, cad-model, store-to-door) and holds up to five files:
//   <slug>.mp4  <slug>.webm  <slug>.jpg  <slug>.en.vtt  <slug>.ar.vtt
// Each present file is uploaded to videos/<slug>/<file> (existing files are
// replaced). Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, read
// from .env.local (run from the project root) or the environment. The key is
// never printed. Exits 1 if any upload fails.
import fs from "node:fs";
import path from "node:path";

const SLUGS = ["idea-to-kit", "file-to-part", "sketch-to-drawing", "wiring-check", "cad-model", "store-to-door"];
// Keep in step with lib/videos.ts (VIDEO_FILES / VIDEO_CONTENT_TYPES).
const FILES = [
  ["mp4", "video/mp4"],
  ["webm", "video/webm"],
  ["jpg", "image/jpeg"],
  ["en.vtt", "text/vtt"],
  ["ar.vtt", "text/vtt"],
];

function readEnvFile() {
  if (!fs.existsSync(".env.local")) return {};
  return Object.fromEntries(
    fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")]; }),
  );
}

const folder = process.argv[2];
if (!folder) {
  console.error("Usage: node scripts/upload-video.mjs <folder>   (folder name = slug)");
  process.exit(1);
}
const dir = path.resolve(folder);
const slug = path.basename(dir);
if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
  console.error(`Not a folder: ${dir}`);
  process.exit(1);
}
if (!SLUGS.includes(slug)) {
  console.error(`Unknown slug "${slug}". The folder must be named one of: ${SLUGS.join(", ")}`);
  process.exit(1);
}

const env = { ...readEnvFile(), ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v)) };
const url = (env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (.env.local or environment).");
  process.exit(1);
}

let failed = 0;
const missing = [];
for (const [ext, type] of FILES) {
  const name = `${slug}.${ext}`;
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) {
    missing.push(name);
    continue;
  }
  const body = fs.readFileSync(file);
  try {
    const res = await fetch(`${url}/storage/v1/object/videos/${slug}/${name}`, {
      method: "POST",
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        "x-upsert": "true",
        "content-type": type,
        "cache-control": "max-age=31536000",
      },
      body,
    });
    if (!res.ok) {
      failed++;
      const detail = (await res.text()).slice(0, 300);
      console.error(`FAILED  ${name}  (${res.status}) ${detail}`);
      continue;
    }
    console.log(`ok      ${(body.length / 1048576).toFixed(2)} MB  ${url}/storage/v1/object/public/videos/${slug}/${name}`);
  } catch (e) {
    failed++;
    console.error(`FAILED  ${name}  ${e instanceof Error ? e.message : e}`);
  }
}

if (missing.length) console.log(`\nMissing (not uploaded): ${missing.join(", ")}`);
if (failed) {
  console.error(`\n${failed} upload(s) failed.`);
  process.exit(1);
}
console.log("\nDone. When all five files are up, set published: true and the real uploadDate for this slug in lib/videos.ts.");
