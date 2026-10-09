import { defineConfig } from "@playwright/test";

// P3-10 smoke suite (read-only). The app's Supabase is PRODUCTION, so every
// spec runs behind the write guard in e2e/fixtures.ts (aborts any non-GET to
// Supabase and to /api/*). Not part of the Vercel build: run it by hand.
//
//   npm run build && npm run test:e2e
//
// `npm run start` serves the production build, so `npm run build` must have
// run first (the webServer below does not build). An already running server
// on :3000 is reused.
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
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run start",
    url: "http://localhost:3000/en",
    reuseExistingServer: true,
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
