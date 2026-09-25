import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the ambient web smoke and web probes against the
 * production app.
 *
 * Run locally with:
 *   AMBIENT_BASE_URL=https://... npx playwright test --config playwright.ambient.config.ts
 *
 * The vitest ambient suite (`npm run test:ambient`) and these specs share the
 * bot troupe seeded by ambient/bots.ts. No webServer: the target is the
 * deployed production app, reached through AMBIENT_BASE_URL.
 *
 * Dividimos is a phone app, so everything here runs on a phone: a Pixel 7
 * profile with touch, so the screenshots and the recording show what a person
 * actually holds. The video of the walk becomes the moving part of the
 * Telegram board. The experimental probes (dark-legibility, identity) skip
 * themselves unless AMBIENT_EXPERIMENTAL=1, so a manual run opts in without
 * touching the scheduled board.
 */
export default defineConfig({
  testDir: "./ambient",
  testMatch: /(web|realtime|dark-legibility|identity)\.spec\.ts$/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 1,
  // A production-latency phone journey with four 1.4s dwells does not fit
  // Playwright's 30s default. Two attempts at 90s stay inside the workflow
  // step's budget, which the realtime probe shares.
  timeout: 90_000,
  workers: 1,
  reporter: "html",
  use: {
    ...devices["Pixel 7"],
    baseURL: process.env.AMBIENT_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: { mode: "on", size: { width: 412, height: 839 } },
  },
});
