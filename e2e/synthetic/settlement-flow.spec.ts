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
      bobPage.getByText(/Voce deve|Voce recebe|a pagar|a receber/i).first(),
    ).toBeVisible({ timeout: 10000 });

    // Settle Bob's debt to Alice via RPC
    const bobClient = await seed.authenticateAs(bob.id);

    const { data: balances } = await adminClient
      .from("balances")
      .select("*")
      .eq("group_id", group.id)
      .neq("amount_cents", 0);

    for (const bal of balances ?? []) {
      const amount = bal.amount_cents as number;
      const userA = bal.user_a as string;
      const userB = bal.user_b as string;

      if (userA === bob.id || userB === bob.id) {
        const fromUser = amount > 0 ? userA : userB;
        const toUser = amount > 0 ? userB : userA;

        if (fromUser === bob.id) {
          await bobClient.rpc("record_and_settle", {
            p_group_id: group.id,
            p_from_user_id: bob.id,
            p_to_user_id: toUser,
            p_amount_cents: Math.abs(amount),
          });
        }
      }
    }

    // Alice checks the "Pagamentos" tab
    await page.goto(`/app/groups/${group.id}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Pagamentos" }).click();
    await expect(
      page.getByText(/Confirmado/i).first(),
    ).toBeVisible({ timeout: 10000 });

    // Settle Carol's remaining debts
    const carolClient = await seed.authenticateAs(carol.id);

    const { data: remainingBalances } = await adminClient
      .from("balances")
      .select("*")
      .eq("group_id", group.id)
      .neq("amount_cents", 0);

    for (const bal of remainingBalances ?? []) {
      const amount = bal.amount_cents as number;
      const userA = bal.user_a as string;
      const userB = bal.user_b as string;

      if (userA === carol.id || userB === carol.id) {
        const fromUser = amount > 0 ? userA : userB;
        const toUser = amount > 0 ? userB : userA;

        if (fromUser === carol.id) {
          await carolClient.rpc("record_and_settle", {
            p_group_id: group.id,
            p_from_user_id: carol.id,
            p_to_user_id: toUser,
            p_amount_cents: Math.abs(amount),
          });
        }
      }
    }

    // Alice verifies "Tudo liquidado!" on the settlement tab
    await page.goto(`/app/groups/${group.id}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Acerto" }).click();
    await expect(page.getByText("Tudo liquidado!")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Nenhuma divida pendente no grupo")).toBeVisible();

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
    await expect(page.getByText("Voce deve")).toBeVisible();
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

    await expect(page.getByText("Voce recebe")).toBeVisible();
    await expect(page.getByText("R$ 50,00").first()).toBeVisible();
  });
});
