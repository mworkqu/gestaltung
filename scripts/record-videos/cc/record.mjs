// Record the CAD Champions walkthrough, one Playwright take per script segment.
//
//   node scripts/record-videos/cc/record.mjs <en|ar> <outRoot> [--base http://localhost:3100] [--only s01-what,s03-sign-up]
//
// Run tts.py first: each take waits until its narration (vo/timings.json)
// has finished, so video >= audio. Writes <outRoot>/<lang>/raw/<id>.webm,
// <outRoot>/<lang>/raw/marks.json ({id: {ready, end}} in seconds since the
// take started; edit.mjs cuts from `ready`) and poster.jpg (segment with
// "poster": true, no cursor).
//
// Re-record after UI or script changes (project root; <out> = any scratch folder):
//   1. E2E_FIXTURES=1 npx next build --no-lint, then E2E_FIXTURES=1 npx next start -p 3100
//   2. python scripts/record-videos/cc/tts.py en <out>   (and ar; only when a narration changed,
//      `tts.py ar <out> s06-sign-in` redoes one segment)
//   3. node scripts/record-videos/cc/record.mjs en <out> (and ar; --only <id> redoes takes)
//   4. node scripts/record-videos/cc/edit.mjs en <out>   (and ar) -> <out>/videos/cc-intro-<lang>/
//   5. node scripts/upload-video.mjs <out>/videos/cc-intro-en (and cc-intro-ar)
//   6. bump FILE_VIDEOS["cc-intro"] (version = upload date, durations) in
//      lib/cad-champions/videos/registry.ts, so browsers fetch the new files.
//
// Recording source = a LOCAL production build started with E2E_FIXTURES=1
// (`npx next start -p 3100`): every signed-in screen is a CC e2e fixture
// (app/[locale]/cad-champions/e2e-fixtures/*), so nothing reaches the
// database. Same guard as e2e/cad-champions/cc.ts:
//   - every server action (POST with a Next-Action header) is answered in the
//     browser with a mock result; the server never runs it;
//   - any non-GET request to Supabase or to the app's /api/* is aborted;
//   - the sign-up and sign-in forms are filled but never submitted, and the
//     check-email page's Resend button is never pressed;
//   - the cookie notice is answered "declined" (no analytics).
// Script actions (script.<lang>.json): goto, wait, hover, hoverText, hoverRole,
// hoverEach, click, clickText, clickRole, type, fill, fillDate, select,
// checkLabel, upload, scroll, scrollText, scrollLabel, scrollTo, smoothBy,
// jump, jumpText, waitText. A text/name can be {"msg": "<file>:<dotted.key>"}: the CC
// message in the take's language (fixed text before the first {placeholder}).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const [lang, outRoot] = process.argv.slice(2);
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : d;
};
if (!["en", "ar"].includes(lang) || !outRoot) {
  console.error("Usage: node scripts/record-videos/cc/record.mjs <en|ar> <outRoot> [--base URL] [--only id1,id2]");
  process.exit(1);
}
const BASE = arg("base", "http://localhost:3100").replace(/\/+$/, "");
const ONLY = arg("only", "") ? new Set(arg("only").split(",")) : null;
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..", "..", "..");
const spec = JSON.parse(fs.readFileSync(path.join(here, `script.${lang}.json`), "utf8"));
const work = path.resolve(outRoot, lang);
const timings = JSON.parse(fs.readFileSync(path.join(work, "vo", "timings.json"), "utf8"));
const rawDir = path.join(work, "raw");
fs.mkdirSync(rawDir, { recursive: true });
const marksFile = path.join(rawDir, "marks.json");
const marks = fs.existsSync(marksFile) ? JSON.parse(fs.readFileSync(marksFile, "utf8")) : {};

/** Narration starts this long after `ready` (edit.mjs uses the same value). */
const VO_LEAD = 0.5;

// ── messages ────────────────────────────────────────────────────────────────
const msgCache = new Map();
function msg(ref) {
  if (typeof ref === "string") return ref;
  const [file, key] = ref.msg.split(":");
  if (!msgCache.has(file)) {
    msgCache.set(file, JSON.parse(fs.readFileSync(path.join(ROOT, "messages", "cad-champions", lang, `${file}.json`), "utf8")));
  }
  const v = key.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), msgCache.get(file));
  if (typeof v !== "string") throw new Error(`missing message ${lang}:${ref.msg}`);
  return v.split(/[{<]/)[0].trim();
}

// ── overlay: cursor dot + click ripple (as ../record.mjs), hidden bits ──────
const PAGE_SCRIPT = `
(() => {
  try { localStorage.setItem("gestaltung:cookie-consent", "declined." + Date.now()); } catch {}
  const install = () => {
    if (document.getElementById("__rec_cursor")) return;
    const s = document.createElement("style");
    s.textContent = \`
      #__rec_cursor{position:fixed;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;
        background:rgba(14,99,212,.55);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);
        pointer-events:none;z-index:2147483647;transition:transform .08s ease-out;}
      #__rec_cursor.down{transform:scale(.75)}
      .__rec_ripple{position:fixed;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;
        border:3px solid rgba(14,99,212,.8);pointer-events:none;z-index:2147483646;animation:__rec_r .55s ease-out forwards}
      @keyframes __rec_r{to{transform:scale(3.6);opacity:0}}
      html.__rec_hide #__rec_cursor{display:none}
      /* The landing's own walkthrough slot (this video) stays out of the take. */
      #cc-intro-video{display:none !important}
      .__rec_todo{visibility:hidden !important}
      nextjs-portal{display:none !important}\`;
    document.documentElement.appendChild(s);
    const c = document.createElement("div");
    c.id = "__rec_cursor";
    c.style.left = (window.__recX ?? 640) + "px"; c.style.top = (window.__recY ?? 400) + "px";
    document.documentElement.appendChild(c);
    document.addEventListener("mousemove", (e) => {
      window.__recX = e.clientX; window.__recY = e.clientY;
      c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px";
    }, true);
    document.addEventListener("mousedown", (e) => {
      c.classList.add("down");
      const r = document.createElement("div");
      r.className = "__rec_ripple"; r.style.left = e.clientX + "px"; r.style.top = e.clientY + "px";
      document.documentElement.appendChild(r);
      setTimeout(() => r.remove(), 700);
    }, true);
    document.addEventListener("mouseup", () => c.classList.remove("down"), true);
    // Owner placeholders ([TODO-MO: …]) never appear in a public video.
    const hideTodos = () => {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (n.nodeValue && n.nodeValue.includes("[TODO-MO")) {
          const el = n.parentElement && (n.parentElement.closest("li") || n.parentElement);
          if (el) el.classList.add("__rec_todo");
        }
      }
    };
    hideTodos();
    setInterval(hideTodos, 250);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
})();`;

// ── server-action mocks (React Flight row, as e2e/cad-champions/cc.ts) ──────
const ALMOST_DONE = [
  "welcome_video", "check_computer", "install_software", "essential_actions",
  ...["units_mm", "material_density", "export_step", "export_pdf", "find_upload"].map((k) => `essential_actions__${k}`),
  "test_day_checklist",
  ...["time_90", "charged", "close_apps", "cad_ready", "know_exports", "upload_each", "work_alone"].map((k) => `test_day_checklist__${k}`),
];
function mockResult(args) {
  const a0 = Array.isArray(args) ? args[0] : undefined;
  if (typeof a0 === "string" && a0.includes("/practice/")) {
    return { ok: true, outcome: "passed", keys: [...ALMOST_DONE, "practice_upload"], complete: true, justCompleted: true, basicCheckOnly: false };
  }
  if (a0 && typeof a0 === "object" && "taskId" in a0) return { ok: true, uploadedAt: new Date().toISOString(), replacedCount: 0 };
  return { ok: true };
}
const flightSafe = (v) =>
  typeof v === "string" ? (v.startsWith("$") ? `$${v}` : v)
  : Array.isArray(v) ? v.map(flightSafe)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, flightSafe(x)]))
  : v === undefined ? null : v;
const flightBody = (value) => `0:${JSON.stringify({ a: flightSafe(value), f: "", b: "rec" })}\n`;

// Task ids of the e2e fixtures (fixture-data.ts FX.task1 / FX.task2).
const SAMPLE_STATUS = {
  tasks: [
    { id: "00000000-0000-4000-8000-000000000c01", state: "done" },
    { id: "00000000-0000-4000-8000-000000000c02", state: "checking" },
  ],
};
const STEP_TEXT = "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('walkthrough sample'),'2;1');\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n";
const appOrigin = new URL(BASE).origin;
const supabaseHost = (() => {
  try {
    const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").match(/^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m)?.[1];
    return env ? new URL(env.trim().replace(/^["']|["']$/g, "")).host : null;
  } catch {
    return null;
  }
})();
const blocked = [];

async function guard(context) {
  await context.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const write = !["GET", "HEAD", "OPTIONS"].includes(method);
    if (url.origin === appOrigin && method === "POST" && (await req.headerValue("next-action"))) {
      let args = null;
      try {
        args = JSON.parse(req.postData() ?? "");
      } catch {
        /* FormData action: still mocked */
      }
      return route.fulfill({ status: 200, headers: { "content-type": "text/x-component" }, body: flightBody(mockResult(args)) });
    }
    // The submitted screen polls its task states (needs a session): answer
    // with a sample (task 1 checked, task 2 still checking).
    if (url.origin === appOrigin && method === "GET" && /^\/api\/cad-champions\/attempts\/[^/]+\/status$/.test(url.pathname)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SAMPLE_STATUS) });
    }
    const toSupabase = url.host === supabaseHost || url.host.endsWith(".supabase.co");
    if ((toSupabase && write) || (toSupabase && /\/auth\/v1\/(signup|token|otp|recover|resend)/.test(url.pathname)) || (url.origin === appOrigin && url.pathname.startsWith("/api/") && write)) {
      blocked.push(`${method} ${url.host}${url.pathname}`);
      return route.abort("blockedbyclient");
    }
    return route.fallback();
  });
}

// ── one take ────────────────────────────────────────────────────────────────
const browser = await chromium.launch();

async function take(seg) {
  const dir = path.join(rawDir, `tmp-${seg.id}`);
  fs.rmSync(dir, { recursive: true, force: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    locale: lang === "ar" ? "ar-QA" : "en-GB",
    timezoneId: "Asia/Qatar",
    recordVideo: { dir, size: { width: 1280, height: 720 } },
  });
  await guard(context);
  await context.addInitScript(PAGE_SCRIPT);
  if (seg.pendingEmail) {
    await context.addInitScript((email) => {
      try {
        sessionStorage.setItem("cc:pending-email", email);
      } catch {
        /* storage blocked */
      }
    }, seg.pendingEmail);
  }
  const page = await context.newPage();
  const t0 = Date.now();
  let mouse = { x: 640, y: 400 };
  const wait = (ms) => page.waitForTimeout(ms);
  const goto = (u) => page.goto(`${BASE}${u}`, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});

  const textLoc = (t) => page.getByText(msg(t), { exact: false }).first();
  const roleLoc = (a) => {
    const all = page.getByRole(a.role, { name: msg(a.name), exact: !!a.exact });
    return a.nth === "last" ? all.last() : all.first();
  };
  const selLoc = (a) => (a.parent ? page.locator(a.sel).first().locator("xpath=..") : page.locator(a.sel).first());

  async function moveTo(locator, { instant = false } = {}) {
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    const box = await locator.boundingBox();
    if (!box) throw new Error("no box");
    const x = box.x + Math.min(box.width / 2, 160);
    const y = box.y + box.height / 2;
    const dist = Math.hypot(x - mouse.x, y - mouse.y);
    await page.mouse.move(x, y, { steps: instant ? 1 : Math.max(12, Math.round(dist / 14)) });
    mouse = { x, y };
  }
  async function clickAt(locator, opts) {
    await moveTo(locator, opts);
    if (!opts?.instant) await wait(260);
    await page.mouse.down();
    await wait(70);
    await page.mouse.up();
  }
  async function smoothScroll(total) {
    const step = 7;
    const n = Math.ceil(Math.abs(total) / step);
    for (let i = 0; i < n; i++) {
      await page.evaluate((s) => window.scrollBy(0, s), Math.sign(total) * step);
      await wait(14);
    }
  }
  async function scrollToLocator(locator, offset = 100) {
    const y = await locator.evaluate((el) => el.getBoundingClientRect().top);
    await smoothScroll(y - offset);
  }

  async function run(a, instant = false) {
    switch (a.do) {
      case "wait": return wait(a.ms);
      case "goto": return goto(a.url);
      case "hover": return moveTo(selLoc(a), { instant });
      case "hoverText": return moveTo(textLoc(a.text), { instant });
      case "hoverRole": return moveTo(roleLoc(a), { instant });
      case "hoverEach": {
        const items = await page.locator(a.sel).all();
        for (const it of items) {
          if (!(await it.isVisible())) continue;
          await moveTo(it);
          await wait(a.ms ?? 1000);
        }
        return;
      }
      case "click": return clickAt(selLoc(a), { instant: instant || a.instant });
      case "clickText": return clickAt(textLoc(a.text), { instant: instant || a.instant });
      case "clickRole": return clickAt(roleLoc(a), { instant: instant || a.instant });
      case "type": {
        await clickAt(selLoc(a), { instant });
        await wait(200);
        return page.keyboard.type(a.text, { delay: instant ? 0 : 55 });
      }
      case "fill": return selLoc(a).fill(a.text);
      case "fillDate": {
        await clickAt(selLoc(a), { instant });
        await wait(300);
        return selLoc(a).fill(a.value);
      }
      case "select": {
        await clickAt(selLoc(a), { instant });
        await wait(350);
        return selLoc(a).selectOption({ index: a.index });
      }
      case "checkLabel": {
        const box = page.getByLabel(msg(a.label), { exact: false }).first();
        return clickAt(box, { instant });
      }
      case "upload": return page.locator(a.sel).first().setInputFiles({ name: a.name, mimeType: "application/step", buffer: Buffer.from(STEP_TEXT) });
      case "scroll": return scrollToLocator(page.locator(a.to).first(), a.offset);
      case "scrollTo": return scrollToLocator(page.locator(a.sel).first(), a.offset);
      case "scrollText": return scrollToLocator(textLoc(a.text), a.offset);
      case "scrollLabel": return scrollToLocator(page.getByLabel(msg(a.label), { exact: false }).first(), a.offset);
      case "smoothBy": return smoothScroll(a.px);
      case "jump": {
        const y = await page.locator(a.to).first().evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
        return page.evaluate((top) => window.scrollTo(0, top), y - (a.offset ?? 100));
      }
      case "jumpText": {
        const y = await textLoc(a.text).evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
        return page.evaluate((top) => window.scrollTo(0, top), y - (a.offset ?? 100));
      }
      case "waitText": return textLoc(a.text).waitFor({ state: "visible", timeout: 15000 });
      default: throw new Error(`unknown action ${a.do}`);
    }
  }

  await goto(seg.url);
  for (const a of seg.prep ?? []) await run(a, true);
  await page.mouse.move(mouse.x, mouse.y);
  await wait(400);
  const ready = (Date.now() - t0) / 1000;
  if (seg.poster) {
    await page.evaluate(() => document.documentElement.classList.add("__rec_hide"));
    await page.screenshot({ path: path.join(rawDir, "poster.jpg"), type: "jpeg", quality: 92 });
    await page.evaluate(() => document.documentElement.classList.remove("__rec_hide"));
  }
  for (const a of seg.actions) {
    try {
      await run(a);
    } catch (e) {
      console.warn(`  ${seg.id}: ${a.do} failed: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
      await page.screenshot({ path: path.join(rawDir, `debug-${seg.id}.png`) }).catch(() => {});
    }
  }
  // Hold until the narration (plus the segment's tail) is over.
  const need = VO_LEAD + (timings[seg.id]?.duration ?? 0) + (seg.holdSeconds ?? 1);
  const spent = (Date.now() - t0) / 1000 - ready;
  if (spent < need) await wait((need - spent) * 1000);
  const end = (Date.now() - t0) / 1000;
  const video = page.video();
  await context.close();
  const src = await video.path();
  fs.renameSync(src, path.join(rawDir, `${seg.id}.webm`));
  fs.rmSync(dir, { recursive: true, force: true });
  marks[seg.id] = { ready: +ready.toFixed(2), end: +end.toFixed(2), actions: +spent.toFixed(2), narration: timings[seg.id]?.duration ?? 0 };
  const over = spent - (need - (seg.holdSeconds ?? 1));
  console.log(`${seg.id}: actions ${spent.toFixed(1)} s, narration ${(timings[seg.id]?.duration ?? 0).toFixed(1)} s, take ${(end - ready).toFixed(1)} s${over > 2 ? `  (actions run ${over.toFixed(1)} s past the voice)` : ""}`);
}

for (const seg of spec.segments) {
  if (ONLY && !ONLY.has(seg.id)) continue;
  await take(seg);
  fs.writeFileSync(marksFile, JSON.stringify(marks, null, 2));
}
await browser.close();
if (blocked.length) {
  console.error(`\nBLOCKED ${blocked.length} write request(s) (nothing reached the server):\n  ${[...new Set(blocked)].join("\n  ")}`);
}
