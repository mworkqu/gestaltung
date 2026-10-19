// Record one feature-video take from the LIVE site with Playwright (P3-04).
//
//   node scripts/record-videos/record.mjs <slug> <outRoot> [--base https://gestaltung360.com]
//
// Writes <outRoot>/<slug>/raw.webm (Playwright's screen recording),
// marks.json (seconds since the recording started, one per step, used by
// edit.mjs to cut and to time the captions) and poster-*.jpg candidates.
//
// Guest-only, by design (the site's database is production):
//   - never signs in, never types a password, never places an order, never
//     submits the contact / quote / drawing forms;
//   - idea-to-kit creates ONE guest project (its id is printed and saved to
//     project.json); store-to-door adds one guest cart line;
//   - the cookie bar is always answered with "Decline" (no analytics).
// The guest session of idea-to-kit is saved to <outRoot>/idea-to-kit/state.json
// (scratch only, never commit) so the project can be revisited or renamed.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const [slug, outRoot] = process.argv.slice(2);
const baseArg = process.argv.indexOf("--base");
const BASE = (baseArg > 0 ? process.argv[baseArg + 1] : "https://gestaltung360.com").replace(/\/+$/, "");
const STATE = process.argv.includes("--state") ? process.argv[process.argv.indexOf("--state") + 1] : null;
if (!slug || !outRoot) {
  console.error("Usage: node scripts/record-videos/record.mjs <slug> <outRoot> [--base URL] [--state state.json]");
  process.exit(1);
}
const dir = path.resolve(outRoot, slug);
fs.mkdirSync(dir, { recursive: true });

// ── visible cursor + click ripple ───────────────────────────────────────────
const CURSOR_SCRIPT = `
(() => {
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
      /* The site's own feature-video slots still hold placeholder posters
         while these clips are being made: keep them out of the recording. */
      figure > .neu-inset > video, figure > .neu-inset > img{opacity:0 !important}\`;
    document.documentElement.appendChild(s);
    const c = document.createElement("div");
    c.id = "__rec_cursor";
    const x = window.__recX ?? -40, y = window.__recY ?? -40;
    c.style.left = x + "px"; c.style.top = y + "px";
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
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
})();`;

// "-ar" recipes record the Arabic site (YouTube versions).
const AR = slug.endsWith("-ar");
// -ar and -en takes are the YouTube cuts: wider page, 1600x900.
const YT = AR || slug.endsWith("-en");
const browser = await chromium.launch();
const context = await browser.newContext({
  // -ar (YouTube) takes: a wider page (1600x900 CSS px). Playwright paints the
  // video in CSS pixels, so the frame size must equal the viewport (a bigger
  // frame only adds grey bands); youtube.mjs scales it up to 1080p.
  viewport: YT ? { width: 1600, height: 900 } : { width: 1280, height: 720 },
  deviceScaleFactor: YT ? 1.2 : 1,
  locale: AR ? "ar-QA" : "en-GB",
  timezoneId: "Asia/Qatar",
  recordVideo: { dir, size: YT ? { width: 1600, height: 900 } : { width: 1280, height: 720 } },
  ...(STATE ? { storageState: STATE } : {}),
});
await context.addInitScript(CURSOR_SCRIPT);
const page = await context.newPage();
const t0 = Date.now();
const marks = [];
let mouse = { x: 640, y: 360 };

const wait = (ms) => page.waitForTimeout(ms);
function mark(label) {
  const t = +((Date.now() - t0) / 1000).toFixed(2);
  marks.push({ label, t });
  console.log(`[${t.toFixed(2)}s] ${label}`);
}
async function shot(name) {
  await page.evaluate(() => document.documentElement.classList.add("__rec_hide"));
  await page.screenshot({ path: path.join(dir, `poster-${name}.jpg`), type: "jpeg", quality: 90 });
  await page.evaluate(() => document.documentElement.classList.remove("__rec_hide"));
}
async function debug(name) {
  await page.screenshot({ path: path.join(dir, `debug-${name}.png`) }).catch(() => {});
}
async function moveTo(locator, { dx = 0, dy = 0 } = {}) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("no box for locator");
  const x = box.x + box.width / 2 + dx;
  const y = box.y + box.height / 2 + dy;
  const dist = Math.hypot(x - mouse.x, y - mouse.y);
  await page.mouse.move(x, y, { steps: Math.max(12, Math.round(dist / 14)) });
  mouse = { x, y };
}
async function click(locator, opts) {
  await moveTo(locator, opts);
  await wait(280);
  await page.mouse.down();
  await wait(70);
  await page.mouse.up();
}
async function typeInto(locator, text) {
  await click(locator);
  await wait(250);
  await page.keyboard.type(text, { delay: 60 });
}
async function smoothScroll(total, { step = 6, every = 16 } = {}) {
  const n = Math.ceil(Math.abs(total) / step);
  for (let i = 0; i < n; i++) {
    await page.evaluate((s) => window.scrollBy(0, s), Math.sign(total) * step);
    await wait(every);
  }
}
async function scrollToEl(locator, offset = 120) {
  const y = await locator.evaluate((el) => el.getBoundingClientRect().top);
  await smoothScroll(y - offset);
}
async function declineCookies() {
  const decline = page.getByRole("button", { name: AR ? "رفض" : "Decline", exact: true });
  try {
    await decline.first().waitFor({ state: "visible", timeout: 4000 });
    await click(decline.first());
    await wait(400);
  } catch {
    /* no cookie bar (already answered or not shown) */
  }
}
async function goto(url) {
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
}

// ── clips ───────────────────────────────────────────────────────────────────
const CLIPS = {
  async "idea-to-kit"() {
    await goto("/en");
    await declineCookies();
    await wait(800);
    mark("home");
    await wait(1500);
    const start = page.getByRole("link", { name: "Start a project" }).first();
    await click(start);
    await page.waitForURL(/\/projects\/new/, { timeout: 30000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    await wait(900);
    mark("new");
    const consent = page.locator("#new-project-consent");
    const input = page.getByPlaceholder(/handheld milk frother/i);
    await typeInto(input, "A plant monitor that waters a small pot when the soil is dry, with a USB power supply and a 3D-printed case");
    mark("typed");
    await wait(600);
    await click((await consent.count()) ? consent : page.getByRole("checkbox").first());
    await wait(700);
    mark("consent");
    await click(page.getByRole("button", { name: "Start", exact: true }));
    mark("start");
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}\/prototyping/, { timeout: 90000 });
    const projectId = page.url().match(/projects\/([0-9a-f-]{36})/)[1];
    fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify({ projectId, url: page.url() }, null, 2));
    console.log(`PROJECT ${projectId}`);
    await context.storageState({ path: path.join(dir, "state.json") });
    await page.waitForLoadState("networkidle").catch(() => {});
    mark("workspace");
    await debug("workspace");
    // The first chat reply (questions) comes from /api/brief-chat.
    const analyse = page.getByRole("button", { name: /^(Analyse brief|Re-analyse brief)$/ });
    await analyse.first().waitFor({ state: "visible", timeout: 90000 }).catch(() => {});
    await wait(1200);
    mark("reply");
    await debug("reply");
    await wait(3500);
    const btn = (await analyse.count()) ? analyse.first() : page.getByRole("button", { name: /analyse/i }).first();
    await click(btn);
    mark("analyse");
    // Wait for the analysis to finish: the button text returns to "Re-analyse brief".
    await page.getByRole("button", { name: "Re-analyse brief" }).first().waitFor({ state: "visible", timeout: 240000 }).catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    await wait(1500);
    mark("analysed");
    await debug("analysed");
    const bom = page.getByRole("button", { name: /Bill of materials/ }).or(page.getByRole("link", { name: /Bill of materials/ }));
    await click(bom.first());
    await page.waitForLoadState("networkidle").catch(() => {});
    await wait(2500);
    mark("bom");
    await debug("bom");
    await shot("bom");
    await moveTo(page.locator("main").first(), { dy: 120 }).catch(() => {});
    await smoothScroll(220);
    await wait(2500);
    mark("bom-scrolled");
    await shot("bom-scrolled");
    await wait(4000);
    mark("end");
    // Off camera (trimmed): name the demo project on its project page.
    await goto(`/en/projects/${projectId}`);
    const nameInput = page.getByLabel("Project name", { exact: true }).first();
    await nameInput.waitFor({ state: "visible", timeout: 30000 });
    await nameInput.fill("Demo video — plant monitor");
    await nameInput.blur();
    await wait(2500);
    await page.reload({ waitUntil: "networkidle" });
    console.log(`RENAMED ${await page.getByLabel("Project name", { exact: true }).first().inputValue()}`);
  },

  // Arabic YouTube version of idea-to-kit: the current "Plan a product" flow
  // (Design Studio) on /ar, as a guest. Creates ONE guest project (saved to
  // project.json); answers the Studio's tap questions, stops on the parts list.
  async "idea-to-kit-ar"() {
    await goto("/ar");
    await declineCookies();
    await wait(800);
    mark("home");
    await wait(1500);
    await click(page.getByRole("link", { name: "ابدأ مشروعك" }).first());
    await page.waitForURL(/\/projects\/new/, { timeout: 30000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    await wait(900);
    mark("new");
    await typeInto(page.getByPlaceholder(/خفّاقة حليب/).first(), "جهاز يسقي نبتة صغيرة تلقائيًا عندما تجف التربة، يعمل بمحوّل USB وله علبة مطبوعة ثلاثية الأبعاد");
    mark("typed");
    await wait(600);
    await click(page.getByRole("checkbox").first());
    await wait(700);
    mark("consent");
    await click(page.getByRole("button", { name: "ابدأ", exact: true }));
    mark("start");
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}\/studio/, { timeout: 90000 });
    const projectId = page.url().match(/projects\/([0-9a-f-]{36})/)[1];
    fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify({ projectId, url: page.url() }, null, 2));
    console.log(`PROJECT ${projectId}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    mark("studio");
    await debug("studio");
    // Answer the tap questions until the summary card offers "Looks right — next".
    const confirm = page.getByTestId("studio-idea-confirm");
    for (let i = 0; i < 6; i++) {
      const choice = page.getByTestId("studio-choices").getByRole("button").first();
      const which = await Promise.race([
        confirm.waitFor({ state: "visible", timeout: 90000 }).then(() => "confirm"),
        choice.waitFor({ state: "visible", timeout: 90000 }).then(() => "choice"),
      ]).catch(() => "none");
      if (which !== "choice") break;
      await wait(1800);
      mark(`answer-${i}`);
      await click(choice);
      await wait(800);
    }
    await confirm.waitFor({ state: "visible", timeout: 120000 });
    await wait(1500);
    mark("summary");
    await debug("summary");
    await shot("summary");
    await wait(3000);
    await click(confirm);
    mark("parts-start");
    await page.getByTestId("studio-part-row").first().waitFor({ state: "visible", timeout: 180000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    await wait(2500);
    mark("parts");
    await debug("parts");
    await shot("parts");
    const rows = page.getByTestId("studio-part-row");
    const n = Math.min(await rows.count(), 4);
    for (let i = 0; i < n; i++) { await moveTo(rows.nth(i)).catch(() => {}); await wait(1100); }
    mark("rows");
    await moveTo(page.getByText("مجموع القطع").first()).catch(() => {});
    await wait(2500);
    mark("total");
    await shot("total");
    await wait(2500);
    mark("end");
  },

  // Arabic YouTube take 2: wiring views + 3D product design. Wiring and the 3D
  // model need a signed-in account with credits, so this runs against the
  // LOCAL Studio fixture (same Studio screens, plant-waterer demo project, mock
  // API, nothing written): start `E2E_FIXTURES=1 npx next start -p 3100`, then
  //   node record.mjs studio-3d-ar <outRoot> --base http://localhost:3100
  async "studio-3d-ar"() {
    await goto("/ar/e2e-fixtures/studio?product=1&idea=plant_waterer&step=wiring");
    await declineCookies();
    const tabs = page.getByTestId("studio-wiring-tabs");
    const draw = page.getByRole("button", { name: /ارسم|رصيد/ }).first();
    await tabs.or(draw).first().waitFor({ state: "visible", timeout: 30000 });
    await wait(1500);
    mark("wiring");
    if (!(await tabs.isVisible())) {
      await click(draw);
      await tabs.waitFor({ state: "visible", timeout: 30000 });
    }
    await page.waitForTimeout(2500);
    mark("wiring-drawn");
    await debug("wiring");
    await scrollToEl(tabs, 150);
    await wait(2500);
    await smoothScroll(380);
    await wait(3500);
    await scrollToEl(tabs, 200);
    await wait(600);
    mark("wiring-pic");
    await click(page.getByTestId("studio-wiring-tab-3d"));
    await page.getByTestId("studio-wiring-panel-3d").waitFor({ state: "visible", timeout: 20000 });
    await wait(4500);
    mark("breadboard");
    await debug("breadboard");
    await shot("breadboard");
    // A slow orbit of the breadboard: drag across the 3D view.
    const p3 = await page.getByTestId("studio-wiring-panel-3d").boundingBox();
    if (p3) {
      const cx = p3.x + p3.width / 2, cy = p3.y + p3.height / 2;
      await page.mouse.move(cx + 120, cy); mouse = { x: cx + 120, y: cy };
      await page.mouse.down();
      await page.mouse.move(cx - 160, cy + 30, { steps: 90 });
      await page.mouse.up();
      mouse = { x: cx - 160, y: cy + 30 };
    }
    await wait(3000);
    mark("orbit");
    await scrollToEl(tabs, 200);
    await wait(500);
    await click(page.getByTestId("studio-wiring-tab-pins"));
    await wait(1200);
    const pins = page.getByTestId("studio-pin-row");
    for (let i = 0; i < Math.min(await pins.count(), 3); i++) { await moveTo(pins.nth(i)).catch(() => {}); await wait(900); }
    mark("pins");
    await debug("pins");
    await click(page.getByRole("button", { name: "التالي", exact: true }).first());
    mark("enclosure");
    await page.getByTestId("studio-product-pictures").waitFor({ state: "visible", timeout: 30000 });
    await page.locator('[data-testid="studio-product-pictures"][data-phase="ready"]').waitFor({ timeout: 90000 });
    await wait(1000);
    mark("pictures");
    await scrollToEl(page.getByTestId("studio-product-pictures"), 140);
    await wait(1500);
    const cards = page.getByTestId("studio-product-card");
    for (let i = 0; i < Math.min(await cards.count(), 3); i++) { await moveTo(cards.nth(i)).catch(() => {}); await wait(1300); }
    await debug("pictures");
    await shot("pictures");
    mark("cards");
    await click(cards.first());
    await wait(1200);
    await click(page.getByTestId("studio-create-cad"));
    mark("cad");
    const viewer = page.getByTestId("studio-product-viewer");
    await viewer.waitFor({ state: "visible", timeout: 90000 });
    await wait(4000);
    await scrollToEl(viewer, 140).catch(() => {});
    await wait(2000);
    mark("viewer");
    await debug("viewer");
    await shot("viewer");
    const vb = await viewer.boundingBox();
    if (vb) {
      const cx = vb.x + vb.width / 2, cy = vb.y + vb.height / 2;
      await page.mouse.move(cx - 150, cy); mouse = { x: cx - 150, y: cy };
      await page.mouse.down();
      await page.mouse.move(cx + 170, cy - 20, { steps: 100 });
      await page.mouse.up();
      mouse = { x: cx + 170, y: cy - 20 };
    }
    await wait(2500);
    mark("orbit-3d");
    await click(page.getByTestId("studio-take-apart"));
    await wait(4500);
    mark("apart");
    await debug("apart");
    await shot("apart");
    await wait(2500);
    mark("end");
  },

  // Arabic versions of the three site clips (YouTube, 2026-10-17). Same rules
  // as the English ones: guest only, nothing submitted or ordered; store-to-door
  // adds ONE guest cart line and stops on the checkout page.
  async "file-to-part-ar"() {
    const stl = fs.readFileSync(path.join(dir, "bracket.stl"), "utf8");
    await goto("/ar/design");
    await declineCookies();
    await wait(1200);
    mark("design");
    await wait(1500);
    const zone = page.getByRole("button", { name: /أفلت ملفك/ }).first();
    await scrollToEl(zone, 200);
    await wait(600);
    await moveTo(zone);
    const dt = await page.evaluateHandle((text) => {
      const d = new DataTransfer();
      d.items.add(new File([text], "bracket.stl", { type: "model/stl" }));
      return d;
    }, stl);
    await zone.dispatchEvent("dragenter", { dataTransfer: dt });
    await zone.dispatchEvent("dragover", { dataTransfer: dt });
    await wait(1600);
    mark("dragover");
    await zone.dispatchEvent("drop", { dataTransfer: dt });
    mark("drop");
    await page.waitForURL(/\/design\/quote/, { timeout: 30000 }).catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    await wait(1800);
    mark("quote");
    await debug("quote");
    await moveTo(page.getByText("bracket.stl").first()).catch(() => {});
    await wait(2200);
    await smoothScroll(360);
    await wait(2200);
    mark("form");
    await goto("/ar/how-it-works#make");
    await wait(1500);
    mark("how");
    await debug("how");
    for (const step of ["مهندسنا يسعّر لك الطريقة", "تُصنع في استوديو لوسيل لدينا", "تصلك القطعة"]) {
      const el = page.getByText(step, { exact: true }).first();
      if (await el.count()) { await scrollToEl(el, 300).catch(() => {}); await moveTo(el).catch(() => {}); await wait(1500); }
    }
    mark("steps");
    await goto("/ar/design");
    await wait(1000);
    const ways = page.getByText("أربع طرق لتصنيع قطعتك").first();
    await scrollToEl(ways, 160).catch(() => {});
    await wait(1000);
    mark("ways");
    await debug("ways");
    for (const m of ["طباعة ثلاثية الأبعاد", "تشغيل", "القص بالليزر", "EDM"]) {
      const el = page.getByText(m).first();
      if (await el.count()) { await moveTo(el).catch(() => {}); await wait(1100); }
    }
    await wait(2000);
    mark("end");
  },

  async "sketch-to-drawing-ar"() {
    await goto("/ar/design/drawing");
    await declineCookies();
    await wait(1200);
    mark("drawing");
    await wait(2200);
    const tiers = page.getByText("فئات بسيطة وواضحة.").first();
    await scrollToEl(tiers, 190).catch(() => {});
    await wait(1000);
    mark("tiers");
    await debug("tiers");
    await shot("tiers");
    await smoothScroll(220);
    await wait(2500);
    await smoothScroll(-2400, { step: 14 });
    await wait(700);
    const cta = page.getByRole("link", { name: "ابدأ طلب رسم" }).first();
    await click(cta);
    await page.waitForURL(/for=drawing/, { timeout: 30000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    await wait(1400);
    mark("form");
    await debug("form");
    await typeInto(page.getByPlaceholder("مثال: ساعة غوص"), "حامل رف");
    await wait(600);
    mark("name");
    await typeInto(page.locator("textarea").first(), "حامل جداري على شكل L، بمقاس 80 × 60 مم، من الألمنيوم بسماكة 4 مم، مع فتحتين للبراغي.");
    await wait(1600);
    mark("described");
    await debug("described");
    await wait(2500);
    mark("end");
  },

  async "store-to-door-ar"() {
    await goto("/ar/store?q=" + encodeURIComponent("رطوبة التربة"));
    await declineCookies();
    await page.waitForLoadState("networkidle").catch(() => {});
    await wait(1500);
    mark("results");
    await debug("results");
    const product = page.locator('a[href*="/store/VLT-"]').filter({ hasText: /رطوبة|Soil/i }).first();
    await moveTo(product);
    await wait(700);
    await click(product);
    await page.waitForURL(/\/store\/VLT-/, { timeout: 30000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    await wait(1200);
    mark("product");
    await debug("product");
    await shot("product");
    await moveTo(page.getByText(/يصل بحلول/).first()).catch(() => {});
    await wait(2200);
    mark("arrives");
    await moveTo(page.getByText(/متوفر لدى|نوفّر|المصدر/).first()).catch(() => {});
    await wait(1600);
    await smoothScroll(520);
    await wait(1800);
    mark("specs");
    await smoothScroll(-520);
    await wait(600);
    const add = page.getByRole("button", { name: "أضف إلى السلة" }).first();
    await click(add);
    mark("added");
    await wait(2200);
    await goto("/ar/store/cart");
    await wait(1500);
    mark("cart");
    await debug("cart");
    await wait(1600);
    const checkout = page.getByRole("link", { name: /إتمام الطلب/ }).or(page.getByRole("button", { name: /إتمام الطلب/ }));
    await click(checkout.first());
    await page.waitForURL(/\/store\/checkout/, { timeout: 30000 }).catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    await wait(1400);
    mark("checkout");
    await debug("checkout");
    const pay = page.getByText("الدفع عند الاستلام").first();
    if (await pay.count()) { await scrollToEl(pay, 220).catch(() => {}); await wait(600); await moveTo(pay).catch(() => {}); }
    await wait(1500);
    mark("payment");
    for (const name of ["فوران", "تحويل بنكي"]) {
      const el = page.getByText(name, { exact: true }).first();
      if (await el.count()) { await moveTo(el).catch(() => {}); await wait(1300); }
    }
    await wait(2500);
    mark("end");
  },

  // English twins of the -ar recipes above (YouTube, 2026-10-19): same steps on /en.
  async "idea-to-kit-en"() {
    await goto("/en");
    await declineCookies();
    await wait(800);
    mark("home");
    await wait(1500);
    await click(page.getByRole("link", { name: "Start a project" }).first());
    await page.waitForURL(/\/projects\/new/, { timeout: 30000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    await wait(900);
    mark("new");
    await typeInto(page.getByPlaceholder(/handheld milk frother/).first(), "A device that waters a small plant automatically when the soil is dry, powered by a USB adapter, with a 3D-printed case");
    mark("typed");
    await wait(600);
    await click(page.getByRole("checkbox").first());
    await wait(700);
    mark("consent");
    await click(page.getByRole("button", { name: "Start", exact: true }));
    mark("start");
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}\/studio/, { timeout: 90000 });
    const projectId = page.url().match(/projects\/([0-9a-f-]{36})/)[1];
    fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify({ projectId, url: page.url() }, null, 2));
    console.log(`PROJECT ${projectId}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    mark("studio");
    await debug("studio");
    // Answer the tap questions until the summary card offers "Looks right — next".
    const confirm = page.getByTestId("studio-idea-confirm");
    for (let i = 0; i < 6; i++) {
      const choice = page.getByTestId("studio-choices").getByRole("button").first();
      const which = await Promise.race([
        confirm.waitFor({ state: "visible", timeout: 90000 }).then(() => "confirm"),
        choice.waitFor({ state: "visible", timeout: 90000 }).then(() => "choice"),
      ]).catch(() => "none");
      if (which !== "choice") break;
      await wait(1800);
      mark(`answer-${i}`);
      await click(choice);
      await wait(800);
    }
    await confirm.waitFor({ state: "visible", timeout: 120000 });
    await wait(1500);
    mark("summary");
    await debug("summary");
    await shot("summary");
    await wait(3000);
    await click(confirm);
    mark("parts-start");
    await page.getByTestId("studio-part-row").first().waitFor({ state: "visible", timeout: 180000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    await wait(2500);
    mark("parts");
    await debug("parts");
    await shot("parts");
    const rows = page.getByTestId("studio-part-row");
    const n = Math.min(await rows.count(), 4);
    for (let i = 0; i < n; i++) { await moveTo(rows.nth(i)).catch(() => {}); await wait(1100); }
    mark("rows");
    await moveTo(page.getByText("Parts total").first()).catch(() => {});
    await wait(2500);
    mark("total");
    await shot("total");
    await wait(2500);
    mark("end");
  },

  async "studio-3d-en"() {
    await goto("/en/e2e-fixtures/studio?product=1&idea=plant_waterer&step=wiring");
    await declineCookies();
    const tabs = page.getByTestId("studio-wiring-tabs");
    const draw = page.getByRole("button", { name: /Draw my wiring/ }).first();
    await tabs.or(draw).first().waitFor({ state: "visible", timeout: 30000 });
    await wait(1500);
    mark("wiring");
    if (!(await tabs.isVisible())) {
      await click(draw);
      await tabs.waitFor({ state: "visible", timeout: 30000 });
    }
    await page.waitForTimeout(2500);
    mark("wiring-drawn");
    await debug("wiring");
    await scrollToEl(tabs, 150);
    await wait(2500);
    await smoothScroll(380);
    await wait(3500);
    await scrollToEl(tabs, 200);
    await wait(600);
    mark("wiring-pic");
    await click(page.getByTestId("studio-wiring-tab-3d"));
    await page.getByTestId("studio-wiring-panel-3d").waitFor({ state: "visible", timeout: 20000 });
    await wait(4500);
    mark("breadboard");
    await debug("breadboard");
    await shot("breadboard");
    // A slow orbit of the breadboard: drag across the 3D view.
    const p3 = await page.getByTestId("studio-wiring-panel-3d").boundingBox();
    if (p3) {
      const cx = p3.x + p3.width / 2, cy = p3.y + p3.height / 2;
      await page.mouse.move(cx + 120, cy); mouse = { x: cx + 120, y: cy };
      await page.mouse.down();
      await page.mouse.move(cx - 160, cy + 30, { steps: 90 });
      await page.mouse.up();
      mouse = { x: cx - 160, y: cy + 30 };
    }
    await wait(3000);
    mark("orbit");
    await scrollToEl(tabs, 200);
    await wait(500);
    await click(page.getByTestId("studio-wiring-tab-pins"));
    await wait(1200);
    const pins = page.getByTestId("studio-pin-row");
    for (let i = 0; i < Math.min(await pins.count(), 3); i++) { await moveTo(pins.nth(i)).catch(() => {}); await wait(900); }
    mark("pins");
    await debug("pins");
    await click(page.getByRole("button", { name: "Next", exact: true }).first());
    mark("enclosure");
    await page.getByTestId("studio-product-pictures").waitFor({ state: "visible", timeout: 30000 });
    await page.locator('[data-testid="studio-product-pictures"][data-phase="ready"]').waitFor({ timeout: 90000 });
    await wait(1000);
    mark("pictures");
    await scrollToEl(page.getByTestId("studio-product-pictures"), 140);
    await wait(1500);
    const cards = page.getByTestId("studio-product-card");
    for (let i = 0; i < Math.min(await cards.count(), 3); i++) { await moveTo(cards.nth(i)).catch(() => {}); await wait(1300); }
    await debug("pictures");
    await shot("pictures");
    mark("cards");
    await click(cards.first());
    await wait(1200);
    await click(page.getByTestId("studio-create-cad"));
    mark("cad");
    const viewer = page.getByTestId("studio-product-viewer");
    await viewer.waitFor({ state: "visible", timeout: 90000 });
    await wait(4000);
    await scrollToEl(viewer, 140).catch(() => {});
    await wait(2000);
    mark("viewer");
    await debug("viewer");
    await shot("viewer");
    const vb = await viewer.boundingBox();
    if (vb) {
      const cx = vb.x + vb.width / 2, cy = vb.y + vb.height / 2;
      await page.mouse.move(cx - 150, cy); mouse = { x: cx - 150, y: cy };
      await page.mouse.down();
      await page.mouse.move(cx + 170, cy - 20, { steps: 100 });
      await page.mouse.up();
      mouse = { x: cx + 170, y: cy - 20 };
    }
    await wait(2500);
    mark("orbit-3d");
    await click(page.getByTestId("studio-take-apart"));
    await wait(4500);
    mark("apart");
    await debug("apart");
    await shot("apart");
    await wait(2500);
    mark("end");
  },

  async "file-to-part-en"() {
    const stl = fs.readFileSync(path.join(dir, "bracket.stl"), "utf8");
    await goto("/en/design");
    await declineCookies();
    await wait(1200);
    mark("design");
    await wait(1500);
    const zone = page.getByRole("button", { name: /Drop your 3D or drawing file/ }).first();
    await scrollToEl(zone, 200);
    await wait(600);
    await moveTo(zone);
    const dt = await page.evaluateHandle((text) => {
      const d = new DataTransfer();
      d.items.add(new File([text], "bracket.stl", { type: "model/stl" }));
      return d;
    }, stl);
    await zone.dispatchEvent("dragenter", { dataTransfer: dt });
    await zone.dispatchEvent("dragover", { dataTransfer: dt });
    await wait(1600);
    mark("dragover");
    await zone.dispatchEvent("drop", { dataTransfer: dt });
    mark("drop");
    await page.waitForURL(/\/design\/quote/, { timeout: 30000 }).catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    await wait(1800);
    mark("quote");
    await debug("quote");
    await moveTo(page.getByText("bracket.stl").first()).catch(() => {});
    await wait(2200);
    await smoothScroll(360);
    await wait(2200);
    mark("form");
    await goto("/en/how-it-works#make");
    await wait(1500);
    mark("how");
    await debug("how");
    for (const step of ["Our engineer quotes the method", "Made in our Lusail studio", "Delivered"]) {
      const el = page.getByText(step, { exact: true }).first();
      if (await el.count()) { await scrollToEl(el, 300).catch(() => {}); await moveTo(el).catch(() => {}); await wait(1500); }
    }
    mark("steps");
    await goto("/en/design");
    await wait(1000);
    const ways = page.getByText("Four ways to make your part").first();
    await scrollToEl(ways, 160).catch(() => {});
    await wait(1000);
    mark("ways");
    await debug("ways");
    for (const m of ["3D printing", "CNC machining", "Laser cutting", "EDM"]) {
      const el = page.getByText(m).first();
      if (await el.count()) { await moveTo(el).catch(() => {}); await wait(1100); }
    }
    await wait(2000);
    mark("end");
  },

  async "sketch-to-drawing-en"() {
    await goto("/en/design/drawing");
    await declineCookies();
    await wait(1200);
    mark("drawing");
    await wait(2200);
    const tiers = page.getByText("Simple, flat tiers.").first();
    await scrollToEl(tiers, 190).catch(() => {});
    await wait(1000);
    mark("tiers");
    await debug("tiers");
    await shot("tiers");
    await smoothScroll(220);
    await wait(2500);
    await smoothScroll(-2400, { step: 14 });
    await wait(700);
    const cta = page.getByRole("link", { name: "Start a drawing request" }).first();
    await click(cta);
    await page.waitForURL(/for=drawing/, { timeout: 30000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    await wait(1400);
    mark("form");
    await debug("form");
    await typeInto(page.getByPlaceholder("e.g. Dive watch"), "Shelf bracket");
    await wait(600);
    mark("name");
    await typeInto(page.locator("textarea").first(), "L-shaped wall bracket, 80 x 60 mm, 4 mm thick aluminium, two 5 mm screw holes.");
    await wait(1600);
    mark("described");
    await debug("described");
    await wait(2500);
    mark("end");
  },

  async "store-to-door-en"() {
    await goto("/en/store?q=" + encodeURIComponent("soil moisture"));
    await declineCookies();
    await page.waitForLoadState("networkidle").catch(() => {});
    await wait(1500);
    mark("results");
    await debug("results");
    const product = page.locator('a[href*="/store/VLT-"]').filter({ hasText: /Soil/i }).first();
    await moveTo(product);
    await wait(700);
    await click(product);
    await page.waitForURL(/\/store\/VLT-/, { timeout: 30000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    await wait(1200);
    mark("product");
    await debug("product");
    await shot("product");
    await moveTo(page.getByText(/Arrives by/).first()).catch(() => {});
    await wait(2200);
    mark("arrives");
    await moveTo(page.getByText(/Stocked by|Sourced/).first()).catch(() => {});
    await wait(1600);
    await smoothScroll(520);
    await wait(1800);
    mark("specs");
    await smoothScroll(-520);
    await wait(600);
    const add = page.getByRole("button", { name: "Add to Cart" }).first();
    await click(add);
    mark("added");
    await wait(2200);
    await goto("/en/store/cart");
    await wait(1500);
    mark("cart");
    await debug("cart");
    await wait(1600);
    const checkout = page.getByRole("link", { name: /checkout/i }).or(page.getByRole("button", { name: /checkout/i }));
    await click(checkout.first());
    await page.waitForURL(/\/store\/checkout/, { timeout: 30000 }).catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    await wait(1400);
    mark("checkout");
    await debug("checkout");
    const pay = page.getByText("Cash on delivery").first();
    if (await pay.count()) { await scrollToEl(pay, 220).catch(() => {}); await wait(600); await moveTo(pay).catch(() => {}); }
    await wait(1500);
    mark("payment");
    for (const name of ["Fawran", "Bank transfer"]) {
      const el = page.getByText(name, { exact: true }).first();
      if (await el.count()) { await moveTo(el).catch(() => {}); await wait(1300); }
    }
    await wait(2500);
    mark("end");
  },

  // Second take of idea-to-kit, in the SAME guest session and project
  // (--state <outRoot>/idea-to-kit/state.json): the electronics steps a guest
  // can take without a credit (board, power, component list — the circuit is
  // skipped for guests) and the priced bill of materials.
  async "idea-to-kit-2"() {
    if (!STATE) throw new Error("idea-to-kit-2 needs --state (the idea-to-kit guest session)");
    const { projectId } = JSON.parse(fs.readFileSync(path.resolve(outRoot, "idea-to-kit", "project.json"), "utf8"));
    await goto(`/en/projects/${projectId}/prototyping`);
    await declineCookies();
    await wait(1500);
    mark("workspace");
    await click(page.getByRole("button", { name: /^Electronics,/ }).first());
    await wait(1800);
    mark("board");
    await click(page.getByRole("radio", { name: /^Prototype/ }).first());
    await wait(1500);
    await click(page.getByRole("button", { name: /Continue to Power/ }).first());
    await wait(1800);
    mark("power");
    await debug("power");
    await click(page.getByRole("radio", { name: /Plug-in adapter/ }).first());
    await wait(1500);
    await click(page.getByRole("button", { name: /Continue to Components/ }).first());
    await wait(1800);
    mark("components");
    await debug("components");
    await click(page.getByRole("button", { name: "Generate component list" }).first());
    mark("generate");
    await page.getByText("Generate component list").first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
    await page.getByRole("button", { name: /Rebuild|Generate component list/ }).first().waitFor({ state: "visible", timeout: 300000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    await wait(2000);
    mark("generated");
    await debug("generated");
    await click(page.getByRole("button", { name: /^Bill of materials/ }).first());
    await wait(1200);
    const notNow = page.getByRole("button", { name: "Not now", exact: true });
    if (await notNow.count()) { await click(notNow.first()); await wait(800); }
    // Prices and dates come from /api/bom/match: wait for the skeleton to go.
    await page.getByText(/^QAR /).first().waitFor({ state: "visible", timeout: 60000 }).catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    await wait(2500);
    mark("bom");
    await debug("bom");
    await shot("bom");
    const table = page.getByText("Function", { exact: true }).first();
    if (await table.count()) await scrollToEl(table, 170);
    else await smoothScroll(420);
    await wait(2500);
    mark("bom-list");
    await shot("bom-list");
    await smoothScroll(360);
    await wait(3000);
    mark("bom-list2");
    await shot("bom-list2");
    await wait(2500);
    mark("end");
  },

  // Third take of idea-to-kit (same session, --state): the finished, priced
  // bill of materials once the live store matches have loaded.
  async "idea-to-kit-3"() {
    if (!STATE) throw new Error("idea-to-kit-3 needs --state (the idea-to-kit guest session)");
    const { projectId } = JSON.parse(fs.readFileSync(path.resolve(outRoot, "idea-to-kit", "project.json"), "utf8"));
    await goto(`/en/projects/${projectId}/prototyping`);
    await declineCookies();
    await click(page.getByRole("button", { name: /^Bill of materials/ }).first());
    await wait(800);
    const notNow = page.getByRole("button", { name: "Not now", exact: true });
    if (await notNow.count()) { await click(notNow.first()); await wait(600); }
    await page.waitForFunction(() => !document.querySelector("main .animate-pulse"), null, { timeout: 90000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    await wait(1500);
    mark("bom");
    await shot("bom");
    await moveTo(page.getByText("TO BUY NOW", { exact: false }).first()).catch(() => {});
    await wait(2500);
    mark("summary");
    const sensors = page.getByRole("button", { name: /^Sensors and actuators/ }).first();
    await scrollToEl(sensors, 150);
    await wait(800);
    mark("sensors");
    await moveTo(page.getByText("Capacitive Analog Soil Moisture Sensor", { exact: false }).first());
    await wait(1800);
    await shot("sensors");
    await moveTo(page.getByText("Mini Submersible Water Pump", { exact: false }).first());
    await wait(2200);
    mark("pump");
    await smoothScroll(330);
    await wait(2500);
    mark("consumables");
    await shot("consumables");
    await wait(2000);
    mark("end");
  },

  async "store-to-door"() {
    await goto("/en");
    await declineCookies();
    await wait(800);
    mark("home");
    await wait(1200);
    const q = page.locator('input[name="q"]').first();
    await scrollToEl(q, 260);
    await wait(500);
    await typeInto(q, "soil moisture");
    await wait(400);
    await page.keyboard.press("Enter");
    mark("search");
    await page.waitForURL(/q=soil/, { timeout: 30000 }).catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    await wait(1800);
    mark("results");
    await debug("results");
    const product = page.getByRole("link", { name: /Capacitive Analog Soil Moisture Sensor/ }).first();
    await moveTo(product);
    await wait(500);
    await click(product);
    await page.waitForURL(/\/store\/VLT-/, { timeout: 30000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    await wait(1000);
    mark("product");
    await shot("product");
    await moveTo(page.getByText(/Arrives by/).first());
    await wait(2200);
    mark("arrives");
    await moveTo(page.getByText(/Stocked by|Sourced|Source/).first()).catch(() => {});
    await wait(1600);
    mark("source");
    await smoothScroll(520);
    await wait(1800);
    mark("specs");
    await smoothScroll(-520);
    await wait(600);
    const add = page.getByRole("button", { name: "Add to Cart" }).first();
    // ONE guest cart line only: a retake reuses the saved session (--state)
    // and its cart, so it only points at the button.
    if (STATE) await moveTo(add);
    else await click(add);
    mark("added");
    if (!STATE) await context.storageState({ path: path.join(dir, "state.json") });
    await wait(2200);
    await debug("added");
    await goto("/en/store/cart");
    await wait(1200);
    mark("cart");
    await debug("cart");
    await wait(1800);
    const checkout = page.getByRole("link", { name: /checkout/i }).or(page.getByRole("button", { name: /checkout/i }));
    await click(checkout.first());
    await page.waitForURL(/\/store\/checkout/, { timeout: 30000 }).catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    await wait(1200);
    mark("checkout");
    await debug("checkout");
    const pay = page.getByText(/Cash on delivery/i).first();
    if (await pay.count()) {
      await scrollToEl(pay, 220);
      await wait(600);
      await moveTo(pay);
    }
    await wait(1500);
    mark("payment");
    await debug("payment");
    await shot("payment");
    for (const name of [/Fawran/i, /Bank transfer/i]) {
      const el = page.getByText(name).first();
      if (await el.count()) { await moveTo(el); await wait(1200); }
    }
    await wait(2500);
    mark("end");
  },

  async "file-to-part"() {
    const stl = fs.readFileSync(path.join(dir, "bracket.stl"), "utf8");
    await goto("/en/design");
    await declineCookies();
    await wait(800);
    mark("design");
    await wait(1200);
    const zone = page.getByRole("button", { name: /Drop your 3D or drawing file/ }).first();
    await scrollToEl(zone, 160);
    await wait(400);
    await moveTo(zone);
    // A real drag: dragover (highlight) then drop, with the sample STL.
    const dt = await page.evaluateHandle((text) => {
      const d = new DataTransfer();
      d.items.add(new File([text], "bracket.stl", { type: "model/stl" }));
      return d;
    }, stl);
    await zone.dispatchEvent("dragenter", { dataTransfer: dt });
    await zone.dispatchEvent("dragover", { dataTransfer: dt });
    await wait(1400);
    mark("dragover");
    await shot("dropzone");
    await zone.dispatchEvent("drop", { dataTransfer: dt });
    mark("drop");
    await page.waitForURL(/\/design\/quote/, { timeout: 30000 }).catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    await wait(1500);
    mark("quote");
    await debug("quote");
    await shot("quote");
    await moveTo(page.getByText("bracket.stl").first()).catch(() => {});
    await wait(2200);
    await smoothScroll(380);
    await wait(1800);
    mark("form");
    await smoothScroll(380);
    await wait(1800);
    mark("form2");
    await goto("/en/how-it-works#make");
    await wait(1500);
    mark("how");
    await debug("how");
    await smoothScroll(420);
    await wait(1200);
    mark("how2");
    await debug("how2");
    for (const step of ["Our engineer quotes the method", "Made in our Lusail studio", "Delivered"]) {
      const el = page.getByText(step, { exact: true }).first();
      if (await el.count()) { await moveTo(el); await wait(1300); }
    }
    mark("steps");
    await goto("/en/design");
    await wait(800);
    const ways = page.getByText("Four ways to make your part").first();
    await scrollToEl(ways, 160);
    await wait(800);
    mark("ways");
    await debug("ways");
    for (const m of ["3D printing", "CNC machining", "Laser cutting", "EDM (spark erosion)"]) {
      const el = page.getByText(m, { exact: true }).first();
      if (await el.count()) { await moveTo(el); await wait(1000); }
    }
    await wait(2000);
    mark("end");
  },

  async "sketch-to-drawing"() {
    await goto("/en/design/drawing");
    await declineCookies();
    await wait(800);
    mark("drawing");
    await wait(2000);
    const tiers = page.getByText("Simple, flat tiers.").first();
    await scrollToEl(tiers, 190);
    await wait(800);
    mark("tiers");
    await shot("tiers");
    for (const p of ["200 QAR", "450 QAR", "From 800 QAR"]) {
      const el = page.getByText(p, { exact: true }).first();
      if (await el.count()) { await moveTo(el); await wait(1100); }
    }
    await wait(800);
    await smoothScroll(-2000, { step: 14 });
    await wait(600);
    const cta = page.getByRole("link", { name: "Start a drawing request" }).first();
    await click(cta);
    await page.waitForURL(/for=drawing/, { timeout: 30000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    await wait(1200);
    mark("form");
    await debug("form");
    await typeInto(page.getByPlaceholder("e.g. Dive watch"), "Shelf bracket");
    await wait(500);
    mark("name");
    const desc = page.locator("textarea").first();
    await typeInto(desc, "L-shaped wall bracket, 80 x 60 mm, 4 mm thick aluminium, two 5 mm screw holes. I can send a photo of the old one.");
    await wait(1500);
    mark("described");
    await debug("described");
    await wait(2500);
    mark("end");
  },
};

const run = CLIPS[slug];
if (!run) {
  console.error(`No recipe for "${slug}". Known: ${Object.keys(CLIPS).join(", ")}`);
  process.exit(1);
}
try {
  await run();
} catch (e) {
  mark(`error: ${e instanceof Error ? e.message : e}`);
  await debug("error");
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(dir, "marks.json"), JSON.stringify(marks, null, 2));
  const video = page.video();
  await context.close();
  if (video) {
    const p = await video.path();
    fs.renameSync(p, path.join(dir, "raw.webm"));
  }
  await browser.close();
}
