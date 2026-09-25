import { test as base, type BrowserContext, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SeedHelper, type SeededUser } from "./seed-helper";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LoginAsOptions {
  navigate?: boolean;
}

export interface SyntheticFixtures {
  adminClient: SupabaseClient;
  seed: SeedHelper;
  loginAs: (user: SeededUser, options?: LoginAsOptions) => Promise<void>;
  newSession: (user: SeededUser) => Promise<{ context: BrowserContext; page: Page }>;
}

// ---------------------------------------------------------------------------
// Cookie-based auth helpers
// ---------------------------------------------------------------------------

function getSupabaseCookieName(): string {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const hostname = new URL(supabaseUrl).hostname;
  const ref = hostname.split(".")[0];
  return `sb-${ref}-auth-token`;
}

export function buildSessionCookie(user: SeededUser): string {
  const session = {
    access_token: user.accessToken,
    refresh_token: user.refreshToken || "noop",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: user.id, email: user.email },
  };
  const json = JSON.stringify(session);
  return "base64-" + Buffer.from(json).toString("base64url");
}

export async function loginInContext(
  ctx: BrowserContext,
  _pg: Page,
  user: SeededUser,
): Promise<void> {
  const baseURL = process.env.E2E_BASE_URL || "http://localhost:3000";
  const cookieName = getSupabaseCookieName();
  const cookieValue = buildSessionCookie(user);
  const url = new URL(baseURL);

  await ctx.addCookies([
    {
      name: cookieName,
      value: cookieValue,
      domain: url.hostname,
      path: "/",
    },
  ]);

  await ctx.addInitScript((userId: string) => {
    try {
      window.localStorage.setItem(`dividimos_tour_completed_${userId}`, "true");
    } catch {
      // localStorage unavailable; tour will show but test can still proceed
    }
  }, user.id);
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

export const test = base.extend<SyntheticFixtures>({
  adminClient: async ({}, provide) => {
    const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
    const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

    const client = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    await provide(client);
  },

  seed: async ({ adminClient }, provide) => {
    const helper = new SeedHelper(adminClient);
    await provide(helper);
    await helper.cleanup();
  },

  loginAs: async ({ page, context }, provide) => {
    const login = async (
      user: SeededUser,
      options: LoginAsOptions = {},
    ): Promise<void> => {
      const { navigate = true } = options;

      await loginInContext(context, page, user);

      if (navigate) {
        await page.goto("/app");
        await page.waitForLoadState("networkidle");
      }
    };

    await provide(login);
  },

  // A second actor needs its own context, but `browser.newContext()` drops the
  // project's device profile, so an iPhone project would silently test a
  // desktop viewport for everyone except the primary actor. Starting from the
  // project's own context options keeps every actor on the same engine,
  // viewport, touch, locale, and motion configuration as the test under test.
  newSession: async (
    {
      browser,
      contextOptions,
      viewport,
      userAgent,
      deviceScaleFactor,
      isMobile,
      hasTouch,
      locale,
      colorScheme,
      baseURL,
    },
    provide,
  ) => {
    const opened: BrowserContext[] = [];

    const openSession = async (user: SeededUser) => {
      const context = await browser.newContext({
        ...contextOptions,
        viewport,
        userAgent,
        deviceScaleFactor,
        isMobile,
        hasTouch,
        locale,
        colorScheme,
        baseURL,
      });
      opened.push(context);

      const page = await context.newPage();
      await loginInContext(context, page, user);

      return { context, page };
    };

    await provide(openSession);

    for (const context of opened) {
      await context.close();
    }
  },
});

export { expect } from "@playwright/test";
