#!/usr/bin/env node
// Read-only: which published products' main photo is narrower than 565 px
// (the product page shows photos up to ~600 CSS px; anything smaller looks soft)?
//
//   node scripts/find-low-res-photos.mjs > low-res.json
//
// - Reads published products (sku, name, image_url) with the anon key from .env.local.
// - Voltaat photos (Shopify CDN): intrinsic widths from Voltaat's public
//   /products.json (images[].width) — about 7 requests, 5 s apart, the same
//   User-Agent as the daily price sync (robots.txt allows /products.json).
// - Other hosts: the first 64 KB of the file (Range request), width read from
//   the JPEG/PNG/WebP/GIF header, 150 ms apart, at most 300 files.
// Writes nothing anywhere; prints JSON (low: [{sku, name, w, h, listed}]).
// Fix is content, not code: replace the photo in Dashboard -> Store.
import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")]; }),
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const UA = "GestaltungPriceSync/1.0 (+https://gestaltung360.com; info@gestaltung360.com)";
const MIN = 565;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function parts() {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${SB}/rest/v1/parts?select=sku,name,image_url,lead_time_class&is_published=eq.true&merged_into=is.null&order=sku`, {
      headers: { apikey: KEY, authorization: `Bearer ${KEY}`, range: `${from}-${from + 999}` },
    });
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

const keyOf = (u) => { try { const x = new URL(u); return x.hostname + x.pathname.replace(/_\d+x\d*(?=\.\w+$)/, ""); } catch { return null; } };

async function voltaatWidths() {
  const map = new Map();
  for (let page = 1; page <= 12; page++) {
    const r = await fetch(`https://voltaat.com/products.json?limit=250&page=${page}`, { headers: { "user-agent": UA, accept: "application/json" } });
    if (!r.ok) { console.error("voltaat", r.status); break; }
    const { products } = await r.json();
    for (const p of products) for (const img of p.images ?? []) {
      const k = keyOf(img.src);
      if (k) map.set(k, { w: img.width, h: img.height });
    }
    if (products.length < 250) break;
    await sleep(5000);
  }
  return map;
}

function dims(buf) {
  if (buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG") return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.toString("ascii", 0, 3) === "GIF") return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const fmt = buf.toString("ascii", 12, 16);
    if (fmt === "VP8X") return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (fmt === "VP8 ") return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (fmt === "VP8L") { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

async function headerDims(url) {
  try {
    const r = await fetch(url, { headers: { range: "bytes=0-65535", "user-agent": UA, accept: "image/jpeg,image/png,image/*" } });
    const buf = Buffer.from(await r.arrayBuffer());
    return dims(buf);
  } catch { return null; }
}

const rows = (await parts()).filter((p) => p.image_url);
console.error(`published with photo: ${rows.length}`);
const shopify = rows.filter((p) => /(^|\.)shopify\.com$/.test(new URL(p.image_url).hostname));
const vw = shopify.length ? await voltaatWidths() : new Map();
const results = [];
let unknown = [];
for (const p of shopify) {
  const d = vw.get(keyOf(p.image_url));
  if (d) results.push({ ...p, ...d, via: "voltaat-json" }); else unknown.push(p);
}
const others = [...rows.filter((p) => !shopify.includes(p)), ...unknown];
console.error(`shopify matched: ${shopify.length - unknown.length}, header-probe: ${others.length}`);
for (const p of others.slice(0, 300)) {
  const d = await headerDims(p.image_url);
  results.push({ ...p, w: d?.w ?? null, h: d?.h ?? null, via: "header" });
  await sleep(150);
}
const low = results.filter((r) => r.w && r.w < MIN).sort((a, b) => a.w - b.w);
const failed = results.filter((r) => !r.w);
console.log(JSON.stringify({ checked: results.length, low: low.map((r) => ({ sku: r.sku, name: r.name, w: r.w, h: r.h, listed: !!r.lead_time_class, via: r.via })), unreadable: failed.map((r) => ({ sku: r.sku, host: new URL(r.image_url).hostname })) }, null, 1));
