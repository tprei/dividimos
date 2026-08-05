import { test, expect, loginInContext } from "../fixtures";

test.describe("Settlement Flow", () => {
  test("three-user expense shows simplification and settles correctly", async ({
    page,
    seed,
    loginAs,
    browser,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice Settle" });
    const bob = await seed.createUser({ name: "Bob Settle" });
    const carol = await seed.createUser({ name: "Carol Settle" });
    const group = await seed.createGroup(alice.id, [bob.id, carol.id], "Settlement Test");

    await seed.createActiveExpense(
      group.id,
      alice.id,
      [alice.id, bob.id, carol.id],
      {
        title: "Almoco Settlement",
        totalAmount: 12000,
        expenseType: "single_amount",
      },
    );

    await seed.createActiveExpense(
      group.id,
      bob.id,
      [alice.id, bob.id, carol.id],
      {
        title: "Cafe Settlement",
        totalAmount: 6000,
        expenseType: "single_amount",
        payers: { [bob.id]: 6000 },
      },
    );

    // Alice views the settlement tab
    await loginAs(alice);
    await page.goto(`/app/groups/${group.id}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Acerto" }).click();

    await expect(page.getByText("Saldo consolidado")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("a receber").first()).toBeVisible();
    await expect(page.getByText(/R\$\s/).first()).toBeVisible();

    // Bob views the settlement tab
    const bobCtx = await browser.newContext();
    const bobPage = await bobCtx.newPage();
    await loginInContext(bobCtx, bobPage, bob);

    await bobPage.goto(`/app/groups/${group.id}`);
    await bobPage.waitForLoadState("networkidle");

    await bobPage.getByRole("button", { name: "Acerto" }).click();

    await expect(
      bobPage.getByText(/Você deve|Você recebe|a pagar|a receber/i).first(),
    ).toBeVisible({ timeout: 10000 });

    // Settle all remaining debts via RPC. With the normalized ledger the
    // intermediary (Bob) may net to zero, so the debtor could be anyone.
    // Each settlement is authenticated as the debtor (from_user).
    const aliceClient = await seed.authenticateAs(alice.id);
    const bobClient = await seed.authenticateAs(bob.id);
    const carolClient = await seed.authenticateAs(carol.id);
    const clientFor: Record<string, typeof aliceClient> = {
      [alice.id]: aliceClient,
      [bob.id]: bobClient,
      [carol.id]: carolClient,
    };

    const { data: debts } = await adminClient
      .from("balances")
      .select("*")
      .eq("group_id", group.id)
      .neq("amount_cents", 0);

    for (const row of debts ?? []) {
      const amount = row.amount_cents as number;
      const userA = row.user_a as string;
      const userB = row.user_b as string;
      const fromUser = amount > 0 ? userA : userB;
      const toUser = amount > 0 ? userB : userA;

      await clientFor[fromUser].rpc("record_settlements", {
        p_allocations: [{
          group_id: group.id,
          from_user_id: fromUser,
          to_user_id: toUser,
          amount_cents: Math.abs(amount),
        }],
        p_operation_id: crypto.randomUUID(),
      });
    }

    // Alice checks the "Pagamentos" tab
    await page.goto(`/app/groups/${group.id}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Pagamentos" }).click();
    await expect(
      page.getByText(/Confirmado/i).first(),
    ).toBeVisible({ timeout: 10000 });

    // Alice verifies "Tudo liquidado!" on the settlement tab
    await page.goto(`/app/groups/${group.id}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Acerto" }).click();
    await expect(page.getByText("Tudo liquidado!")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Nenhuma dívida pendente no grupo")).toBeVisible();

    await bobCtx.close();
  });

  test("debtor sees 'Pagar via Pix' button on settlement tab", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Pix" });
    const bob = await seed.createUser({ name: "Bob Pix" });
    const group = await seed.createGroup(alice.id, [bob.id], "Pix Test");

    await seed.createActiveExpense(
      group.id,
      alice.id,
      [alice.id, bob.id],
      {
        title: "Jantar Pix",
        totalAmount: 20000,
        expenseType: "single_amount",
      },
    );

    await loginAs(bob);
    await page.goto(`/app/groups/${group.id}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Acerto" }).click();

    await expect(
      page.getByRole("button", { name: /Pagar via Pix/i }),
    ).toBeVisible({ timeout: 10000 });

    await expect(page.getByText("R$ 100,00").first()).toBeVisible();
    await expect(page.getByText("Você deve")).toBeVisible();
  });

  test("creditor sees 'Gerar cobranca' button on settlement tab", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Cred" });
    const bob = await seed.createUser({ name: "Bob Cred" });
    const group = await seed.createGroup(alice.id, [bob.id], "Creditor Test");

    await seed.createActiveExpense(
      group.id,
      alice.id,
      [alice.id, bob.id],
      {
        title: "Jantar Creditor",
        totalAmount: 10000,
        expenseType: "single_amount",
      },
    );

    await loginAs(alice);
    await page.goto(`/app/groups/${group.id}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Acerto" }).click();

    await expect(
      page.getByRole("button", { name: /Gerar cobranca/i }),
    ).toBeVisible({ timeout: 10000 });

    await expect(page.getByText("Você recebe")).toBeVisible();
    await expect(page.getByText("R$ 50,00").first()).toBeVisible();
  });
});
