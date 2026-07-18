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

  test("batch settlement RPC updates the balance and inserts a system message", async ({
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
    const { error: rpcError } = await aliceClient.rpc("record_settlements", {
      p_allocations: [{
        group_id: dm.id,
        from_user_id: alice.id,
        to_user_id: bob.id,
        amount_cents: 2500,
      }],
      p_operation_id: crypto.randomUUID(),
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

  test("reconciles a committed payment after the first batch response is lost", async ({
    page,
    seed,
    adminClient,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice DM Response Loss" });
    const bob = await seed.createUser({ name: "Bob DM Response Loss" });
    const dm = await seed.createDmGroup(alice, bob);

    await seed.createActiveExpense(
      dm.id,
      bob.id,
      [alice.id, bob.id],
      {
        title: "Resposta perdida",
        totalAmount: 5000,
        expenseType: "single_amount",
        payers: { [bob.id]: 5000 },
      },
    );

    let lostResponse = false;
    await page.route("**/rest/v1/rpc/record_settlements", async (route) => {
      if (lostResponse) {
        await route.continue();
        return;
      }

      lostResponse = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.fulfill({
        body: JSON.stringify({ message: "simulated response loss" }),
        contentType: "application/json",
        status: 503,
      });
    });

    await loginAs(alice);
    await page.goto(`/app/conversations/${bob.id}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /^Pagar R\$\s*25,00$/i }).click();
    await page.getByRole("button", { name: /^Pagar R\$\s*25,00$/i }).last.click();
    await page.getByRole("button", { name: /Já paguei/i }).click();

    await expect(
      page.getByRole("button", { name: "Verificar pagamento" }),
    ).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: "Verificar pagamento" }).click();
    await expect(page.getByText("Pagamento registrado!")).toBeVisible({
      timeout: 10000,
    });

    const { data: settlements, error: settlementsError } = await adminClient
      .from("settlements")
      .select("id")
      .eq("group_id", dm.id)
      .eq("from_user_id", alice.id)
      .eq("to_user_id", bob.id)
      .eq("amount_cents", 2500);
    expect(settlementsError).toBeNull();
    expect(settlements).toHaveLength(1);

    const { data: messages, error: messagesError } = await adminClient
      .from("chat_messages")
      .select("id")
      .eq("group_id", dm.id)
      .eq("message_type", "system_settlement");
    expect(messagesError).toBeNull();
    expect(messages).toHaveLength(1);
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
    await aliceClient.rpc("record_settlements", {
      p_allocations: [{
        group_id: dm.id,
        from_user_id: alice.id,
        to_user_id: bob.id,
        amount_cents: 5000,
      }],
      p_operation_id: crypto.randomUUID(),
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
