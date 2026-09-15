import { test, expect } from "../fixtures";

// The profile lookup surface is the rate-limited /api/users/lookup route.
// Direct RPC access is denied for browser roles since
// 20260913010070_profile_lookup_service_role, so the browser path must keep
// working end to end: search by exact handle finds the onboarded profile and
// an unknown handle reports not found without leaking anything.
test.describe("Profile lookup", () => {
  test("searching by exact handle finds the profile through the route", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Lookup", handle: "alice_lookup" });
    await loginAs(alice, { navigate: false });

    const response = await page.request.get("/api/users/lookup?handle=alice_lookup");
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      profile: { id: string; handle: string; name: string; avatarUrl: string | null };
    };
    expect(body.profile).toEqual({
      id: alice.id,
      handle: "alice_lookup",
      name: "Alice Lookup",
      avatarUrl: null,
    });
  });

  test("an unknown handle is not found and leaks nothing", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Unknown" });
    await loginAs(alice, { navigate: false });

    const response = await page.request.get("/api/users/lookup?handle=nao_existe_nunca");
    expect(response.status()).toBe(404);
    const body = (await response.json()) as { error?: string; profile?: unknown };
    expect(body.error).toBe("Usuário não encontrado");
    expect(body.profile).toBeUndefined();
  });

  test("the browser cannot call the lookup RPC directly", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Direct", handle: "alice_direct" });
    await loginAs(alice, { navigate: false });

    const response = await page.request.post(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/lookup_user_by_handle`,
      {
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          authorization: `Bearer ${alice.accessToken}`,
        },
        data: { p_handle: "alice_direct" },
      },
    );
    expect(response.status()).toBeGreaterThanOrEqual(400);
    const body = (await response.json()) as { message?: string };
    expect(body.message).toMatch(/permission denied for function lookup_user_by_handle/);
  });
});
