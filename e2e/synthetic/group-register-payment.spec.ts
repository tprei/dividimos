import { test, expect } from "../fixtures";

test.describe("Group register payment", () => {
  test("records a payment from group chat without a bill and moves the balance", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice Paga" });
    const bob = await seed.createUser({ name: "Bob Recebe" });
    const group = await seed.createGroup(alice.id, [bob.id], "Grupo Pagamento");
    await seed.createExpense(group.id, bob.id, [alice.id, bob.id], {
      title: "Churrasco",
      totalCents: 10000,
      expenseType: "single_amount",
    });

    await loginAs(alice, { navigate: false });
    await page.goto(`/app/groups/${group.id}/chat`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Registrar pagamento" }).click();
    const amount = page.getByRole("textbox", { name: "Valor do pagamento" });
    await amount.click();
    await amount.pressSequentially("3000");
    await page.getByRole("button", { name: /^Registrar$|Confirmar/ }).click();

    await expect(page.getByText(/Você pagou/)).toBeVisible({ timeout: 15000 });

    await expect
      .poll(async () => {
        const { data } = await adminClient
          .from("settlements")
          .select("from_user_id, to_user_id, amount_cents, status")
          .eq("group_id", group.id);
        return data ?? [];
      })
      .toEqual([
        {
          from_user_id: alice.id,
          to_user_id: bob.id,
          amount_cents: 3000,
          status: "confirmed",
        },
      ]);

    await page.goto(`/app/groups/${group.id}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("tab", { name: "Saldos" }).click();
    await expect(page.getByRole("button", { name: /Você paga/i })).toContainText("R$ 20,00");
  });
});
