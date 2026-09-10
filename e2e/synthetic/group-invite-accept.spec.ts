import { test, expect, loginInContext } from "../fixtures";

test.describe("Group Invite & Accept", () => {
  test("creator invites by handle → invitee sees and accepts → appears as member", async ({
    page,
    seed,
    loginAs,
    browser,
  }) => {
    const alice = await seed.createUser({ name: "Alice Invite" });
    const bob = await seed.createUser({ name: "Bob Invite" });
    const group = await seed.createGroup(alice.id, [], "Invite Test Group");

    // Alice opens the group detail and invites Bob by @handle
    await loginAs(alice);
    await page.goto(`/app/groups/${group.id}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Invite Test Group")).toBeVisible();

    await page.getByRole("button", { name: /Convidar/i }).click();

    await page.getByPlaceholder("handle do usuario").fill(bob.handle);

    await page.locator("button", { has: page.locator("svg.lucide-search") }).click();

    await expect(page.getByTestId("lookup-result")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("lookup-result").getByText("Bob Invite")).toBeVisible();

    await page.getByTestId("lookup-result").getByRole("button", { name: /Convidar/i }).click();

    await expect(page.getByTestId("lookup-result")).not.toBeVisible({ timeout: 10000 });

    // Alice sees Bob as "Pendente" in the members tab
    await page.getByRole("tab", { name: "Membros" }).click();
    await expect(page.getByText("Bob Invite")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Pendente", { exact: true })).toBeVisible();

    // Bob opens the groups list and sees the pending invite
    const bobCtx = await browser.newContext();
    const bobPage = await bobCtx.newPage();
    await loginInContext(bobCtx, bobPage, bob);

    await bobPage.goto("/app/groups");
    await bobPage.waitForLoadState("networkidle");

    await expect(bobPage.getByText("Convite · Invite Test Group")).toBeVisible({ timeout: 10000 });
    await expect(bobPage.getByText(/Enviado por.*Alice/i)).toBeVisible();

    // Bob accepts the invite
    await bobPage.getByRole("button", { name: "Aceitar convite para Invite Test Group" }).click();
    await bobPage.waitForLoadState("networkidle");

    await expect(bobPage.getByText("Convite · Invite Test Group")).not.toBeVisible({ timeout: 10000 });
    await expect(bobPage.getByRole("link", { name: /Invite Test Group/ })).toBeVisible();

    // Bob navigates to the group — sees himself as a member
    await bobPage.getByRole("link", { name: /Invite Test Group/ }).click();
    await bobPage.waitForLoadState("networkidle");

    await bobPage.getByRole("tab", { name: "Membros" }).click();

    await expect(bobPage.getByText("Alice Invite")).toBeVisible({ timeout: 10000 });
    await expect(bobPage.getByText("Bob Invite")).toBeVisible();
    await expect(bobPage.getByText("Você")).toBeVisible();
    await expect(bobPage.getByText("Criador")).toBeVisible();
    await expect(bobPage.getByText("Pendente", { exact: true })).not.toBeVisible();

    await bobCtx.close();
  });

  test("invitee declines invite → group disappears from list", async ({
    seed,
    browser,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice Decline" });
    const bob = await seed.createUser({ name: "Bob Decline" });

    const group = await seed.createGroup(alice.id, [], "Decline Test Group");

    await adminClient.from("group_members").insert({
      group_id: group.id,
      user_id: bob.id,
      status: "invited",
      invited_by: alice.id,
    });

    // Bob sees the pending invite
    const bobCtx = await browser.newContext();
    const bobPage = await bobCtx.newPage();
    await loginInContext(bobCtx, bobPage, bob);

    await bobPage.goto("/app/groups");
    await bobPage.waitForLoadState("networkidle");

    await expect(bobPage.getByText("Convite · Decline Test Group")).toBeVisible({ timeout: 10000 });

    // Bob declines the invite
    await bobPage.getByRole("button", { name: "Recusar convite para Decline Test Group" }).click();

    // Invite disappears
    await expect(bobPage.getByText("Decline Test Group")).not.toBeVisible({ timeout: 10000 });

    await bobCtx.close();
  });

  test("invited member shows as pending in the group members section", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice Pending" });
    const bob = await seed.createUser({ name: "Bob Pending" });

    const group = await seed.createGroup(alice.id, [], "Pending Test");

    await adminClient.from("group_members").insert({
      group_id: group.id,
      user_id: bob.id,
      status: "invited",
      invited_by: alice.id,
    });

    // Alice views group detail — sees Bob as "Pendente"
    await loginAs(alice);
    await page.goto(`/app/groups/${group.id}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("tab", { name: "Membros" }).click();

    await expect(page.getByText("Alice Pending")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Bob Pending")).toBeVisible();
    await expect(page.getByText("Pendente", { exact: true })).toBeVisible();
    await expect(page.getByText("Criador")).toBeVisible();
  });
});
