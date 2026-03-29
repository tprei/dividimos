import { test, expect } from "../fixtures";

/**
 * Group Invite & Accept Synthetic Tests
 *
 * Verifies the group membership flows:
 * - Creator invites a user by @handle, invitee accepts
 * - Invitee sees pending invite on groups list page
 * - Declined invite removes group from list
 * - Invited member appears as "Pendente" on group detail
 * - Accepted member appears in the group's member list
 */

/**
 * Helper to log into a separate browser context for a second user.
 */
async function loginInNewContext(
  browser: import("@playwright/test").Browser,
  user: { phone: string; name: string; handle: string },
) {
  const ctx = await browser.newContext();
  const pg = await ctx.newPage();
  const baseURL = process.env.E2E_BASE_URL || "http://localhost:3000";

  const resp = await pg.request.post(`${baseURL}/api/dev/login`, {
    data: { phone: user.phone, name: user.name, handle: user.handle },
  });
  const body = await resp.json();
  if (body.cookies && Array.isArray(body.cookies)) {
    const url = new URL(baseURL);
    await ctx.addCookies(
      body.cookies.map((c: { name: string; value: string }) => ({
        name: c.name,
        value: c.value,
        domain: url.hostname,
        path: "/",
      })),
    );
  }

  return { context: ctx, page: pg };
}

test.describe("Group Invite & Accept", () => {
  test("creator invites by handle → invitee sees and accepts → appears as member", async ({
    page,
    seed,
    loginAs,
    browser,
  }) => {
    // ---------------------------------------------------------------
    // Seed: two users, alice creates a group (bob NOT added yet)
    // ---------------------------------------------------------------
    const alice = await seed.createUser({ name: "Alice Invite" });
    const bob = await seed.createUser({ name: "Bob Invite" });
    const group = await seed.createGroup(alice.id, [], "Invite Test Group");

    // ---------------------------------------------------------------
    // 1. Alice opens the group detail and invites Bob by @handle
    // ---------------------------------------------------------------
    await loginAs(alice);
    await page.goto(`/app/groups/${group.id}`);
    await page.waitForLoadState("networkidle");

    // Group name visible
    await expect(page.getByText("Invite Test Group")).toBeVisible();

    // Click "Convidar" button to open invite panel
    await page.getByRole("button", { name: /Convidar/i }).click();

    // Type Bob's handle
    await page.getByPlaceholder("handle do usuario").fill(bob.handle);

    // Click search button
    await page.locator("button", { has: page.locator("svg.lucide-search") }).click();

    // Wait for lookup result to appear
    await expect(page.getByTestId("lookup-result")).toBeVisible({ timeout: 10000 });

    // Verify Bob's name appears in the lookup result
    await expect(page.getByTestId("lookup-result").getByText("Bob Invite")).toBeVisible();

    // Click the "Convidar" button inside the lookup result
    await page.getByTestId("lookup-result").getByRole("button", { name: /Convidar/i }).click();

    // Wait for invite to complete — panel closes
    await expect(page.getByTestId("lookup-result")).not.toBeVisible({ timeout: 10000 });

    // ---------------------------------------------------------------
    // 2. Alice sees Bob as "Pendente" in the members tab
    // ---------------------------------------------------------------
    // Members tab is already active (default tab)
    await expect(page.getByText("Membros")).toBeVisible();

    // Bob should appear with "Pendente" status
    await expect(page.getByText("Bob Invite")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Pendente")).toBeVisible();

    // ---------------------------------------------------------------
    // 3. Bob opens the groups list and sees the pending invite
    // ---------------------------------------------------------------
    const { context: bobCtx, page: bobPage } = await loginInNewContext(browser, bob);

    await bobPage.goto("/app/groups");
    await bobPage.waitForLoadState("networkidle");

    // Bob should see "Convites pendentes" section
    await expect(bobPage.getByText("Convites pendentes")).toBeVisible({ timeout: 10000 });

    // Group name appears in the invite
    await expect(bobPage.getByText("Invite Test Group")).toBeVisible();

    // "Convidado por" shows Alice's name
    await expect(bobPage.getByText(/Convidado por.*Alice/i)).toBeVisible();

    // ---------------------------------------------------------------
    // 4. Bob accepts the invite
    // ---------------------------------------------------------------
    await bobPage.getByRole("button", { name: /Aceitar/i }).click();

    // Invite should disappear
    await expect(bobPage.getByText("Convites pendentes")).not.toBeVisible({ timeout: 10000 });

    // Group should now appear in the regular groups list
    await expect(bobPage.getByText("Invite Test Group")).toBeVisible();

    // ---------------------------------------------------------------
    // 5. Bob navigates to the group — sees himself as a member
    // ---------------------------------------------------------------
    await bobPage.getByText("Invite Test Group").click();
    await bobPage.waitForLoadState("networkidle");

    // Bob should see both Alice and himself in the members tab
    await expect(bobPage.getByText("Alice Invite")).toBeVisible({ timeout: 10000 });
    await expect(bobPage.getByText("Bob Invite")).toBeVisible();

    // Bob should see "Voce" badge next to his name
    await expect(bobPage.getByText("Voce")).toBeVisible();

    // Alice should be marked as "Criador"
    await expect(bobPage.getByText("Criador")).toBeVisible();

    // No "Pendente" status — Bob is now accepted
    await expect(bobPage.getByText("Pendente")).not.toBeVisible();

    // Cleanup
    await bobCtx.close();
  });

  test("invitee declines invite → group disappears from list", async ({
    seed,
    browser,
    adminClient,
  }) => {
    // ---------------------------------------------------------------
    // Seed: two users, alice creates group, bob is invited via seed
    // ---------------------------------------------------------------
    const alice = await seed.createUser({ name: "Alice Decline" });
    const bob = await seed.createUser({ name: "Bob Decline" });

    // Create group with alice as creator
    const group = await seed.createGroup(alice.id, [], "Decline Test Group");

    // Invite bob directly via admin (status: "invited")
    await adminClient.from("group_members").insert({
      group_id: group.id,
      user_id: bob.id,
      status: "invited",
      invited_by: alice.id,
    });

    // ---------------------------------------------------------------
    // 1. Bob sees the pending invite
    // ---------------------------------------------------------------
    const { context: bobCtx, page: bobPage } = await loginInNewContext(browser, bob);

    await bobPage.goto("/app/groups");
    await bobPage.waitForLoadState("networkidle");

    await expect(bobPage.getByText("Convites pendentes")).toBeVisible({ timeout: 10000 });
    await expect(bobPage.getByText("Decline Test Group")).toBeVisible();

    // ---------------------------------------------------------------
    // 2. Bob declines the invite (X button)
    // ---------------------------------------------------------------
    // The X button is inside the invite card — it's a ghost button with an X icon
    const inviteCard = bobPage.locator("div", { hasText: "Decline Test Group" })
      .filter({ has: bobPage.getByRole("button", { name: /Aceitar/i }) });
    const declineButton = inviteCard.locator("button").first();
    await declineButton.click();

    // ---------------------------------------------------------------
    // 3. Invite disappears
    // ---------------------------------------------------------------
    await expect(bobPage.getByText("Decline Test Group")).not.toBeVisible({ timeout: 10000 });
    await expect(bobPage.getByText("Convites pendentes")).not.toBeVisible();

    // Cleanup
    await bobCtx.close();
  });

  test("invited member shows as 'Pendente' in group detail members tab", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    // ---------------------------------------------------------------
    // Seed: alice creates group, bob is invited (not accepted)
    // ---------------------------------------------------------------
    const alice = await seed.createUser({ name: "Alice Pending" });
    const bob = await seed.createUser({ name: "Bob Pending" });

    const group = await seed.createGroup(alice.id, [], "Pending Test");

    // Insert bob as "invited" member
    await adminClient.from("group_members").insert({
      group_id: group.id,
      user_id: bob.id,
      status: "invited",
      invited_by: alice.id,
    });

    // ---------------------------------------------------------------
    // Alice views group detail — sees Bob as "Pendente"
    // ---------------------------------------------------------------
    await loginAs(alice);
    await page.goto(`/app/groups/${group.id}`);
    await page.waitForLoadState("networkidle");

    // Members tab is default
    await expect(page.getByText("Alice Pending")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Bob Pending")).toBeVisible();

    // Bob's entry shows "Pendente" status
    await expect(page.getByText("Pendente")).toBeVisible();

    // Alice is marked as "Criador"
    await expect(page.getByText("Criador")).toBeVisible();
  });
});
