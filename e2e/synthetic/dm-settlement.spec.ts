import { test, expect } from "../fixtures";

test.describe("DM settlements", () => {
  test("shows the Pay button when the user owes money", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice DM Pagar" });
    const bob = await seed.createUser({ name: "Bob DM Pagar" });
    const dm = await seed.createDmGroup(alice, bob);

    // bob pays R$ 50 split equally, so alice owes bob R$ 25
    await seed.createExpense(dm.id, bob.id, [alice.id, bob.id], {
      title: "Lunch",
      totalCents: 5000,
      expenseType: "single_amount",
    });

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

  test("recording leaves balances untouched until the creditor confirms", async ({
    seed,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice DM RPC" });
    const bob = await seed.createUser({ name: "Bob DM RPC" });
    const dm = await seed.createDmGroup(alice, bob);

    // bob pays R$ 50 split equally, so alice owes bob R$ 25
    await seed.createExpense(dm.id, bob.id, [alice.id, bob.id], {
      title: "Lunch RPC",
      totalCents: 5000,
      expenseType: "single_amount",
    });

    const netFor = async (userId: string): Promise<number> => {
      const { data } = await adminClient
        .from("group_balances")
        .select("net_cents")
        .eq("group_id", dm.id)
        .eq("participant_id", userId);
      return data && data.length > 0 ? Number(data[0].net_cents) : 0;
    };

    expect(await netFor(alice.id)).toBe(-2500);
    expect(await netFor(bob.id)).toBe(2500);

    const aliceClient = await seed.authenticateAs(alice.id);
    const { error: recordError } = await aliceClient.rpc("record_settlement", {
      p_operation_id: crypto.randomUUID(),
      p_group_id: dm.id,
      p_to_user_id: bob.id,
      p_amount_cents: 2500,
    });
    expect(recordError).toBeNull();

    const { data: pending } = await adminClient
      .from("settlements")
      .select("id, status")
      .eq("group_id", dm.id)
      .eq("amount_cents", 2500);
    expect(pending).toHaveLength(1);
    expect(pending![0].status).toBe("pending");

    expect(await netFor(alice.id)).toBe(-2500);
    expect(await netFor(bob.id)).toBe(2500);

    const settlementId = pending![0].id as string;
    const bobClient = await seed.authenticateAs(bob.id);
    const { error: confirmError } = await bobClient.rpc("confirm_settlement", {
      p_settlement_id: settlementId,
    });
    expect(confirmError).toBeNull();

    expect(await netFor(alice.id)).toBe(0);
    expect(await netFor(bob.id)).toBe(0);

    const { error: voidError } = await bobClient.rpc("void_settlement", {
      p_settlement_id: settlementId,
    });
    expect(voidError).toBeNull();

    expect(await netFor(alice.id)).toBe(-2500);
    expect(await netFor(bob.id)).toBe(2500);

    const { data: events } = await adminClient
      .from("group_events")
      .select("kind")
      .eq("group_id", dm.id)
      .in("kind", ["settlement_recorded", "settlement_confirmed", "settlement_voided"]);
    expect((events ?? []).map((e) => e.kind).sort()).toEqual([
      "settlement_confirmed",
      "settlement_recorded",
      "settlement_voided",
    ]);
  });

  test("reconciles a committed payment after the first response is lost", async ({
    page,
    seed,
    adminClient,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Response Loss" });
    const bob = await seed.createUser({ name: "Bob Response Loss" });
    const dm = await seed.createDmGroup(alice, bob);

    await seed.createExpense(dm.id, bob.id, [alice.id, bob.id], {
      title: "Lost response",
      totalCents: 5000,
      expenseType: "single_amount",
    });

    let lostResponse = false;
    await page.route("**/rest/v1/rpc/record_settlement", async (route) => {
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
    await page.getByRole("button", { name: /^Pagar R\$\s*25,00$/i }).last().click();
    await page.getByRole("button", { name: /Já paguei/i }).click();

    // The response is lost after the write commits, so the optimistic entry
    // rolls back and the client reconciles from the server. The committed
    // settlement must survive exactly once.
    await expect
      .poll(
        async () => {
          const { data } = await adminClient
            .from("settlements")
            .select("id")
            .eq("group_id", dm.id);
          return data?.length ?? 0;
        },
        { timeout: 10000 },
      )
      .toBe(1);

    const { data: settlements, error: settlementsError } = await adminClient
      .from("settlements")
      .select("id, status")
      .eq("group_id", dm.id)
      .eq("from_user_id", alice.id)
      .eq("to_user_id", bob.id)
      .eq("amount_cents", 2500);
    expect(settlementsError).toBeNull();
    expect(settlements).toHaveLength(1);
    expect(settlements![0].status).toBe("pending");

    const { data: events, error: eventsError } = await adminClient
      .from("group_events")
      .select("id")
      .eq("group_id", dm.id)
      .eq("kind", "settlement_recorded");
    expect(eventsError).toBeNull();
    expect(events).toHaveLength(1);
  });

  test("shows the Charge button when the counterparty owes money", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice DM Cobrar" });
    const bob = await seed.createUser({ name: "Bob DM Cobrar" });
    const dm = await seed.createDmGroup(alice, bob);

    // alice pays R$ 30 split equally, so bob owes alice R$ 15
    await seed.createExpense(dm.id, alice.id, [alice.id, bob.id], {
      title: "Taxi",
      totalCents: 3000,
      expenseType: "single_amount",
    });

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

  test("hides the payment button once the debt is fully settled", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice DM Zero" });
    const bob = await seed.createUser({ name: "Bob DM Zero" });
    const dm = await seed.createDmGroup(alice, bob);

    // bob pays R$ 100, alice settles her R$ 50 and bob confirms, so the balance is zero
    await seed.createExpenseWithConfirmedSettlements(
      dm.id,
      bob.id,
      [alice.id, bob.id],
      { title: "Zero Expense", totalCents: 10000, expenseType: "single_amount" },
    );

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
