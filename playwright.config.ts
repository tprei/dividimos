import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E configuration for Pixwise user story validation.
 *
 * Run locally with: npx playwright test --ui
 * Run headed: npx playwright test --headed
 * Run specific flow: npx playwright test e2e/flows/bill-creation.spec.ts
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // Run tests sequentially to avoid DB conflicts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker to avoid race conditions with shared test users
  reporter: "html",
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    // Setup project - authenticates test users and saves state
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    // Chromium tests (main browser) — flow tests using shared alice/bob/carol sessions
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
      testDir: "./e2e/flows",
    },
    // Synthetic tests — self-contained, each test seeds its own data via SeedHelper
    {
      name: "synthetic",
      use: { ...devices["Desktop Chrome"] },
      testDir: "./e2e/synthetic",
    },
  ],
  // Run local dev server before tests
  webServer: process.env.CI
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
      },
});
