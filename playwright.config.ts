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

export default defineConfig({
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
    reuseExistingServer: true,
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
