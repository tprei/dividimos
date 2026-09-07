import { test, expect } from "../fixtures";

test.describe("DM conversations list", () => {
  test("shows the empty state when the user has no conversations", async ({
    page,
    seed,
    loginAs,
  }) => {
    const solo = await seed.createUser({ name: "Solo User" });

    await loginAs(solo);
    await page.goto("/app/conversations");
    await expect(
      page.getByRole("heading", { name: "Conversas" }),
    ).toBeVisible();

    await expect(
      page.getByRole("heading", { name: "Nenhuma conversa" }),
    ).toBeVisible();
  });

  test("lists accepted conversations once with their latest message", async ({
    page,
    seed,
    loginAs,
  }) => {
    const [alice, bob, carol, dan] = await Promise.all([
      seed.createUser({ name: "Alice List" }),
      seed.createUser({ name: "Bob List" }),
      seed.createUser({ name: "Carol List" }),
      seed.createUser({ name: "Dan List" }),
    ]);

    const [dmBob, dmCarol, dmDan] = await Promise.all([
      seed.createDmGroup(alice, bob),
      seed.createDmGroup(alice, carol),
      seed.createDmGroup(alice, dan),
    ]);

    await Promise.all([
      seed.createExpense(dmBob.id, bob.id, [alice.id, bob.id], {
        title: "Shared Uber",
        totalCents: 10000,
      }),
      seed.sendChatMessage(dmBob.id, alice.id, "we took the uber yesterday"),
      seed.sendChatMessage(dmCarol.id, alice.id, "all good?"),
      seed.createExpense(dmDan.id, alice.id, [alice.id, dan.id], {
        title: "Lunch",
        totalCents: 4000,
      }),
    ]);

    await loginAs(alice);
    await page.goto("/app/conversations");
    await expect(
      page.getByRole("heading", { name: "Conversas" }),
    ).toBeVisible();

    await expect(page.getByText("Bob List")).toBeVisible();
    await expect(page.getByText("Carol List")).toBeVisible();
    await expect(page.getByText("Dan List")).toBeVisible();

    await expect(page.getByRole("link", { name: /Bob List/ })).toHaveCount(1);
    await expect(page.getByRole("link", { name: /Carol List/ })).toHaveCount(1);
    await expect(page.getByRole("link", { name: /Dan List/ })).toHaveCount(1);

    await expect(page.getByText("we took the uber yesterday")).toBeVisible();
    await expect(page.getByText("all good?")).toBeVisible();
    await expect(page.getByText("Sem mensagens")).toBeVisible();
  });
});
