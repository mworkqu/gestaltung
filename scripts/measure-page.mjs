#!/usr/bin/env node
/**
 * Read-only page-weight probe. No dependencies (Node 18+, global fetch).
 *
 *   node scripts/measure-page.mjs <baseUrl> <path> [<path> ...] [--json] [--detail]
 *
 * (Git Bash on Windows rewrites a leading-slash argument into a C:/ path: use
 * PowerShell, or set MSYS_NO_PATHCONV=1.)
 *
 * Paths may be literal ("/en", "/en/store/cart") or the token "@first-product",
 * which is resolved to the first product link found in the /en/store HTML.
 *
 * For every path it fetches the HTML twice (FIRST and SECOND request, one
 * second apart, same client, no cookies) and reports:
 *   - HTML size (raw bytes, transfer size = content-length when the server
 *     sends it, otherwise an estimate = brotli q5 of the body)
 *   - inline <script> bytes (RSC payload + next-intl messages live here)
 *   - external JS (unique <script src> + modulepreload, each fetched once)
 *   - CSS (unique stylesheet links), preloaded fonts (rel=preload as=font)
 *   - images found in the HTML (<img src>, <link rel=preload as=image>);
 *     data: URIs skipped. For srcset the candidate a 2x phone would pick is
 *     used (x descriptors: 2x; w descriptors: smallest >= 828w), fetched with
 *     the Accept header a browser sends so /_next/image returns avif/webp.
 *   - request count = HTML + every unique resource above
 *   - x-vercel-cache, cache-control, age for the FIRST and SECOND request
 *   - any non-200 resource
 * Sizes are bytes on the wire where known (content-length), else decoded size.
 * Images referenced only from CSS or loaded by client JS are not seen: this is
 * a static-HTML view, not a browser. Use Lighthouse for runtime behaviour.
 */
import { brotliCompressSync, constants as zc } from "node:zlib";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const positional = argv.filter((a) => !a.startsWith("--"));
const base = (positional[0] || "https://gestaltung360.com").replace(/\/$/, "");
const inputPaths = positional.slice(1).length ? positional.slice(1) : ["/en", "/en/store"];

const UA =
  "Mozilla/5.0 (Linux; Android 11; Moto G Power) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36 measure-page/1.0";
const HTML_HEADERS = {
  "user-agent": UA,
  accept: "text/html,application/xhtml+xml",
  "accept-encoding": "br, gzip",
};
const IMG_HEADERS = {
  "user-agent": UA,
  accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
  "accept-encoding": "br, gzip",
};
const ASSET_HEADERS = { "user-agent": UA, accept: "*/*", "accept-encoding": "br, gzip" };

const kb = (n) => Math.round((n / 1024) * 10) / 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const abs = (href, from) => {
  try {
    return new URL(href.replace(/&amp;/g, "&"), from).toString();
  } catch {
    return null;
  }
};

async function get(url, headers) {
  const res = await fetch(url, { headers, redirect: "follow" });
  const buf = Buffer.from(await res.arrayBuffer());
  const cl = Number(res.headers.get("content-length"));
  return {
    url,
    status: res.status,
    headers: res.headers,
    body: buf,
    decoded: buf.length,
    wire: Number.isFinite(cl) && cl > 0 ? cl : null,
    type: res.headers.get("content-type") || "",
  };
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? (m[2] ?? m[3] ?? m[4] ?? "") : null;
}

function pickSrcset(srcset, from) {
  const cands = srcset
    .split(/,(?=\s*\S+\s+\d)|,\s+(?=\/|http)/)
    .map((s) => s.trim().split(/\s+/))
    .filter((p) => p[0]);
  if (!cands.length) return null;
  const parsed = cands.map(([u, d]) => ({ u, d: d || "1x" }));
  const w = parsed.filter((p) => p.d.endsWith("w")).map((p) => ({ ...p, n: parseInt(p.d, 10) }));
  let chosen;
  if (w.length) {
    w.sort((a, b) => a.n - b.n);
    chosen = w.find((p) => p.n >= 828) || w[w.length - 1];
  } else {
    chosen = parsed.find((p) => p.d === "2x") || parsed[parsed.length - 1];
  }
  return abs(chosen.u, from);
}

function parseHtml(html, pageUrl) {
  const inline = [];
  const scripts = new Set();
  const styles = new Set();
  const fonts = new Set();
  const images = new Map(); // url -> { lazy }
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const src = attr(m[0].slice(0, m[0].indexOf(">") + 1), "src");
    if (src) {
      const u = abs(src, pageUrl);
      if (u) scripts.add(u);
    } else {
      inline.push(Buffer.byteLength(m[2]));
    }
  }
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = (attr(tag, "rel") || "").toLowerCase();
    const as = (attr(tag, "as") || "").toLowerCase();
    const href = attr(tag, "href");
    if (rel.includes("modulepreload") && href) scripts.add(abs(href, pageUrl));
    else if (rel === "preload" && as === "script" && href) scripts.add(abs(href, pageUrl));
    else if (rel.includes("stylesheet") && href) styles.add(abs(href, pageUrl));
    else if (rel === "preload" && as === "font" && href) fonts.add(abs(href, pageUrl));
    else if (rel === "preload" && as === "image") {
      const ss = attr(tag, "imagesrcset");
      const u = ss ? pickSrcset(ss, pageUrl) : href ? abs(href, pageUrl) : null;
      if (u && !u.startsWith("data:")) images.set(u, { lazy: false });
    }
  }
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const ss = attr(tag, "srcset");
    const src = attr(tag, "src");
    let u = ss ? pickSrcset(ss, pageUrl) : src ? abs(src, pageUrl) : null;
    if (!u || (src && src.startsWith("data:") && !ss)) continue;
    if (u.startsWith("data:")) continue;
    const lazy = (attr(tag, "loading") || "").toLowerCase() === "lazy";
    const prev = images.get(u);
    images.set(u, { lazy: prev ? prev.lazy && lazy : lazy });
  }
  return {
    inlineScripts: inline,
    scripts: [...scripts].filter(Boolean),
    styles: [...styles].filter(Boolean),
    fonts: [...fonts].filter(Boolean),
    images,
  };
}

async function fetchAll(urls, headers) {
  const out = [];
  const queue = [...urls];
  const workers = Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const u = queue.shift();
      try {
        out.push(await get(u, headers));
      } catch (e) {
        out.push({ url: u, status: 0, wire: null, decoded: 0, type: "", err: String(e) });
      }
    }
  });
  await Promise.all(workers);
  return out;
}

const size = (r) => r.wire ?? r.decoded;
const sum = (rs) => rs.reduce((a, r) => a + size(r), 0);
const hdr = (r, n) => r.headers.get(n) ?? "-";

async function resolveProduct() {
  const r = await get(`${base}/en/store`, HTML_HEADERS);
  const html = r.body.toString("utf8");
  const re = /href="(\/en\/store\/(?!cart|checkout)([^"/?#]+))"/g;
  const m = re.exec(html);
  return m ? m[1] : null;
}

async function measure(path) {
  const pageUrl = `${base}${path}`;
  const first = await get(pageUrl, HTML_HEADERS);
  await sleep(1000);
  const second = await get(pageUrl, HTML_HEADERS);
  const html = first.body.toString("utf8");
  const p = parseHtml(html, pageUrl);
  // Next also announces preloads in the Link response header (fonts, css); the
  // streamed HTML may not repeat them, so merge them in.
  for (const m of (first.headers.get('link') || '').matchAll(/<([^>]+)>;([^,<]*)/g)) {
    const meta = m[2].toLowerCase();
    if (!/rel="?preload/.test(meta)) continue;
    const u = abs(m[1], pageUrl);
    if (!u) continue;
    if (/as="?font/.test(meta) && !p.fonts.includes(u)) p.fonts.push(u);
    else if (/as="?style/.test(meta) && !p.styles.includes(u)) p.styles.push(u);
    else if (/as="?script/.test(meta) && !p.scripts.includes(u)) p.scripts.push(u);
  }
  const [jsAll, css, fonts, imgs] = await Promise.all([
    fetchAll(p.scripts, ASSET_HEADERS),
    fetchAll(p.styles, ASSET_HEADERS),
    fetchAll(p.fonts, ASSET_HEADERS),
    fetchAll([...p.images.keys()], IMG_HEADERS),
  ]);
  const origin = new URL(base).origin;
  const js = jsAll.filter((r) => r.url.startsWith(origin));
  const js3p = jsAll.filter((r) => !r.url.startsWith(origin));
  const inlineBytes = p.inlineScripts.reduce((a, b) => a + b, 0);
  const htmlWire =
    first.wire ?? brotliCompressSync(first.body, { params: { [zc.BROTLI_PARAM_QUALITY]: 5 } }).length;
  const eager = imgs.filter((i) => !(p.images.get(i.url)?.lazy));
  const all = [...jsAll, ...css, ...fonts, ...imgs];
  return {
    path,
    status: first.status,
    htmlRawKB: kb(first.decoded),
    htmlWireKB: kb(htmlWire),
    htmlWireEstimated: first.wire == null,
    inlineScriptKB: kb(inlineBytes),
    inlineScriptCount: p.inlineScripts.length,
    jsKB: kb(sum(js)),
    jsCount: js.length,
    thirdPartyJsKB: kb(sum(js3p)),
    thirdPartyJsCount: js3p.length,
    cssKB: kb(sum(css)),
    cssCount: css.length,
    fontKB: kb(sum(fonts)),
    fontCount: fonts.length,
    imageKB: kb(sum(imgs)),
    imageCount: imgs.length,
    eagerImageKB: kb(sum(eager)),
    eagerImageCount: eager.length,
    requests: 1 + all.length,
    totalKB: kb(htmlWire + sum(all)),
    first: { cache: hdr(first, "x-vercel-cache"), cc: hdr(first, "cache-control"), age: hdr(first, "age") },
    second: { cache: hdr(second, "x-vercel-cache"), cc: hdr(second, "cache-control"), age: hdr(second, "age") },
    nonOk: all.filter((r) => r.status !== 200).map((r) => `${r.status} ${r.url}`),
    fontFiles: fonts.map((f) => `${new URL(f.url).pathname.split("/").pop()} (${kb(size(f))} KB)`),
    detail: flags.has("--detail")
      ? all.map((r) => `${r.status} ${kb(size(r))} KB ${r.type.split(";")[0]} ${r.url.replace(base, "")}`)
      : undefined,
  };
}

const paths = [];
for (const p of inputPaths) {
  if (p === "@first-product") {
    const found = await resolveProduct();
    if (!found) console.error("no product link found in /en/store HTML");
    else paths.push(found);
  } else paths.push(p.startsWith("/") ? p : `/${p}`);
}

const results = [];
for (const p of paths) {
  try {
    results.push(await measure(p));
  } catch (e) {
    results.push({ path: p, error: String(e) });
  }
}

if (flags.has("--json")) {
  console.log(JSON.stringify({ base, at: new Date().toISOString(), results }, null, 2));
} else {
  console.log(`Base ${base}  at ${new Date().toISOString()}\n`);
  console.log(
    "| Path | HTML KB raw / wire | Inline JS KB | External JS KB (n) | 3rd-party JS KB (n) | CSS KB (n) | Fonts KB (n) | Images KB (n) | Requests | Total KB | 1st: cache / age | 2nd: cache / age |",
  );
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    if (r.error) {
      console.log(`| ${r.path} | ERROR ${r.error} |`);
      continue;
    }
    console.log(
      `| ${r.path} | ${r.htmlRawKB} / ${r.htmlWireKB}${r.htmlWireEstimated ? "*" : ""} | ${r.inlineScriptKB} (${r.inlineScriptCount}) | ${r.jsKB} (${r.jsCount}) | ${r.thirdPartyJsKB} (${r.thirdPartyJsCount}) | ${r.cssKB} (${r.cssCount}) | ${r.fontKB} (${r.fontCount}) | ${r.imageKB} (${r.imageCount}; eager ${r.eagerImageKB} / ${r.eagerImageCount}) | ${r.requests} | ${r.totalKB} | ${r.first.cache} / ${r.first.age} | ${r.second.cache} / ${r.second.age} |`,
    );
  }
  console.log("\n(* wire size estimated: brotli q5 of body, server sent no content-length)\n");
  for (const r of results) {
    if (r.error) continue;
    console.log(`${r.path}`);
    console.log(`  cache-control 1st: ${r.first.cc}`);
    console.log(`  cache-control 2nd: ${r.second.cc}`);
    console.log(`  fonts: ${r.fontFiles.join(", ") || "none"}`);
    if (r.nonOk.length) console.log(`  NON-200: ${r.nonOk.join(" | ")}`);
    if (r.detail) for (const d of r.detail) console.log(`    ${d}`);
  }
}
