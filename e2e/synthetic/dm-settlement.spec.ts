import { test, expect } from "../fixtures";

test.describe("DM settlements", () => {
  test("botão Pagar visível quando usuário deve dinheiro", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice DM Pagar" });
    const bob = await seed.createUser({ name: "Bob DM Pagar" });
    const dm = await seed.createDmGroup(alice, bob);

    // bob paga R$ 50, dividido igualmente → alice deve R$ 25 a bob
    await seed.createActiveExpense(
      dm.id,
      bob.id,
      [alice.id, bob.id],
      {
        title: "Almoço",
        totalAmount: 5000,
        expenseType: "single_amount",
        payers: { [bob.id]: 5000 },
      },
    );

    await loginAs(alice);
    await page.goto(`/app/conversations/${bob.id}`);
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByRole("button", { name: /Pagar.*R\$\s*25/i }),
    ).toBeVisible({ timeout: 10000 });

    await expect(
      page.getByRole("button", { name: /Cobrar.*R\$/i }),
    ).not.toBeVisible();
  });

  test("RPC record_and_settle atualiza saldo e insere mensagem de sistema", async ({
    seed,
    adminClient,
    page,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice DM RPC" });
    const bob = await seed.createUser({ name: "Bob DM RPC" });
    const dm = await seed.createDmGroup(alice, bob);

    // bob paga R$ 50, split igualitário → alice deve R$ 25 a bob
    await seed.createActiveExpense(
      dm.id,
      bob.id,
      [alice.id, bob.id],
      {
        title: "Almoço RPC",
        totalAmount: 5000,
        expenseType: "single_amount",
        payers: { [bob.id]: 5000 },
      },
    );

    const aliceClient = await seed.authenticateAs(alice.id);
    const { error: rpcError } = await aliceClient.rpc("record_and_settle", {
      p_group_id: dm.id,
      p_from_user_id: alice.id,
      p_to_user_id: bob.id,
      p_amount_cents: 2500,
    });
    expect(rpcError).toBeNull();

    const { data: settlements } = await adminClient
      .from("settlements")
      .select("*")
      .eq("group_id", dm.id)
      .eq("amount_cents", 2500);
    expect(settlements).toHaveLength(1);
    expect(settlements![0].status).toBe("confirmed");

    const { data: balances } = await adminClient
      .from("balances")
      .select("*")
      .eq("group_id", dm.id);
    const totalNet = (balances ?? []).reduce(
      (sum: number, b: { amount_cents: number }) => sum + b.amount_cents,
      0,
    );
    expect(totalNet).toBe(0);

    const { data: messages } = await adminClient
      .from("chat_messages")
      .select("*")
      .eq("group_id", dm.id)
      .eq("message_type", "system_settlement");
    expect((messages ?? []).length).toBeGreaterThanOrEqual(1);

    await loginAs(alice);
    await page.goto(`/app/conversations/${bob.id}`);
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByText(/R\$\s*25,00/).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("botão Cobrar visível quando contraparte deve dinheiro", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice DM Cobrar" });
    const bob = await seed.createUser({ name: "Bob DM Cobrar" });
    const dm = await seed.createDmGroup(alice, bob);

    // alice paga R$ 30, dividido igualmente → bob deve R$ 15 a alice
    await seed.createActiveExpense(
      dm.id,
      alice.id,
      [alice.id, bob.id],
      {
        title: "Taxi",
        totalAmount: 3000,
        expenseType: "single_amount",
        payers: { [alice.id]: 3000 },
      },
    );

    await loginAs(alice);
    await page.goto(`/app/conversations/${bob.id}`);
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByRole("button", { name: /Cobrar.*R\$\s*15/i }),
    ).toBeVisible({ timeout: 10000 });

    await expect(
      page.getByRole("button", { name: /Pagar.*R\$/i }),
    ).not.toBeVisible();
  });

  test("botão de pagamento desaparece após quitação total", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice DM Zero" });
    const bob = await seed.createUser({ name: "Bob DM Zero" });
    const dm = await seed.createDmGroup(alice, bob);

    // bob paga R$ 100, dividido igualmente → alice deve R$ 50 a bob
    await seed.createActiveExpense(
      dm.id,
      bob.id,
      [alice.id, bob.id],
      {
        title: "Despesa Zero",
        totalAmount: 10000,
        expenseType: "single_amount",
        payers: { [bob.id]: 10000 },
      },
    );

    const aliceClient = await seed.authenticateAs(alice.id);
    await aliceClient.rpc("record_and_settle", {
      p_group_id: dm.id,
      p_from_user_id: alice.id,
      p_to_user_id: bob.id,
      p_amount_cents: 5000,
    });

    await loginAs(alice);
    await page.goto(`/app/conversations/${bob.id}`);
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByRole("button", { name: /Pagar.*R\$/i }),
    ).not.toBeVisible({ timeout: 10000 });

    await expect(
      page.getByRole("button", { name: /Cobrar.*R\$/i }),
    ).not.toBeVisible();
  });
});
