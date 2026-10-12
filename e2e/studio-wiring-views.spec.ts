import { inflateRawSync } from "node:zlib";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Locator, Page } from "@playwright/test";

import { expect, expectLocale, expectNoHorizontalOverflow, LOCALES, msg, test, type Loc } from "./fixtures";

// P5-17 acceptance — the Wiring step in four views + the link to the code, on the
// TEST-ONLY studio fixture (/{locale}/e2e-fixtures/studio?product=1&idea=<key>&step=wiring;
// mocked StudioApi, no Supabase write, no AI). Pin list selection → highlighted in
// Wiring / Schematic / 3D, "Show in code" → LED_PIN line, code hover → wire preview,
// tab remembered, no horizontal overflow, reduced motion, Wokwi zip.
// Screenshots (P517_SHOTS=1, desktop project) go to "Claude outputs/p517/".

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "Claude outputs", "p517");

async function open(page: Page, locale: Loc, idea: string, step = "wiring") {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("gestaltung:cookie-consent", `declined.${Date.now()}`);
    } catch {
      /* storage blocked */
    }
  });
  const res = await page.goto(`/${locale}/e2e-fixtures/studio?product=1&idea=${idea}&step=${step}`);
  expect(res?.status(), "start the server with E2E_FIXTURES=1").toBe(200);
  await expectLocale(page, locale);
  await expect(page.getByTestId("studio-shell")).toHaveAttribute("data-step", step);
}

/** Main button "Draw my wiring" (credit or free label), when the step has not drawn yet. */
async function draw(page: Page, locale: Loc) {
  const credit = page.getByRole("button", { name: msg(locale, "Studio", "wiringDrawCredit") });
  const free = page.getByRole("button", { name: msg(locale, "Studio", "wiringDrawFree") });
  const tabs = page.getByTestId("studio-wiring-tabs");
  await expect(credit.or(free).or(tabs).first()).toBeVisible({ timeout: 20_000 });
  if (!(await tabs.isVisible())) {
    await ((await credit.isVisible()) ? credit : free).click();
  }
  await expect(tabs).toBeVisible({ timeout: 20_000 });
}

async function openTab(page: Page, id: "wiring" | "3d" | "schematic" | "pins") {
  await page.getByTestId(`studio-wiring-tab-${id}`).click();
  await expect(page.getByTestId(`studio-wiring-panel-${id}`)).toBeVisible();
}

/** The doorbell's LED row in the Pin list (board pin GPIO4 → Indicator light +). */
async function ledRow(page: Page): Promise<{ row: Locator; id: string }> {
  await openTab(page, "pins");
  await expect(page.getByTestId("studio-pin-row").first()).toBeVisible();
  const row = page.locator('[data-testid="studio-pin-row"][data-board-pin="GPIO4"]');
  await expect(row).toHaveCount(1);
  const id = (await row.getAttribute("data-connection"))!;
  expect(id).toMatch(/^c\d+$/);
  return { row, id };
}

/** Opens an idea on the Wiring step and goes to the Code step through "Show in code" (the fixture starts a ?step=code URL on Enclosure). */
async function goToCode(page: Page, locale: Loc, idea: string) {
  await open(page, locale, idea);
  await draw(page, locale);
  await openTab(page, "pins");
  await page.getByTestId("studio-pin-row").first().click();
  await openTab(page, "wiring"); // the selected-wire bar (with "Show in code") sits under the picture tabs
  await page.getByTestId("studio-show-in-code").click();
  await expect(page.getByTestId("studio-shell")).toHaveAttribute("data-step", "code");
}

function viewsMsg(locale: Loc, group: string, key: string): string {
  const all = JSON.parse(readFileSync(path.join(ROOT, "messages", `${locale}.json`), "utf8")) as {
    Studio: { views: Record<string, Record<string, string>> };
  };
  return all.Studio.views[group][key];
}

/** Minimal zip reader (STORE or DEFLATE) over the central directory. */
function readZip(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  expect(eocd, "zip end record").toBeGreaterThanOrEqual(0);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    expect(buf.readUInt32LE(local)).toBe(0x04034b50);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    out[name] = (method === 8 ? inflateRawSync(raw) : raw).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

for (const locale of LOCALES) {
  test(`wiring views: pin list selection reaches Wiring, Schematic, 3D; Show in code lands on LED_PIN; hover previews the wire [${locale}]`, async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, locale, "doorbell");
    await draw(page, locale);
    const { row, id } = await ledRow(page);

    await row.click();
    await expect(row).toHaveAttribute("aria-current", "true");

    // Wiring tab: the wire carries is-active.
    await openTab(page, "wiring");
    const mains = page.locator(`svg .wire-main[data-conn="${id}"]`);
    await expect(mains.first()).toBeVisible();
    await expect.poll(() => mains.evaluateAll((els) => els.length > 0 && els.every((e) => e.classList.contains("is-active")))).toBe(true);
    await expect(page.getByTestId("studio-selected-wire")).toHaveAttribute("data-connection", id);

    // Schematic tab: the net of that wire is highlighted.
    await openTab(page, "schematic");
    await expect(page.locator(`[data-wv-content] [data-conn="${id}"].is-active`).first()).toBeAttached();
    await expect(page.getByTestId("studio-selected-wire")).toHaveAttribute("data-connection", id);

    // 3D tab: the canvas cannot be inspected, the selection line proves the same wire is selected.
    await openTab(page, "3d");
    await expect(page.getByTestId("studio-selected-wire")).toHaveAttribute("data-connection", id);

    // Show in code → Code step, LED_PIN line in view and highlighted.
    await page.getByTestId("studio-show-in-code").click();
    await expect(page.getByTestId("studio-shell")).toHaveAttribute("data-step", "code");
    // The declaration and every line that uses LED_PIN are linked to the same wire.
    const lines = page.locator('[data-testid="studio-code-line"][data-pin-const="LED_PIN"]');
    const line = lines.first();
    await expect(line).toBeVisible({ timeout: 20_000 });
    await expect(line).toHaveAttribute("data-connection", id);
    await expect(line).toHaveAttribute("data-highlight", "true");
    await expect(line).toBeInViewport();
    await expect(line).toContainText("const int LED_PIN = 4;");

    // Hover (a click if hover does not open it) a pin line → the wire preview with the same connection.
    // Retried: the preview closes when the code string changes (pin sync) right after arriving.
    const preview = page.getByTestId("studio-wire-preview");
    await expect(async () => {
      await page.mouse.move(2, 2);
      await line.hover();
      const bb = (await line.boundingBox())!;
      await page.mouse.move(bb.x + 40, bb.y + 6, { steps: 3 });
      if (!(await preview.isVisible().catch(() => false))) await line.click();
      await expect(preview).toBeVisible({ timeout: 2000 });
      await expect(preview).toHaveAttribute("data-connection", id);
      await expect(page.getByTestId("studio-wire-snippet")).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 30_000 });

    // "Show in wiring" goes back with the wire selected.
    await page.getByTestId("studio-show-in-wiring").click();
    await expect(page.getByTestId("studio-shell")).toHaveAttribute("data-step", "wiring");
    await expect(page.getByTestId("studio-selected-wire")).toHaveAttribute("data-connection", id);
  });

  test(`wiring views: tab choice is remembered after reload [${locale}]`, async ({ page }) => {
    await open(page, locale, "doorbell");
    await draw(page, locale);
    await expect(page.getByTestId("studio-wiring-tab-wiring")).toHaveAttribute("aria-selected", "true");
    await openTab(page, "pins");
    await page.reload();
    await expectLocale(page, locale);
    await draw(page, locale);
    await expect(page.getByTestId("studio-wiring-tab-pins")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("studio-pin-list")).toBeVisible();
  });

  test(`wiring views: no horizontal overflow in any tab [${locale}]`, async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, locale, "plant_waterer");
    await draw(page, locale);
    for (const id of ["wiring", "3d", "schematic", "pins"] as const) {
      await openTab(page, id);
      await page.waitForTimeout(400);
      await expectNoHorizontalOverflow(page);
    }
    await openTab(page, "wiring");
    await page.getByTestId("studio-guide-start").click();
    await expect(page.getByTestId("studio-guide")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test(`wiring views: 1366 px, no horizontal overflow [${locale}]`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "desktop project only");
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 900 });
    await open(page, locale, "plant_waterer");
    await draw(page, locale);
    for (const id of ["wiring", "3d", "schematic", "pins"] as const) {
      await openTab(page, id);
      await page.waitForTimeout(300);
      await expectNoHorizontalOverflow(page);
    }
  });

  test(`wiring views: reduced motion, the current wire does not animate [${locale}]`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, locale, "plant_waterer");
    await draw(page, locale);
    await openTab(page, "wiring");
    await page.getByTestId("studio-guide-start").click();
    await expect(page.getByTestId("studio-guide")).toBeVisible();
    await page.getByTestId("studio-guide-next").click();
    const active = page.locator("svg .wire-main.is-active").first();
    await expect(active).toBeAttached();
    const state = await active.evaluate((el) => ({
      anims: el.getAnimations().length,
      name: getComputedStyle(el).animationName,
      dash: getComputedStyle(el).strokeDasharray,
    }));
    expect(state.anims).toBe(0);
    expect(state.name).toBe("none");
    expect(state.dash).toBe("none");
  });

  test(`wiring views: Wokwi zip matches the wiring; hidden when a part is unsupported [${locale}]`, async ({ page }) => {
    test.setTimeout(120_000);
    await goToCode(page, locale, "cat_feeder");
    const wokwi = page.getByTestId("studio-wokwi");
    await expect(wokwi).toBeVisible({ timeout: 20_000 });
    await expect(wokwi).toContainText(viewsMsg(locale, "wokwi", "download"));
    const [download] = await Promise.all([page.waitForEvent("download"), wokwi.click()]);
    expect(download.suggestedFilename()).toMatch(/-wokwi\.zip$/);
    const files = readZip(readFileSync((await download.path())!));
    expect(Object.keys(files).sort()).toEqual(["diagram.json", "sketch.ino"]);

    const diagram = JSON.parse(files["diagram.json"]) as { version: number; parts: { type: string; id: string }[]; connections: unknown[] };
    expect(diagram.version).toBe(1);
    expect(Array.isArray(diagram.parts)).toBe(true);
    expect(diagram.parts.length).toBeGreaterThan(1);
    expect(Array.isArray(diagram.connections)).toBe(true);
    expect(diagram.connections.length).toBeGreaterThan(2);
    const ids = new Set(diagram.parts.map((p) => p.id));
    for (const c of diagram.connections) {
      expect(Array.isArray(c) && c.length === 4, JSON.stringify(c)).toBe(true);
      const [a, b, colour, route] = c as [string, string, string, unknown[]];
      expect(typeof a).toBe("string");
      expect(typeof b).toBe("string");
      expect(typeof colour).toBe("string");
      expect(Array.isArray(route)).toBe(true);
      expect(ids.has(a.split(":")[0]), a).toBe(true);
      expect(ids.has(b.split(":")[0]), b).toBe(true);
    }
    const sketch = files["sketch.ino"];
    expect(sketch).toContain("// >>> PINS (from your wiring) >>>");
    expect(sketch).toContain("// <<< PINS <<<");
    expect(sketch).toMatch(/const int SG90_PIN = 25;/);
    expect(sketch).toMatch(/const int BUTTON_PIN = 26;/);

    // Plant Waterer: the pump / driver / C3 board have no verified Wokwi match, so no button.
    await goToCode(page, locale, "plant_waterer");
    await expect(page.getByTestId("studio-code-line").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("studio-wokwi")).toHaveCount(0);
  });
}

// Control for the reduced-motion test: with motion allowed the current wire does animate in.
test("wiring views: control, without reduced motion the current wire draws in", async ({ page }) => {
  await open(page, "en", "plant_waterer");
  await draw(page, "en");
  await openTab(page, "wiring");
  await page.getByTestId("studio-guide-start").click();
  await page.getByTestId("studio-guide-next").click();
  const active = page.locator("svg .wire-main.is-active").first();
  await expect(active).toBeAttached();
  await expect
    .poll(() => active.evaluate((el) => ({ n: el.getAnimations().length, name: getComputedStyle(el).animationName })), { timeout: 3000 })
    .toMatchObject({ n: 1, name: "wv-draw" });
});

// ── Screenshots (P517_SHOTS=1, desktop project only) → Claude outputs/p517/ ──

async function shot(page: Page, file: string) {
  mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await page.getByTestId("studio-shell").screenshot({ path: path.join(SHOTS, file), animations: "disabled", timeout: 10_000 }).catch(async () => {
    await page.screenshot({ path: path.join(SHOTS, file), fullPage: true });
  });
}

test("screenshots: Plant Waterer, 1366, EN", async ({ page }, info) => {
  test.skip(!process.env.P517_SHOTS || info.project.name !== "desktop", "set P517_SHOTS=1 (desktop project)");
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  await open(page, "en", "plant_waterer");
  await draw(page, "en");
  await openTab(page, "wiring");
  await page.waitForTimeout(600);
  await shot(page, "01-wiring.png");

  await openTab(page, "pins");
  await page.getByTestId("studio-pin-row").nth(7).click(); // c8: a signal wire
  await shot(page, "04-pin-list.png");

  await openTab(page, "3d");
  await page.waitForTimeout(3000);
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, "02-3d-selected.png"), fullPage: true });

  await openTab(page, "schematic");
  await page.waitForTimeout(600);
  await shot(page, "03-schematic.png");

  await page.getByTestId("studio-show-in-code").click();
  await expect(page.getByTestId("studio-shell")).toHaveAttribute("data-step", "code");
  const line = page.locator('[data-testid="studio-code-line"][data-pin-const]').first();
  await expect(line).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(500);
  await page.mouse.move(2, 2);
  await line.hover();
  const bb = (await line.boundingBox())!;
  await page.mouse.move(bb.x + 60, bb.y + 6, { steps: 4 });
  const preview = page.getByTestId("studio-wire-preview");
  if (!(await preview.isVisible().catch(() => false))) await line.click();
  await expect(preview).toBeVisible();
  await expect(page.getByTestId("studio-wire-snippet")).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, "05-code-wire-preview.png") });
});

// ── 3D: drag a part (P5-17d) ──

type PartOnScreen = { id: string; board: boolean; size: number; x: number; y: number };
const partsOnScreen = (page: Page) =>
  page.evaluate(() => (window as unknown as { __wiring3dParts?: () => PartOnScreen[] }).__wiring3dParts?.() ?? []);

/** Opens the 3D tab and waits for the scene (test hook) to report its parts. */
async function open3d(page: Page): Promise<PartOnScreen[]> {
  await openTab(page, "3d");
  await expect.poll(async () => (await partsOnScreen(page)).length, { timeout: 20_000 }).toBeGreaterThan(1);
  await page.waitForTimeout(1500); // camera fit + first frames
  return partsOnScreen(page);
}

/** Drags the part with the mouse by (dx, dy) px; returns where it was grabbed. */
async function dragPart(page: Page, p: PartOnScreen, dx: number, dy: number) {
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + dx / 4, p.y + dy / 4, { steps: 3 });
  await page.mouse.move(p.x + dx, p.y + dy, { steps: 12 });
  await page.mouse.up();
}

test("3D: drag a part on the mat, its wires follow, Reset layout puts it back", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "mouse drag on the desktop project");
  test.setTimeout(120_000);
  await open(page, "en", "plant_waterer");
  await draw(page, "en");
  const parts = await open3d(page);
  const box = (await page.getByTestId("studio-wiring-3d").locator("canvas").boundingBox())!;
  const reset = page.getByTestId("studio-wiring-3d-reset");
  await expect(reset).toHaveCount(0);
  // The bulkiest part that is not the board, well inside the view (its centre is solid).
  const p = parts
    .filter((q) => !q.board && q.x > box.x + 60 && q.x < box.x + box.width - 60 && q.y > box.y + 60 && q.y < box.y + box.height - 60)
    .sort((a, b) => b.size - a.size)[0];
  expect(p, "a part inside the view").toBeTruthy();
  await dragPart(page, p, 90, 70);
  await expect(reset).toBeVisible();
  const after = (await partsOnScreen(page)).find((q) => q.id === p.id)!;
  expect(Math.hypot(after.x - p.x, after.y - p.y), "the part moved").toBeGreaterThan(30);
  // Kept for the session (reload restores the spot).
  await page.reload();
  await draw(page, "en");
  await open3d(page);
  await expect(reset).toBeVisible();
  await reset.click();
  await expect(reset).toHaveCount(0);
  await page.waitForTimeout(600);
  const back = (await partsOnScreen(page)).find((q) => q.id === p.id)!;
  expect(Math.hypot(back.x - p.x, back.y - p.y), "Reset layout puts it back").toBeLessThan(6);
});

test("screenshots: 3D drag, 1366 EN + 375 EN", async ({ page }, info) => {
  test.skip(!process.env.P517_SHOTS || info.project.name !== "desktop", "set P517_SHOTS=1 (desktop project)");
  test.setTimeout(180_000);
  mkdirSync(SHOTS, { recursive: true });
  const panel = () => page.getByTestId("studio-wiring-3d");
  await page.setViewportSize({ width: 1366, height: 900 });
  await open(page, "en", "plant_waterer");
  await draw(page, "en");
  let parts = await open3d(page);
  await panel().scrollIntoViewIfNeeded();
  parts = await partsOnScreen(page);
  await panel().screenshot({ path: path.join(SHOTS, "08-3d-1366-before-drag.png") });
  const box = (await panel().locator("canvas").boundingBox())!;
  const p = parts.filter((q) => !q.board && q.y > box.y + 60 && q.y < box.y + box.height - 60).sort((a, b) => b.x - a.x)[0];
  await dragPart(page, p, -60, 110);
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.waitForTimeout(500);
  await panel().screenshot({ path: path.join(SHOTS, "09-3d-1366-after-drag.png") });

  await page.getByTestId("studio-wiring-3d-reset").click();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await draw(page, "en");
  await open3d(page);
  await panel().scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await panel().screenshot({ path: path.join(SHOTS, "10-3d-375.png") });
  await expectNoHorizontalOverflow(page);
});

test("screenshots: Plant Waterer, 375, AR", async ({ page }, info) => {
  test.skip(!process.env.P517_SHOTS || info.project.name !== "desktop", "set P517_SHOTS=1 (desktop project)");
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page, "ar", "plant_waterer");
  await draw(page, "ar");
  await openTab(page, "wiring");
  await page.waitForTimeout(600);
  await shot(page, "06-ar-375-wiring.png");
  await openTab(page, "pins");
  await shot(page, "07-ar-375-pins.png");
});

// ── 3D on a breadboard (P5-17e): screenshots only ──
test("screenshots: 3D breadboard, Plant Waterer + doorbell 1366, doorbell 375", async ({ page }, info) => {
  test.skip(!process.env.P517_SHOTS || info.project.name !== "desktop", "set P517_SHOTS=1 (desktop project)");
  test.setTimeout(180_000);
  mkdirSync(SHOTS, { recursive: true });
  const shots: [string, number, number, string][] = [
    ["plant_waterer", 1366, 900, "11-breadboard-plant-1366.png"],
    ["doorbell", 1366, 900, "12-breadboard-doorbell-1366.png"],
    ["doorbell", 375, 812, "13-breadboard-doorbell-375.png"],
  ];
  for (const [idea, width, height, file] of shots) {
    await page.setViewportSize({ width, height });
    await open(page, "en", idea);
    await draw(page, "en");
    await open3d(page);
    const panel = page.getByTestId("studio-wiring-3d");
    await panel.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await panel.screenshot({ path: path.join(SHOTS, file) });
    if (width <= 375) await expectNoHorizontalOverflow(page);
  }
});

// ── Neat orthogonal wiring + part tags (P5-17f): screenshots only ──
test("screenshots: neat 3D wiring, Plant Waterer + doorbell + cat feeder 1366, doorbell 375", async ({ page }, info) => {
  test.skip(!process.env.P517_SHOTS || info.project.name !== "desktop", "set P517_SHOTS=1 (desktop project)");
  test.setTimeout(240_000);
  mkdirSync(SHOTS, { recursive: true });
  const shots: [string, number, number, string][] = [
    ["plant_waterer", 1366, 900, "14-neat-plant-1366.png"],
    ["doorbell", 1366, 900, "15-neat-doorbell-1366.png"],
    ["cat_feeder", 1366, 900, "16-neat-feeder-1366.png"],
    ["doorbell", 375, 812, "17-neat-doorbell-375.png"],
  ];
  for (const [idea, width, height, file] of shots) {
    await page.setViewportSize({ width, height });
    await open(page, "en", idea);
    await draw(page, "en");
    await open3d(page);
    const panel = page.getByTestId("studio-wiring-3d");
    await panel.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    await expect(panel.getByTestId("studio-wiring-3d-tag").first()).toBeAttached();
    await panel.screenshot({ path: path.join(SHOTS, file) });
    if (width <= 375) await expectNoHorizontalOverflow(page);
  }
});

// ── Try it: behaviour preview in the 3D tab (P5-17g) ──

function simMsg(locale: Loc, ...keys: string[]): string {
  const all = JSON.parse(readFileSync(path.join(ROOT, "messages", `${locale}.json`), "utf8")) as {
    Studio: { views: { sim: Record<string, unknown> } };
  };
  let v: unknown = all.Studio.views.sim;
  for (const k of keys) v = (v as Record<string, unknown>)[k];
  return v as string;
}

async function startTry(page: Page) {
  await openTab(page, "3d");
  await expect.poll(async () => (await partsOnScreen(page)).length, { timeout: 20_000 }).toBeGreaterThan(1);
  await page.getByTestId("studio-wiring-3d-try").click();
  await expect(page.getByTestId("studio-sim-panel")).toBeVisible();
  await expect(page.getByTestId("studio-sim-status")).toBeVisible();
}

for (const locale of LOCALES) {
  test(`Try it: Plant Waterer, dry soil turns the pump on [${locale}]`, async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, locale, "plant_waterer");
    await draw(page, locale);
    await startTry(page);
    const panel = page.getByTestId("studio-sim-panel");
    await expect(panel).toHaveAttribute("data-outputs", /pump:off/);
    await expect(panel).toContainText(simMsg(locale, "note"));
    await page.getByTestId("studio-sim-control-soil").fill("90");
    await expect(panel).toHaveAttribute("data-outputs", /pump:on/);
    await expect(panel).toHaveAttribute("data-outputs", /ring:on/);
    const status = page.getByTestId("studio-sim-status");
    await expect(status).toContainText(simMsg(locale, "effect", "pumpOn"));
    await expect(status).toContainText(simMsg(locale, "cause", "soilDry"));
    // A higher threshold than the soil → off again.
    await page.getByTestId("studio-sim-threshold-soil").fill("95");
    await expect(panel).toHaveAttribute("data-outputs", /pump:off/);
    await expectNoHorizontalOverflow(page);
    // Stop puts it away.
    await page.getByTestId("studio-wiring-3d-try").click();
    await expect(page.getByTestId("studio-sim-panel")).toHaveCount(0);
  });

  test(`Try it: cat feeder, the button turns the servo [${locale}]`, async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, locale, "cat_feeder");
    await draw(page, locale);
    await startTry(page);
    const panel = page.getByTestId("studio-sim-panel");
    await expect(panel).toHaveAttribute("data-outputs", "servo:0");
    await page.getByTestId("studio-sim-hold-button").click();
    await expect.poll(async () => Number((await panel.getAttribute("data-outputs"))!.split(":")[1]), { timeout: 5000 }).toBeGreaterThan(0);
    await expect(panel).toHaveAttribute("data-outputs", "servo:90");
    // …and back home after the portion.
    await expect(panel).toHaveAttribute("data-outputs", "servo:0", { timeout: 6000 });
  });
}

test("Try it: reduced motion shows the states as words", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, "en", "plant_waterer");
  await draw(page, "en");
  await startTry(page);
  await page.getByTestId("studio-sim-control-soil").fill("90");
  await expect(page.getByTestId("studio-sim-chips")).toContainText(simMsg("en", "effect", "pumpOn"));
});

test("screenshots: Try it (18 plant dry 1366, 19 feeder 1366, 20 plant 375 AR)", async ({ page }, info) => {
  test.skip(!process.env.P517_SHOTS || info.project.name !== "desktop", "set P517_SHOTS=1 (desktop project)");
  test.setTimeout(180_000);
  mkdirSync(SHOTS, { recursive: true });
  const panel = () => page.getByTestId("studio-wiring-3d");
  await page.setViewportSize({ width: 1366, height: 900 });
  await open(page, "en", "plant_waterer");
  await draw(page, "en");
  await startTry(page);
  await page.getByTestId("studio-sim-control-soil").fill("88");
  await panel().scrollIntoViewIfNeeded();
  await page.mouse.move(2, 2);
  await page.waitForTimeout(2500);
  await panel().screenshot({ path: path.join(SHOTS, "18-sim-plant-dry-1366.png") });

  await open(page, "en", "cat_feeder");
  await draw(page, "en");
  await startTry(page);
  await panel().scrollIntoViewIfNeeded();
  await page.getByTestId("studio-sim-hold-button").hover();
  await page.mouse.down(); // held: the flap stays open
  await expect(page.getByTestId("studio-sim-panel")).toHaveAttribute("data-outputs", "servo:90");
  await page.waitForTimeout(800);
  await panel().screenshot({ path: path.join(SHOTS, "19-sim-feeder-1366.png") });
  await page.mouse.up();

  await page.setViewportSize({ width: 375, height: 812 });
  await open(page, "ar", "plant_waterer");
  await draw(page, "ar");
  await startTry(page);
  await page.getByTestId("studio-sim-control-soil").fill("88");
  await panel().scrollIntoViewIfNeeded();
  await page.waitForTimeout(2500);
  await panel().screenshot({ path: path.join(SHOTS, "20-sim-plant-375-ar.png") });
});
