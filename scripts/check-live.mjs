#!/usr/bin/env node
/**
 * Read-only live cache probe. No dependencies (Node 18+, global fetch).
 *
 *   node scripts/check-live.mjs [origin]        (default https://gestaltung360.com)
 *
 * Fetches /en, /ar, /en/store, /en/how-it-works, /en/design and /en/pricing
 * twice each (same client, no cookies, one second apart) and prints for every
 * request: status, x-vercel-cache, cache-control, age, content-length and the
 * response time in ms. The last line says whether the SECOND fetch of every
 * page was a HIT. A 404 is printed as-is (/en/pricing does not exist today).
 *
 * Nothing is written or changed on the site. After the table it prints the
 * Lighthouse command and how to read the score.
 */
const origin = (process.argv[2] || "https://gestaltung360.com").replace(/\/$/, "");
const PATHS = ["/en", "/ar", "/en/store", "/en/how-it-works", "/en/design", "/en/pricing"];

const UA =
  "Mozilla/5.0 (Linux; Android 11; Moto G Power) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36 check-live/1.0";
const HEADERS = { "user-agent": UA, accept: "text/html,application/xhtml+xml", "accept-encoding": "br, gzip" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (s, n) => String(s).padEnd(n);

async function probe(path) {
  const t0 = performance.now();
  try {
    const res = await fetch(origin + path, { headers: HEADERS, redirect: "manual" });
    const body = Buffer.from(await res.arrayBuffer());
    const ms = Math.round(performance.now() - t0);
    const cl = res.headers.get("content-length");
    return {
      status: res.status,
      cache: res.headers.get("x-vercel-cache") || "-",
      control: res.headers.get("cache-control") || "-",
      age: res.headers.get("age") ?? "-",
      length: cl ? `${cl} B` : `${body.length} B (body)`,
      ms,
      location: res.headers.get("location"),
    };
  } catch (e) {
    return { status: "ERR", cache: "-", control: String(e.message || e), age: "-", length: "-", ms: Math.round(performance.now() - t0) };
  }
}

console.log(`Origin: ${origin}\n`);
const second = [];
for (const path of PATHS) {
  console.log(path);
  for (const n of [1, 2]) {
    const r = await probe(path);
    if (n === 2) second.push({ path, ...r });
    console.log(
      `  #${n}  status ${pad(r.status, 4)} x-vercel-cache ${pad(r.cache, 10)} age ${pad(r.age, 6)} length ${pad(r.length, 14)} ${pad(r.ms + " ms", 8)}`,
    );
    console.log(`       cache-control: ${r.control}${r.location ? `   -> ${r.location}` : ""}`);
    if (n === 1) await sleep(1000);
  }
}

const ok = second.filter((r) => r.status === 200);
const hits = ok.filter((r) => r.cache.toUpperCase() === "HIT");
const misses = ok.filter((r) => r.cache.toUpperCase() !== "HIT");
console.log("");
if (ok.length === 0) {
  console.log("RESULT: no page returned 200, nothing to judge.");
} else if (misses.length === 0) {
  console.log(`RESULT: 2nd fetch was a HIT for all ${ok.length} pages that returned 200.`);
} else {
  console.log(
    `RESULT: 2nd fetch was a HIT for ${hits.length}/${ok.length} pages that returned 200. Not a HIT: ` +
      misses.map((r) => `${r.path} (${r.cache})`).join(", "),
  );
}
const non200 = second.filter((r) => r.status !== 200);
if (non200.length) console.log("Non-200: " + non200.map((r) => `${r.path} ${r.status}`).join(", "));

console.log(`
Lighthouse (mobile performance, run on your own machine; needs Node + Chrome):

  npx lighthouse@13.5.0 https://gestaltung360.com/en --only-categories=performance --form-factor=mobile --screenEmulation.mobile --output=json --output-path=./lighthouse-home.json

Read the score: open lighthouse-home.json and look at categories.performance.score
(0 to 1; multiply by 100). 90-100 good, 50-89 needs work, below 50 poor. Also note
audits["largest-contentful-paint"].displayValue, ["total-blocking-time"] and
["cumulative-layout-shift"]. Run it 3 times and use the median; a single run
varies by several points. Use a fresh incognito-like profile (Lighthouse does) and
do not run other heavy things on the machine meanwhile.
`);
