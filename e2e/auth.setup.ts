import { test as setup, expect } from "@playwright/test";

const authFile = (name: string) => `e2e/.auth/${name}.json`;

/**
 * Authentication setup for E2E tests.
 *
 * Uses the /api/dev/login endpoint to authenticate test users.
 * Stores session cookies in e2e/.auth/ directory for reuse across tests.
 *
 * Prerequisites:
 * - Dev server running with NEXT_PUBLIC_AUTH_PHONE_TEST_MODE=true
 * - Remote Supabase or local Supabase with test users available
 */

const testUsers = [
  { name: "alice", phone: "11999990001", displayName: "Alice Test", handle: "alice_test" },
  { name: "bob", phone: "11999990002", displayName: "Bob Test", handle: "bob_test" },
  { name: "carol", phone: "11999990003", displayName: "Carol Test", handle: "carol_test" },
];

for (const user of testUsers) {
  setup(`authenticate as ${user.name}`, async ({ request }) => {
    // Call dev login API to get authenticated session (with profile setup)
    const response = await request.post("/api/dev/login", {
      data: {
        phone: user.phone,
        name: user.displayName,
        handle: user.handle,
      },
    });

    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.userId).toBeDefined();

    // The session cookies are automatically stored by Playwright's request context
    // We need to visit the app to establish the session in the browser context
  });
}

/**
 * Full browser-based auth setup that stores storage state.
 * This is the main setup used by flow tests.
 */
setup("setup alice browser session", async ({ page }) => {
  // Use dev login API via fetch, then navigate to set cookies
  const response = await page.request.post("/api/dev/login", {
    data: { phone: "11999990001", name: "Alice Test", handle: "alice_test" },
  });

  const body = await response.json();

  if (!body.success) {
    throw new Error(`Failed to login alice: ${body.error}`);
  }

  // Apply cookies from response to page context
  if (body.cookies) {
    await page.context().addCookies(
      body.cookies.map((c: { name: string; value: string }) => ({
        name: c.name,
        value: c.value,
        domain: "localhost",
        path: "/",
      })),
    );
  }

  // Navigate to app to verify session and complete any needed setup
  await page.goto("/app");

  // Wait for app to load (auth state to settle)
  await page.waitForLoadState("networkidle");

  // Check if we need to complete onboarding
  if (page.url().includes("/auth/onboard")) {
    // Complete onboarding: set handle and skip Pix key (optional in dev)
    const handleInput = page.getByPlaceholder(/handle|usuario/i);
    await handleInput.fill("alice_test");
    await page.getByRole("button", { name: /salvar|continuar|pronto|proximo/i }).click();

    // Wait for redirect to app
    await page.waitForURL("/app**", { timeout: 10000 });
  }

  // Save storage state for reuse
  await page.context().storageState({ path: authFile("alice") });
});

setup("setup bob browser session", async ({ page }) => {
  const response = await page.request.post("/api/dev/login", {
    data: { phone: "11999990002", name: "Bob Test", handle: "bob_test" },
  });

  const body = await response.json();

  if (!body.success) {
    throw new Error(`Failed to login bob: ${body.error}`);
  }

  if (body.cookies) {
    await page.context().addCookies(
      body.cookies.map((c: { name: string; value: string }) => ({
        name: c.name,
        value: c.value,
        domain: "localhost",
        path: "/",
      })),
    );
  }

  await page.goto("/app");
  await page.waitForLoadState("networkidle");

  if (page.url().includes("/auth/onboard")) {
    const handleInput = page.getByPlaceholder(/handle|usuario/i);
    await handleInput.fill("bob_test");
    await page.getByRole("button", { name: /salvar|continuar|pronto|proximo/i }).click();
    await page.waitForURL("/app**", { timeout: 10000 });
  }

  await page.context().storageState({ path: authFile("bob") });
});

setup("setup carol browser session", async ({ page }) => {
  const response = await page.request.post("/api/dev/login", {
    data: { phone: "11999990003", name: "Carol Test", handle: "carol_test" },
  });

  const body = await response.json();

  if (!body.success) {
    throw new Error(`Failed to login carol: ${body.error}`);
  }

  if (body.cookies) {
    await page.context().addCookies(
      body.cookies.map((c: { name: string; value: string }) => ({
        name: c.name,
        value: c.value,
        domain: "localhost",
        path: "/",
      })),
    );
  }

  await page.goto("/app");
  await page.waitForLoadState("networkidle");

  if (page.url().includes("/auth/onboard")) {
    const handleInput = page.getByPlaceholder(/handle|usuario/i);
    await handleInput.fill("carol_test");
    await page.getByRole("button", { name: /salvar|continuar|pronto|proximo/i }).click();
    await page.waitForURL("/app**", { timeout: 10000 });
  }

  await page.context().storageState({ path: authFile("carol") });
});
