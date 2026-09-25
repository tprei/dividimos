import { test, expect } from "../fixtures";
import { transfersFromBalances } from "../../src/lib/ledger/transfers";
import type { BalanceRow } from "../../src/types/ledger";

test.describe("Settlement Flow", () => {
  test("three-user expense shows simplification and settles correctly", async ({
    page,
    seed,
    loginAs,
    newSession,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice Settle" });
    const bob = await seed.createUser({ name: "Bob Settle" });
    const carol = await seed.createUser({ name: "Carol Settle" });
    const group = await seed.createGroup(alice.id, [bob.id, carol.id], "Settlement Test");

    await seed.createExpense(group.id, alice.id, [alice.id, bob.id, carol.id], {
      title: "Settlement Lunch",
      totalCents: 12000,
      expenseType: "single_amount",
    });

    await seed.createExpense(group.id, bob.id, [alice.id, bob.id, carol.id], {
      title: "Settlement Coffee",
      totalCents: 6000,
      expenseType: "single_amount",
    });

    // Alice views the group balances; the ledger group page renders them inline
    await loginAs(alice);
    await page.goto(`/app/groups/${group.id}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("radio", { name: "Saldos" })).toBeChecked({ timeout: 10000 });
    await expect(page.getByRole("region", { name: "Saldos", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Quem paga quem" }).getByRole("button", { name: /Cobrar/ })).toBeVisible();
    await expect(page.getByText(/R\$\s/).first()).toBeVisible();

    // A viewer with zero balance still sees the group's outstanding transfers.
    const { context: bobCtx, page: bobPage } = await newSession(bob);

    await bobPage.goto(`/app/groups/${group.id}`);
    await bobPage.waitForLoadState("networkidle");

    const bobTransfers = bobPage.getByRole("region", { name: "Quem paga quem" });
    await expect(bobTransfers).toBeVisible({ timeout: 10000 });
    await expect(bobTransfers.getByRole("button")).toHaveCount(0);
    await expect(bobPage.getByRole("status")).toHaveCount(0);

    // Carol paid nothing, so she owes her whole share
    const { context: carolCtx, page: carolPage } = await newSession(carol);

    await carolPage.goto(`/app/groups/${group.id}`);
    await carolPage.waitForLoadState("networkidle");

    await expect(carolPage.getByRole("region", { name: "Quem paga quem" }).getByRole("button", { name: /^Pagar/ })).toBeVisible({ timeout: 10000 });

    // Settle all remaining debts. With the normalized ledger the payable
    // edges are derived from the group's net balances, so the debtor could
    // be anyone. Recording each edge applies it to the balances immediately.
    const aliceClient = await seed.authenticateAs(alice.id);
    const bobClient = await seed.authenticateAs(bob.id);
    const carolClient = await seed.authenticateAs(carol.id);
    const clientFor: Record<string, typeof aliceClient> = {
      [alice.id]: aliceClient,
      [bob.id]: bobClient,
      [carol.id]: carolClient,
    };

    const { data: balanceRows } = await adminClient
      .from("group_balances")
      .select("kind, participant_id, net_cents")
      .eq("group_id", group.id);

    const balances: BalanceRow[] = (balanceRows ?? []).map((row) => ({
      kind: row.kind as BalanceRow["kind"],
      participantId: row.participant_id as string,
      netCents: Number(row.net_cents),
    }));

    const transfers = transfersFromBalances(balances);
    expect(transfers.length).toBeGreaterThan(0);

    for (const transfer of transfers) {
      const operationId = crypto.randomUUID();
      const { error: recordError } = await clientFor[transfer.fromId].rpc(
        "record_settlement",
        {
          p_operation_id: operationId,
          p_group_id: group.id,
          p_from_user_id: transfer.fromId,
          p_to_user_id: transfer.toId,
          p_amount_cents: transfer.amountCents,
        },
      );
      expect(recordError).toBeNull();

      const { data: recorded } = await adminClient
        .from("settlements")
        .select("id")
        .eq("operation_id", operationId);
      expect(recorded).toHaveLength(1);
    }

    const { data: afterSettlement } = await adminClient
      .from("group_balances")
      .select("participant_id")
      .eq("group_id", group.id);
    expect(afterSettlement ?? []).toHaveLength(0);

    // A fresh session loads the settled group. The service worker serves
    // /app/** navigations cache-first, so revisiting the same URL in an
    // existing context would render the already-cached shell.
    const { context: settledCtx, page: settledPage } = await newSession(alice);

    await settledPage.goto(`/app/groups/${group.id}`);
    await settledPage.waitForLoadState("networkidle");

    await expect(settledPage.getByRole("status")).toBeVisible({ timeout: 10000 });
    await expect(settledPage.getByRole("region", { name: "Quem paga quem" })).toHaveCount(0);

    await settledCtx.close();
    await bobCtx.close();
    await carolCtx.close();
  });

  test("debtor sees the pay row on the group balances", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Pix" });
    const bob = await seed.createUser({ name: "Bob Pix" });
    const group = await seed.createGroup(alice.id, [bob.id], "Pix Test");

    await seed.createExpense(group.id, alice.id, [alice.id, bob.id], {
      title: "Pix Dinner",
      totalCents: 20000,
      expenseType: "single_amount",
    });

    await loginAs(bob);
    await page.goto(`/app/groups/${group.id}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("radio", { name: "Saldos" })).toBeChecked({ timeout: 10000 });

    await expect(
      page.getByRole("region", { name: "Quem paga quem" }).getByRole("button", { name: /^Pagar/i }),
    ).toBeVisible({ timeout: 10000 });

    await expect(page.getByText("R$ 100,00").first()).toBeVisible();
  });

  test("creditor sees a charge row and can record the receipt", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Cred" });
    const bob = await seed.createUser({ name: "Bob Cred" });
    const group = await seed.createGroup(alice.id, [bob.id], "Creditor Test");

    await seed.createExpense(group.id, alice.id, [alice.id, bob.id], {
      title: "Creditor Dinner",
      totalCents: 10000,
      expenseType: "single_amount",
    });

    await loginAs(alice);
    await page.goto(`/app/groups/${group.id}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("radio", { name: "Saldos" })).toBeChecked({ timeout: 10000 });
    const transfers = page.getByRole("region", { name: "Quem paga quem" });
    await expect(transfers.getByRole("button", { name: /Cobrar/ })).toBeVisible();
    await expect(page.getByText("R$ 50,00").first()).toBeVisible();

    await transfers.getByRole("button", { name: /Cobrar/ }).click();
    await page.getByRole("button", { name: "Registrar pagamento" }).click();

    await expect(page.getByRole("status")).toBeVisible({ timeout: 15000 });
  });
});
