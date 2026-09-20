import { test, expect } from "../fixtures";

test.describe("Lembrar reports that the reminder went out", () => {
  test("settles on a disabled Lembrete enviado after one tap", async ({
    page,
    adminClient,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Lembra", pixKeyType: "email" });
    const bob = await seed.createUser({ name: "Bob Lembrado" });
    // Opted out of reminders, so the server records the nudge and suppresses
    // delivery instead of depending on a real push subscription.
    await adminClient
      .from("users")
      .update({ notification_preferences: { nudges: false } })
      .eq("id", bob.id);

    const group = await seed.createGroup(alice.id, [bob.id], "Grupo Lembrete");
    await seed.createExpense(group.id, alice.id, [alice.id, bob.id], {
      title: "Conta do lembrete",
      totalCents: 8000,
      expenseType: "single_amount",
    });

    await loginAs(alice);
    await page.getByRole("button", { name: /^Bob Lembrado, .*Grupo Lembrete$/ }).click();

    const remind = page.getByRole("button", { name: "Lembrar" });
    await expect(remind).toBeEnabled();
    await remind.click();

    // Without this the button looked untouched, so people tapped again and
    // collected the server's 24h-cooldown errors.
    const sent = page.getByRole("button", { name: "Lembrete enviado" });
    await expect(sent).toBeVisible();
    await expect(sent).toBeDisabled();
    await expect(page.getByRole("button", { name: "Lembrar" })).toHaveCount(0);
  });
});
