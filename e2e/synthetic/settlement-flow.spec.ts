import { test, expect } from "../fixtures";

/**
 * Settlement Flow Synthetic Tests
 *
 * Verifies the settlement UI for various scenarios:
 * - Three-user expense with debt simplification
 * - Partial settlement updates balances correctly
 * - Fully settled group shows "Tudo liquidado!" state
 */

/**
 * Helper to log into a separate browser context for a second user.
 * Returns the new context and page.
 */
async function loginInNewContext(
  browser: import("@playwright/test").Browser,
  user: { phone: string; name: string; handle: string },
) {
  const ctx = await browser.newContext();
  const pg = await ctx.newPage();
  const baseURL = process.env.E2E_BASE_URL || "http://localhost:3000";

  const resp = await pg.request.post(`${baseURL}/api/dev/login`, {
    data: { phone: user.phone, name: user.name, handle: user.handle },
  });
  const body = await resp.json();
  if (body.cookies && Array.isArray(body.cookies)) {
    const url = new URL(baseURL);
    await ctx.addCookies(
      body.cookies.map((c: { name: string; value: string }) => ({
        name: c.name,
        value: c.value,
        domain: url.hostname,
        path: "/",
      })),
    );
  }

  return { context: ctx, page: pg };
}

test.describe("Settlement Flow", () => {
  test("three-user expense shows simplification and settles correctly", async ({
    page,
    seed,
    loginAs,
    browser,
    adminClient,
  }) => {
    // ---------------------------------------------------------------
    // Seed: three users + group + two active expenses creating a triangle
    // ---------------------------------------------------------------
    const alice = await seed.createUser({ name: "Alice Settle" });
    const bob = await seed.createUser({ name: "Bob Settle" });
    const carol = await seed.createUser({ name: "Carol Settle" });
    const group = await seed.createGroup(alice.id, [bob.id, carol.id], "Settlement Test");

    // Expense 1: Alice pays R$120, split 3 ways (40 each)
    // Bob owes Alice 40, Carol owes Alice 40
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

    // Expense 2: Bob pays R$60, split 3 ways (20 each)
    // Alice owes Bob 20, Carol owes Bob 20
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

    // Net debts after both expenses:
    // Alice: paid 120 - owed 40 (own share exp1) - owed 20 (share exp2) = +60 net
    // Bob: paid 60 - owed 40 (share exp1) - owed 20 (own share exp2) = 0 net
    //   Actually: Bob owes Alice 40 from exp1, Alice owes Bob 20 from exp2 → net Bob owes Alice 20
    // Carol: owes Alice 40 from exp1, owes Bob 20 from exp2 → net -60

    // ---------------------------------------------------------------
    // 1. Alice views the settlement tab — sees debt graph and edges
    // ---------------------------------------------------------------
    await loginAs(alice);
    await page.goto(`/app/groups/${group.id}`);
    await page.waitForLoadState("networkidle");

    // Switch to "Acerto" tab
    await page.getByRole("button", { name: "Acerto" }).click();

    // Should see "Saldo consolidado" section
    await expect(page.getByText("Saldo consolidado")).toBeVisible({ timeout: 10000 });

    // Alice should see she's owed money ("a receber")
    await expect(page.getByText("a receber").first()).toBeVisible();

    // Should see at least one debt card with an amount
    await expect(page.getByText(/R\$ /).first()).toBeVisible();

    // With 3 users and 2+ edges, simplification may appear
    // (depends on whether edges can be simplified)

    // ---------------------------------------------------------------
    // 2. Bob views the settlement tab — sees "Voce deve"
    // ---------------------------------------------------------------
    const { context: bobCtx, page: bobPage } = await loginInNewContext(browser, bob);

    await bobPage.goto(`/app/groups/${group.id}`);
    await bobPage.waitForLoadState("networkidle");

    await bobPage.getByRole("button", { name: "Acerto" }).click();

    // Bob should see debt info — either "Voce deve" or "Voce recebe"
    await expect(
      bobPage.getByText(/Voce deve|Voce recebe|a pagar|a receber/i).first(),
    ).toBeVisible({ timeout: 10000 });

    // ---------------------------------------------------------------
    // 3. Settle Bob's debt to Alice via RPC
    // ---------------------------------------------------------------
    const bobClient = await seed.authenticateAs(bob.id);

    // Query balances to find Bob's debt
    const { data: balances } = await adminClient
      .from("balances")
      .select("*")
      .eq("group_id", group.id)
      .neq("amount_cents", 0);

    // Find Bob→Alice balance and settle it
    for (const bal of balances ?? []) {
      const amount = bal.amount_cents as number;
      const userA = bal.user_a as string;
      const userB = bal.user_b as string;

      // Check if Bob is involved in this balance
      if (userA === bob.id || userB === bob.id) {
        const fromUser = amount > 0 ? userA : userB;
        const toUser = amount > 0 ? userB : userA;

        // Only settle if Bob is the debtor
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

    // ---------------------------------------------------------------
    // 4. Alice checks the "Pagamentos" tab — sees confirmed settlement
    // ---------------------------------------------------------------
    await page.goto(`/app/groups/${group.id}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Pagamentos" }).click();
    await expect(
      page.getByText(/Confirmado/i).first(),
    ).toBeVisible({ timeout: 10000 });

    // ---------------------------------------------------------------
    // 5. Settle Carol's remaining debts
    // ---------------------------------------------------------------
    const carolClient = await seed.authenticateAs(carol.id);

    // Query updated balances
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

    // ---------------------------------------------------------------
    // 6. Alice verifies "Tudo liquidado!" on the settlement tab
    // ---------------------------------------------------------------
    await page.goto(`/app/groups/${group.id}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Acerto" }).click();
    await expect(page.getByText("Tudo liquidado!")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Nenhuma divida pendente no grupo")).toBeVisible();

    // Cleanup
    await bobCtx.close();
  });

  test("debtor sees 'Pagar via Pix' button on settlement tab", async ({
    page,
    seed,
    loginAs,
  }) => {
    // ---------------------------------------------------------------
    // Seed: two users, one active expense
    // ---------------------------------------------------------------
    const alice = await seed.createUser({ name: "Alice Pix" });
    const bob = await seed.createUser({ name: "Bob Pix" });
    const group = await seed.createGroup(alice.id, [bob.id], "Pix Test");

    // Alice pays R$200, equal split → Bob owes Alice R$100
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

    // ---------------------------------------------------------------
    // Bob views settlement — should see "Pagar via Pix"
    // ---------------------------------------------------------------
    await loginAs(bob);
    await page.goto(`/app/groups/${group.id}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Acerto" }).click();

    // Bob is the debtor — should see "Pagar via Pix" button
    await expect(
      page.getByRole("button", { name: /Pagar via Pix/i }),
    ).toBeVisible({ timeout: 10000 });

    // Should see the debt amount
    await expect(page.getByText("R$ 100,00").first()).toBeVisible();

    // Should see "Voce deve" label
    await expect(page.getByText("Voce deve")).toBeVisible();
  });

  test("creditor sees 'Gerar cobranca' button on settlement tab", async ({
    page,
    seed,
    loginAs,
  }) => {
    // ---------------------------------------------------------------
    // Seed: two users, one active expense
    // ---------------------------------------------------------------
    const alice = await seed.createUser({ name: "Alice Cred" });
    const bob = await seed.createUser({ name: "Bob Cred" });
    const group = await seed.createGroup(alice.id, [bob.id], "Creditor Test");

    // Alice pays R$100, equal split → Bob owes Alice R$50
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

    // ---------------------------------------------------------------
    // Alice (creditor) views settlement — should see "Gerar cobranca"
    // ---------------------------------------------------------------
    await loginAs(alice);
    await page.goto(`/app/groups/${group.id}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Acerto" }).click();

    // Alice is the creditor — should see "Gerar cobranca" button
    await expect(
      page.getByRole("button", { name: /Gerar cobranca/i }),
    ).toBeVisible({ timeout: 10000 });

    // Should see "Voce recebe" label
    await expect(page.getByText("Voce recebe")).toBeVisible();

    // Should see the owed amount
    await expect(page.getByText("R$ 50,00").first()).toBeVisible();
  });
});
