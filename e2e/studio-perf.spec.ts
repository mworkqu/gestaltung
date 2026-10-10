import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, msg, test } from "./fixtures";

// Studio performance probe (P5-15e), on the e2e studio fixture at 375 px with the
// CPU slowed 4× through CDP (Emulation.setCPUThrottlingRate) — a mid phone.
// Not part of the normal run (timings are machine-dependent):
//   STUDIO_PERF=1 npx playwright test e2e/studio-perf.spec.ts --project=mobile-375
// Writes test-results/studio-final/perf.json. Budgets (owner): first render ≤ 2.5 s.

const OUT = path.resolve(__dirname, "..", "test-results", "studio-final");

test("studio perf: first render, parts canvas, enclosure build off the main thread", async ({ page }, info) => {
  test.skip(!process.env.STUDIO_PERF || info.project.name !== "mobile-375", "set STUDIO_PERF=1, mobile-375 only");
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("gestaltung:cookie-consent", `declined.${Date.now()}`);
    } catch {
      /* storage blocked */
    }
    const w = window as unknown as { __perf: { fcp?: number; lcp?: number; longTasks: { start: number; dur: number }[] } };
    w.__perf = { longTasks: [] };
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (e.name === "first-contentful-paint") w.__perf.fcp = e.startTime;
    }).observe({ type: "paint", buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) w.__perf.lcp = e.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) w.__perf.longTasks.push({ start: e.startTime, dur: e.duration });
    }).observe({ type: "longtask", buffered: true });
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  await page.goto("/en/e2e-fixtures/studio");
  const input = page.getByRole("textbox", { name: msg("en", "Studio", "ideaPlaceholder") });
  await expect(input).toBeVisible();
  await page.waitForTimeout(1500);
  const load = await page.evaluate(() => {
    const w = window as unknown as { __perf: { fcp?: number; lcp?: number } };
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return { fcp: w.__perf.fcp ?? null, lcp: w.__perf.lcp ?? null, domInteractive: nav?.domInteractive ?? null, load: nav?.loadEventEnd ?? null };
  });

  // Idea → Parts: time from "Looks right" to a visible, sized WebGL canvas.
  await expect(async () => {
    await input.fill("A little desk friend that lights up when I walk in");
    await expect(input).toHaveValue("A little desk friend that lights up when I walk in", { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await input.press("Enter");
  await page.getByTestId("studio-choices").getByRole("button").first().click();
  await expect(page.getByTestId("studio-idea-summary")).toBeVisible({ timeout: 20_000 });
  const profile = !!process.env.STUDIO_PROFILE;
  if (profile) {
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
    await cdp.send("Profiler.start");
  }
  const t0 = await page.evaluate(() => performance.now());
  await page.getByRole("button", { name: msg("en", "Studio", "looksRight") }).click();
  const canvas = page.getByTestId("studio-parts-viewer").locator("canvas").first();
  await expect(canvas).toBeVisible({ timeout: 60_000 });
  await expect(async () => {
    const b = await canvas.boundingBox();
    expect(b?.width ?? 0).toBeGreaterThan(50);
  }).toPass({ timeout: 30_000 });
  const canvasShownMs = (await page.evaluate(() => performance.now())) - t0;
  // First drawn frame: the canvas has non-background pixels.
  await expect(async () => {
    const drawn = await canvas.evaluate((c: HTMLCanvasElement) => {
      const gl = (c.getContext("webgl2") ?? c.getContext("webgl")) as WebGLRenderingContext | null;
      if (!gl) return false;
      const px = new Uint8Array(4 * 16);
      gl.readPixels(Math.floor(c.width / 2) - 2, Math.floor(c.height / 2) - 2, 4, 4, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px.some((v, i) => i % 4 === 3 && v > 0);
    });
    expect(drawn).toBe(true);
  }).toPass({ timeout: 60_000 });
  const partsCanvasMs = (await page.evaluate(() => performance.now())) - t0;
  if (profile) {
    // Self time per function (top 25), to see what the first 3D frame waits for.
    const { profile: prof } = (await cdp.send("Profiler.stop")) as unknown as {
      profile: { nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number } }[]; samples: number[]; timeDeltas: number[] };
    };
    const byId = new Map(prof.nodes.map((n) => [n.id, n]));
    const self = new Map<string, number>();
    prof.samples.forEach((id, i) => {
      const n = byId.get(id);
      if (!n) return;
      const f = n.callFrame;
      const key = `${f.functionName || "(anon)"} @ ${f.url.split("/").pop()}:${f.lineNumber}`;
      self.set(key, (self.get(key) ?? 0) + (prof.timeDeltas[i] ?? 0) / 1000);
    });
    const byFile = new Map<string, number>();
    for (const [k, v] of self) {
      const file = k.split(" @ ")[1].split(":")[0] || "(native)";
      byFile.set(file, (byFile.get(file) ?? 0) + v);
    }
    console.log("[studio-profile] files", JSON.stringify([...byFile].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => [k, Math.round(v)])));
    console.log("[studio-profile] functions", JSON.stringify([...self].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => [k, Math.round(v)])));
  }
  const partsLongTasks = await page.evaluate((a) => {
    const w = window as unknown as { __perf: { longTasks: { start: number; dur: number }[] } };
    return w.__perf.longTasks.filter((t) => t.start >= a).map((t) => Math.round(t.dur));
  }, t0);

  // Parts → Wiring → Enclosure; then "Draw it": time to a built case + the longest main-thread task meanwhile.
  await page.getByRole("button", { name: msg("en", "Studio", "next"), exact: true }).click();
  await page.getByRole("button", { name: msg("en", "Studio", "wiringDrawCredit") }).click();
  await expect(page.getByTestId("studio-schematic").locator("svg").first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: msg("en", "Studio", "next"), exact: true }).click();
  const t1 = await page.evaluate(() => performance.now());
  await page.getByRole("button", { name: msg("en", "Studio", "drawItCredit") }).click();
  await expect(page.getByTestId("studio-enclosure-viewer").locator("[data-case]")).toHaveAttribute("data-case", "ready", { timeout: 90_000 });
  const t2 = await page.evaluate(() => performance.now());
  const longest = await page.evaluate(
    ([a, b]) => {
      const w = window as unknown as { __perf: { longTasks: { start: number; dur: number }[] } };
      return w.__perf.longTasks.filter((t) => t.start >= a && t.start <= b).reduce((m, t) => Math.max(m, t.dur), 0);
    },
    [t1, t2],
  );

  const result = {
    cpuThrottle: 4,
    viewport: "375x812",
    fcpMs: load.fcp && Math.round(load.fcp),
    lcpMs: load.lcp && Math.round(load.lcp),
    domInteractiveMs: load.domInteractive && Math.round(load.domInteractive),
    partsCanvasElementMs: Math.round(canvasShownMs),
    partsCanvasMs: Math.round(partsCanvasMs),
    partsLongTasksMs: partsLongTasks,
    enclosureReadyMs: Math.round(t2 - t1),
    longestMainThreadTaskDuringEnclosureMs: Math.round(longest),
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, "perf.json"), JSON.stringify(result, null, 2));
  console.log("[studio-perf]", JSON.stringify(result));
});
