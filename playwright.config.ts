import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E configuration for Dividimos user story validation.
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
  // Worker pool for the whole run: in CI it is shared by every project, so
  // this (plus any per-project caps below) bounds total concurrency.
  workers: process.env.CI ? 3 : 1,
  reporter: "html",
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // In CI the first retry records video next to its trace, so passing
    // attempts skip the recording cost. Locally there are no retries, so a
    // failure keeps its own video.
    video: process.env.CI ? "on-first-retry" : "retain-on-failure",
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
      // Single worker to avoid race conditions with shared test users.
      // This cap is per-project: the flow tests never borrow the rest of the
      // CI worker pool.
      workers: 1,
    },
    // Synthetic tests — self-contained, each test seeds its own data via SeedHelper.
    // JWT-based auth (no GoTrue sign-in) eliminates magic-link races, so these
    // can safely run in parallel within each CI shard.
    {
      name: "synthetic",
      // The app's service worker answers /api/** and /app/** from cache, which
      // makes page.route mocks fire or not depending on the engine. Blocking
      // it keeps every project's interception identical.
      use: { ...devices["Desktop Chrome"], serviceWorkers: "block" },
      testDir: "./e2e/synthetic",
      fullyParallel: true,
    },
    // Same synthetic suite on mobile browser engines. iPhone 13 runs WebKit and
    // Pixel 5 runs mobile Chromium, so viewport, touch, and engine differences
    // are exercised on every synthetic journey. These are Playwright device
    // profiles, not a claim of emulating specific handset hardware.
    {
      name: "synthetic-ios",
      use: { ...devices["iPhone 13"], serviceWorkers: "block" },
      testDir: "./e2e/synthetic",
      fullyParallel: true,
    },
    {
      name: "synthetic-android",
      use: { ...devices["Pixel 5"], serviceWorkers: "block" },
      testDir: "./e2e/synthetic",
      fullyParallel: true,
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
