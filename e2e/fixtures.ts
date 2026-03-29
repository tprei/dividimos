import { test as base } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SeedHelper, type SeededUser } from "./seed-helper";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Options for loginAs — controls how the browser session is established.
 */
interface LoginAsOptions {
  /** Navigate to /app after login and wait for load. Defaults to true. */
  navigate?: boolean;
}

/**
 * Custom fixtures available to synthetic tests.
 */
export interface SyntheticFixtures {
  /** Admin Supabase client using the service role key. Bypasses RLS. */
  adminClient: SupabaseClient;
  /** SeedHelper instance pre-configured with the admin client. Auto-cleans up after test. */
  seed: SeedHelper;
  /**
   * Authenticate the browser as a seeded user via /api/dev/login.
   * Sets session cookies on the page context so subsequent navigations
   * are authenticated.
   */
  loginAs: (user: SeededUser, options?: LoginAsOptions) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Environment validation
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. ` +
        "Run ./scripts/dev-setup.sh or set it manually.",
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Extended Playwright test with synthetic test fixtures.
 *
 * Usage:
 * ```ts
 * import { test, expect } from "../fixtures";
 *
 * test("user can see home page", async ({ page, seed, loginAs }) => {
 *   const alice = await seed.createUser({ handle: "alice" });
 *   await loginAs(alice);
 *   await expect(page.getByText("alice")).toBeVisible();
 * });
 * ```
 */
export const test = base.extend<SyntheticFixtures>({
  adminClient: async ({}, use) => {
    const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
    const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

    const client = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    await use(client);
  },

  seed: async ({ adminClient }, use) => {
    const helper = new SeedHelper(adminClient);

    await use(helper);

    // Cleanup all seeded data after the test finishes, even on failure
    await helper.cleanup();
  },

  loginAs: async ({ page, context }, use) => {
    const baseURL =
      process.env.E2E_BASE_URL || "http://localhost:3000";

    const login = async (
      user: SeededUser,
      options: LoginAsOptions = {},
    ): Promise<void> => {
      const { navigate = true } = options;

      // Call /api/dev/login with the seeded user's phone to establish a session
      const response = await page.request.post(`${baseURL}/api/dev/login`, {
        data: {
          phone: user.phone,
          name: user.name,
          handle: user.handle,
        },
      });

      if (!response.ok()) {
        const body = await response.text();
        throw new Error(
          `loginAs failed for ${user.handle}: ${response.status()} ${body}`,
        );
      }

      const body = await response.json();

      if (!body.success) {
        throw new Error(
          `loginAs failed for ${user.handle}: ${body.error ?? "unknown error"}`,
        );
      }

      // Apply session cookies to the browser context
      if (body.cookies && Array.isArray(body.cookies)) {
        const url = new URL(baseURL);
        await context.addCookies(
          body.cookies.map((c: { name: string; value: string }) => ({
            name: c.name,
            value: c.value,
            domain: url.hostname,
            path: "/",
          })),
        );
      }

      // Navigate to the app shell so the page is ready for assertions
      if (navigate) {
        await page.goto("/app");
        await page.waitForLoadState("networkidle");
      }
    };

    await use(login);
  },
});

export { expect } from "@playwright/test";
