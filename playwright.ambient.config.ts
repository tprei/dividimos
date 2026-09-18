import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the ambient web smoke against the production app.
 *
 * Run locally with:
 *   AMBIENT_BASE_URL=https://... npx playwright test --config playwright.ambient.config.ts
 *
 * The vitest ambient suite (`npm run test:ambient`) and this smoke share the
 * bot troupe seeded by ambient/bots.ts. No webServer: the target is the
 * deployed production app, reached through AMBIENT_BASE_URL.
 */
export default defineConfig({
  testDir: "./ambient",
  testMatch: /web\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 1,
  reporter: "html",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.AMBIENT_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
