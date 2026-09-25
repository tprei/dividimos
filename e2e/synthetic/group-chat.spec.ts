import { test, expect } from "../fixtures";

test.describe("Group chat", () => {
  test("delivers message between members in real time and clears input", async ({
    page,
    seed,
    loginAs,
    newSession,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice Group" });
    const bob = await seed.createUser({ name: "Bob Group" });
    const group = await seed.createGroup(alice.id, [bob.id], "Chat Test Group");

    const { context: bobContext, page: bobPage } = await newSession(bob);
    await bobPage.goto(`/app/groups/${group.id}/chat`);
    await bobPage.waitForLoadState("networkidle");

    await loginAs(alice, { navigate: false });
    await page.goto(`/app/groups/${group.id}/chat`);
    await page.waitForLoadState("networkidle");

    const input = page.getByPlaceholder("Mensagem...");
    await expect(input).toBeVisible();

    const testMessage = "E aí galera do grupo!";
    await input.fill(testMessage);
    await page.getByRole("button", { name: "Enviar mensagem" }).click();

    await expect(input).toHaveValue("");
    await expect(page.getByText(testMessage)).toBeVisible();

    // The thread renders the message optimistically, so wait for the write
    // to land before asserting what was persisted.
    await expect
      .poll(async () => {
        const { data } = await adminClient
          .from("chat_messages")
          .select("id")
          .eq("group_id", group.id)
          .eq("content", testMessage);
        return data?.length ?? 0;
      }, { timeout: 10000 })
      .toBe(1);

    await expect(bobPage.getByText(testMessage)).toBeVisible({
      timeout: 10000,
    });

    await bobContext.close();
  });
});

test("group chat keeps the composer reachable and receives another member's message", async ({
  page, seed, loginAs, newSession,
}) => {
  const alice = await seed.createUser({ name: "Alice Souza" });
  const bob = await seed.createUser({ name: "João Pedro Almeida" });
  const group = await seed.createGroup(alice.id, [bob.id], "Viagem de setembro");
  for (let index = 0; index < 32; index += 1) {
    await seed.sendChatMessage(group.id, index % 2 ? alice.id : bob.id, `Mensagem da viagem ${index}`);
  }
  await loginAs(alice);
  await page.setViewportSize({ width: 390, height: 450 });
  await page.goto(`/app/groups/${group.id}/chat`);
  await page.getByText("Mensagem da viagem 0", { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByText("Mensagem da viagem 0", { exact: true })).toBeVisible();
  await page.getByText("Mensagem da viagem 31", { exact: true }).scrollIntoViewIfNeeded();
  const composer = page.getByRole("textbox", { name: "Mensagem", exact: true });
  await composer.fill("Cheguei!");
  await expect(composer).toBeInViewport();
  await page.getByRole("button", { name: "Enviar mensagem", exact: true }).click();
  await expect(page.getByRole("paragraph").filter({ hasText: /^Cheguei!$/ })).toBeVisible();
  const other = await newSession(bob);
  await other.page.goto(`/app/groups/${group.id}/chat`);
  await other.page.getByRole("textbox", { name: "Mensagem", exact: true }).fill("Já estou na entrada.");
  await other.page.getByRole("button", { name: "Enviar mensagem", exact: true }).click();
  await expect(page.getByText("Já estou na entrada.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});