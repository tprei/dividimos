import { test, expect, loginInContext } from "../fixtures";

test.describe("DM consent", () => {
  test("initiator sees an awaiting-acceptance conversation without payment affordances", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Consent" });
    const bob = await seed.createUser({ name: "Bob Consent" });

    await loginAs(alice, { navigate: false });
    await page.goto(`/app/conversations/${bob.id}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText(bob.name, { exact: true })).toBeVisible();

    await expect(
      page.getByText(`Aguardando @${bob.handle} aceitar o convite`),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Cobrar", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Dividir conta" })).toHaveCount(0);
  });

  test("invitee sees only the invitation, never messages or money", async ({
    browser,
    seed,
  }) => {
    const alice = await seed.createUser({ name: "Alice Convite" });
    const bob = await seed.createUser({ name: "Bob Convite" });

    const dm = await seed.createDmGroup(alice, bob, {
      autoAcceptCounterparty: false,
    });
    await seed.sendChatMessage(dm.id, alice.id, "conteúdo privado antes do aceite");

    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();
    await loginInContext(bobContext, bobPage, bob);

    await bobPage.goto("/app/conversations");
    await expect(
      bobPage.getByRole("link", { name: new RegExp(alice.name) }),
    ).toBeVisible();

    await bobPage.getByTestId("conversation-row-dm").click();

    await expect(bobPage.getByText("Esta conversa está pendente.")).toBeVisible();
    await expect(
      bobPage.getByText(`@${alice.handle} convidou você a conversar`),
    ).toBeVisible();

    await expect(bobPage.getByText("conteúdo privado antes do aceite")).toHaveCount(0);
    await expect(bobPage.getByTestId("chat-input")).toHaveCount(0);
    await expect(bobPage.getByRole("button", { name: "Cobrar", exact: true })).toHaveCount(
      0,
    );

    await bobContext.close();
  });

  test("accepting makes the conversation usable for both sides", async ({
    page,
    browser,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Aceite" });
    const bob = await seed.createUser({ name: "Bob Aceite" });

    await seed.createDmGroup(alice, bob, { autoAcceptCounterparty: false });

    await loginAs(alice, { navigate: false });
    await page.goto(`/app/conversations/${bob.id}`);
    await page.waitForLoadState("networkidle");

    const banner = page.getByText(`Aguardando @${bob.handle} aceitar o convite`);
    await expect(banner).toBeVisible();
    await expect(page.getByTestId("chat-input")).toHaveCount(0);

    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();
    await loginInContext(bobContext, bobPage, bob);

    await bobPage.goto("/app/conversations");
    await bobPage.getByTestId("conversation-row-dm").click();

    await bobPage.getByRole("button", { name: "Aceitar convite" }).click();

    await expect(bobPage.getByTestId("chat-input")).toBeVisible({ timeout: 10000 });

    await expect(banner).toBeHidden({ timeout: 10000 });
    await expect(page.getByTestId("chat-input")).toBeVisible({ timeout: 10000 });

    await bobContext.close();
  });

  test("declining removes the conversation from the invitee's list", async ({
    browser,
    seed,
  }) => {
    const alice = await seed.createUser({ name: "Alice Recusa" });
    const bob = await seed.createUser({ name: "Bob Recusa" });

    await seed.createDmGroup(alice, bob, { autoAcceptCounterparty: false });

    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();
    await loginInContext(bobContext, bobPage, bob);

    await bobPage.goto("/app/conversations");
    await bobPage.getByTestId("conversation-row-dm").click();
    await expect(bobPage.getByText("Esta conversa está pendente.")).toBeVisible();

    await bobPage.getByRole("button", { name: "Recusar" }).click();

    await expect(bobPage).toHaveURL(/\/app\/conversations$/);

    await bobPage.reload();
    await expect(
      bobPage.getByRole("heading", { name: "Nenhuma conversa" }),
    ).toBeVisible();
    await expect(bobPage.getByTestId("conversation-row-dm")).toHaveCount(0);

    await bobContext.close();
  });
});
