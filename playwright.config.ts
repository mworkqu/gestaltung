import { readFileSync } from "node:fs";
import path from "node:path";

import { defineConfig } from "@playwright/test";

// P3-10 smoke suite (read-only). The app's Supabase is PRODUCTION, so every
// spec runs behind the write guard in e2e/fixtures.ts (aborts any non-GET to
// Supabase and to /api/*). Not part of the Vercel build: run it by hand.
//
//   npm run build && npm run test:e2e
//
// `npm run start` serves the production build, so `npm run build` must have
// run first (the webServer below does not build). An already running server on
// the port below is reused.
//
// SET E2E_PORT when another checkout of this repo is already serving :3000.
// reuseExistingServer cannot tell whose server it is, so the suite would
// silently test THAT build and report confident, meaningless results - which is
// exactly what happened once. A worktree should run on its own port:
//   E2E_PORT=3100 npm run test:e2e
const PORT = process.env.E2E_PORT || "3000";
const ORIGIN = `http://localhost:${PORT}`;

// CI only (E2E_SKIP_KNOWN_FAILING=1): leave out two checked-in lists of tests.
//   e2e/KNOWN_FAILING.txt     the studio specs that fail today (docs/history/2026-11-consolidation-phase2.md)
//   e2e/NEEDS_LIVE_READS.txt  specs that need the real Supabase project / AI key, which CI does not have
// Locally nothing is hidden. Both lists may only shrink, never grow
// (docs/history/2026-11-consolidation-phase4.md). Matched against "<project> <file> <title>".
function excludedTests(): RegExp | undefined {
  if (process.env.E2E_SKIP_KNOWN_FAILING !== "1") return undefined;
  const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lines = (file: string) =>
    readFileSync(path.join(__dirname, "e2e", file), "utf8")
      .split(/\r?\n/)
      .filter((l) => l.trim() && !l.startsWith("#"))
      .map((l) => l.split("|").map((x) => x.trim()));
  const parts = [
    ...lines("KNOWN_FAILING.txt").map(([project, file, title]) => `${escape(project)} ${escape(file)} ${escape(title)}$`),
    ...lines("NEEDS_LIVE_READS.txt").map(([file, title]) => `\\S+ ${escape(file)} .*${escape(title)}`),
  ];
  return parts.length ? new RegExp(parts.join("|")) : undefined;
}

export default defineConfig({
  grepInvert: excludedTests(),
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: ORIGIN,
    trace: "on-first-retry",
  },
  webServer: {
    command: `npm run start -- -p ${PORT}`,
    url: `${ORIGIN}/en`,
    // NEVER reuse by default. A server started earlier keeps serving the build
    // it booted with, so a rebuild does not reach it: the suite then tests OLD
    // app code with CURRENT test code and reports confident nonsense. That cost
    // a whole debugging session twice - once against another checkout on :3000,
    // once against a server of ours left running on :3100. Opt in with
    // E2E_REUSE=1 only when you know the server matches the build.
    reuseExistingServer: process.env.E2E_REUSE === "1",
    // Turns on the test-only routes under /{locale}/e2e-fixtures (lib/e2e-fixtures.ts;
    // never reachable on Vercel). A server you started yourself needs E2E_FIXTURES=1 too.
    env: { E2E_FIXTURES: "1", PORT },
    timeout: 120_000,
  },
  projects: [
    {
      name: "desktop",
      use: { browserName: "chromium", viewport: { width: 1280, height: 900 } },
    },
    {
      name: "mobile-375",
      use: {
        browserName: "chromium",
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
  ],
});
