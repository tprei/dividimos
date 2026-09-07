import { test, expect, loginInContext } from "../fixtures";

test.describe("DM text messages", () => {
  test("shows a sent text message in the sender's thread", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice Message" });
    const bob = await seed.createUser({ name: "Bob Message" });
    const dm = await seed.createDmGroup(alice, bob);

    await loginAs(alice, { navigate: false });
    await page.goto(`/app/conversations/${bob.id}`);
    await page.waitForLoadState("networkidle");

    const input = page.getByTestId("chat-input");
    await expect(input).toBeVisible();

    await input.fill("Hi Bob, all good?");
    await input.press("Enter");

    await expect(page.getByText("Hi Bob, all good?")).toBeVisible({
      timeout: 5000,
    });

    await expect(input).toHaveValue("");

    // The thread renders the message optimistically, so wait for the write
    // to land before asserting what was persisted.
    await expect
      .poll(
        async () => {
          const { data } = await adminClient
            .from("chat_messages")
            .select("id")
            .eq("group_id", dm.id)
            .eq("content", "Hi Bob, all good?");
          return data?.length ?? 0;
        },
        { timeout: 10000 },
      )
      .toBe(1);

    const { data: messages } = await adminClient
      .from("chat_messages")
      .select("content, sender_id")
      .eq("group_id", dm.id)
      .eq("content", "Hi Bob, all good?");

    expect(messages).toHaveLength(1);
    expect(messages![0].sender_id).toBe(alice.id);
  });

  test("delivers a message to the counterparty over realtime", async ({
    page,
    seed,
    loginAs,
    browser,
  }) => {
    const alice = await seed.createUser({ name: "Alice Realtime" });
    const bob = await seed.createUser({ name: "Bob Realtime" });
    const dm = await seed.createDmGroup(alice, bob);

    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();
    await loginInContext(bobContext, bobPage, bob);

    await bobPage.goto(`/app/conversations/${alice.id}`);
    await bobPage.waitForLoadState("networkidle");

    await loginAs(alice, { navigate: false });
    await page.goto(`/app/conversations/${bob.id}`);
    await page.waitForLoadState("networkidle");

    await seed.sendChatMessage(dm.id, alice.id, "hello from realtime");

    await expect(bobPage.getByText("hello from realtime")).toBeVisible({
      timeout: 8000,
    });

    await bobContext.close();
  });

  test("does not send a message that is empty or whitespace only", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice Empty" });
    const bob = await seed.createUser({ name: "Bob Empty" });
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

  test("loads pre-existing messages when the thread opens", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice History" });
    const bob = await seed.createUser({ name: "Bob History" });
    const dm = await seed.createDmGroup(alice, bob);

    await seed.sendChatMessage(dm.id, alice.id, "message 1");
    await seed.sendChatMessage(dm.id, bob.id, "message 2");

    await loginAs(alice, { navigate: false });
    await page.goto(`/app/conversations/${bob.id}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("message 1")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("message 2")).toBeVisible({ timeout: 5000 });

    const msg1 = page.getByText("message 1");
    const msg2 = page.getByText("message 2");

    const box1 = await msg1.boundingBox();
    const box2 = await msg2.boundingBox();

    expect(box1).not.toBeNull();
    expect(box2).not.toBeNull();
    expect(box1!.y).toBeLessThan(box2!.y);
  });
});
