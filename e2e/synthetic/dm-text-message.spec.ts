import { test, expect, loginInContext } from "../fixtures";

test.describe("DM text messages", () => {
  test("mensagem de texto aparece no thread do remetente", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice Mensagem" });
    const bob = await seed.createUser({ name: "Bob Mensagem" });
    await seed.createGroup(alice.id, [bob.id], "Grupo Compartilhado Alice Bob");
    const dm = await seed.createDmGroup(alice, bob);

    await loginAs(alice, { navigate: false });
    await page.goto(`/app/conversations/${bob.id}`);
    await page.waitForLoadState("networkidle");

    const input = page.getByTestId("chat-input");
    await expect(input).toBeVisible();

    await input.fill("Oi Bob, tudo bem?");
    await input.press("Enter");

    await expect(page.getByText("Oi Bob, tudo bem?")).toBeVisible({
      timeout: 5000,
    });

    await expect(input).toHaveValue("");

    const { data: messages } = await adminClient
      .from("chat_messages")
      .select("content, message_type, sender_id")
      .eq("group_id", dm.id)
      .eq("content", "Oi Bob, tudo bem?");

    expect(messages).toHaveLength(1);
    expect(messages![0].message_type).toBe("text");
    expect(messages![0].sender_id).toBe(alice.id);
  });

  test("contraparte recebe mensagem via realtime", async ({
    page,
    seed,
    loginAs,
    browser,
  }) => {
    const alice = await seed.createUser({ name: "Alice Realtime" });
    const bob = await seed.createUser({ name: "Bob Realtime" });
    await seed.createGroup(alice.id, [bob.id], "Grupo Compartilhado Realtime");
    const dm = await seed.createDmGroup(alice, bob);

    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();
    await loginInContext(bobContext, bobPage, bob);

    await bobPage.goto(`/app/conversations/${alice.id}`);
    await bobPage.waitForLoadState("networkidle");

    await loginAs(alice, { navigate: false });
    await page.goto(`/app/conversations/${bob.id}`);
    await page.waitForLoadState("networkidle");

    await seed.sendChatMessage(dm.id, alice.id, "Oi do realtime");

    await expect(bobPage.getByText("Oi do realtime")).toBeVisible({
      timeout: 8000,
    });

    await bobContext.close();
  });

  test("input vazio ou com só espaços não envia mensagem", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice Vazio" });
    const bob = await seed.createUser({ name: "Bob Vazio" });
    await seed.createGroup(alice.id, [bob.id], "Grupo Compartilhado Vazio");
    const dm = await seed.createDmGroup(alice, bob);

    await loginAs(alice, { navigate: false });
    await page.goto(`/app/conversations/${bob.id}`);
    await page.waitForLoadState("networkidle");

    const sendButton = page.getByTestId("send-button");
    await expect(sendButton).toBeDisabled();

    const input = page.getByTestId("chat-input");
    await input.fill("   ");

    await expect(sendButton).toBeDisabled();

    await input.press("Enter");

    const { data: messages } = await adminClient
      .from("chat_messages")
      .select("id")
      .eq("group_id", dm.id);

    expect(messages ?? []).toHaveLength(0);
  });

  test("mensagens pré-existentes carregam ao abrir o thread", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Historico" });
    const bob = await seed.createUser({ name: "Bob Historico" });
    await seed.createGroup(alice.id, [bob.id], "Grupo Compartilhado Historico");
    const dm = await seed.createDmGroup(alice, bob);

    await seed.sendChatMessage(dm.id, alice.id, "mensagem 1");
    await seed.sendChatMessage(dm.id, bob.id, "mensagem 2");

    await loginAs(alice, { navigate: false });
    await page.goto(`/app/conversations/${bob.id}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("mensagem 1")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("mensagem 2")).toBeVisible({ timeout: 5000 });

    const msg1 = page.getByText("mensagem 1");
    const msg2 = page.getByText("mensagem 2");

    const box1 = await msg1.boundingBox();
    const box2 = await msg2.boundingBox();

    expect(box1).not.toBeNull();
    expect(box2).not.toBeNull();
    expect(box1!.y).toBeLessThan(box2!.y);
  });
});
