import { test, expect } from "../fixtures";

test.describe("Expense edit conflict", () => {
  test("saving after a concurrent edit surfaces the conflict panel", async ({
    page,
    context,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Editor" });
    const bob = await seed.createUser({ name: "Bob Editor" });
    const group = await seed.createGroup(alice.id, [bob.id], "Conflict Test");

    const expense = await seed.createExpense(group.id, alice.id, [alice.id, bob.id], {
      title: "Jantar Conflituoso",
      totalCents: 10000,
    });

    await loginAs(alice, { navigate: false });
    // Keep this client from hearing the concurrent edit over realtime: the
    // conflict panel exists for exactly the missed-update case.
    await context.routeWebSocket(/\/realtime\//, () => {});

    await page.goto(`/app/bill/new?edit=${expense.id}`);
    await page.waitForLoadState("networkidle");

    const titleInput = page.getByLabel("Nome da conta");
    await expect(titleInput).toHaveValue("Jantar Conflituoso", { timeout: 15000 });

    const detail = await seed.getExpense(alice.id, expense.id);
    const bobClient = await seed.authenticateAs(bob.id);
    const { error } = await bobClient.rpc("edit_expense", {
      p_expense_id: expense.id,
      p_expected_version_no: detail.expense.currentVersionNo,
      p_occurred_on: detail.current.occurredOn,
      p_title: "Jantar Replanejado",
      p_merchant_name: detail.current.merchantName ?? "",
      p_expense_type: detail.current.expenseType,
      p_total_cents: detail.current.totalCents,
      p_service_fee_bps: detail.current.serviceFeeBasisPoints,
      p_fixed_fee_cents: detail.current.fixedFeeCents,
      p_payload: detail.current.payload,
    });
    expect(error).toBeNull();

    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await page.getByRole("button", { name: "Salvar alterações" }).click();

    const panel = page.getByRole("alert").filter({ hasText: "enquanto você editava" });
    await expect(panel).toBeVisible({ timeout: 15000 });
    await expect(
      panel.getByText("Bob Editor alterou esta conta enquanto você editava"),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByText("Carregue a versão mais recente pra salvar."),
    ).toBeVisible();

    await panel.getByRole("button", { name: "Carregar versão mais recente" }).click();
    await expect(
      page.getByText("Carregue a versão mais recente pra salvar."),
    ).toBeHidden({ timeout: 15000 });

    await expect(titleInput).toHaveValue("Jantar Replanejado", { timeout: 10000 });
  });
});
