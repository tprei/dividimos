import { test, expect } from "../fixtures";

/**
 * Issue #495 checklist items 23-25: browser-driven proof that payer/guest
 * removal through the real two-stage form UI persists correctly through the real
 * database, and that a stale concurrent view cannot silently overwrite a
 * winning removal.
 */
test.describe("Expense payer cleanup (browser)", () => {
  test("removing Bob before finalization persists the exact reviewed payer set and the active ledger credits only that set (#495 item 23)", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice Cleanup" });
    const bob = await seed.createUser({ name: "Bob Cleanup" });
    const carol = await seed.createUser({ name: "Carol Cleanup" });

    const group = await seed.createGroup(
      alice.id,
      [bob.id, carol.id],
      "Cleanup Group 23",
    );

    await loginAs(alice, { navigate: false });
    await page.goto(
      `/app/bill/new?groupId=${group.id}&title=Cleanup%20Dinner&amount=10000`,
    );
    await page.waitForLoadState("networkidle");

    // Group members are auto-added; their names show inside the sheet.
    await page.getByRole("button", { name: "Participantes" }).click();
    await expect(page.getByText("Bob Cleanup").first()).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText("Carol Cleanup").first()).toBeVisible();

    // Remove Bob -- his row leaves the sheet rather than unchecking.
    await page.getByRole("button", { name: "Remover Bob Cleanup" }).click();
    await expect(page.getByText("Bob Cleanup")).not.toBeVisible();
    await page.getByRole("button", { name: "Concluir" }).click();

    await page.getByRole("button", { name: "Continuar" }).click();

    // payer: Alice pays the full reviewed (Bob-excluded) total.
    await expect(page.getByRole("heading", { name: "Quem pagou" })).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: /Alice/ }).click();
    await page.getByRole("button", { name: "Criar conta" }).click();

    await expect(page).toHaveURL(/\/app\/bill\/[0-9a-f-]{8,}/i, {
      timeout: 15000,
    });

    await expect
      .poll(
        async () => {
          const { data } = await adminClient
            .from("expenses")
            .select("id")
            .eq("group_id", group.id)
            .eq("status", "active");
          return data?.length ?? 0;
        },
        { timeout: 10000 },
      )
      .toBeGreaterThan(0);

    const { data: expenses } = await adminClient
      .from("expenses")
      .select("id, current_version_no")
      .eq("group_id", group.id)
      .eq("status", "active");
    const expense = expenses![0];

    const { data: versions } = await adminClient
      .from("expense_versions")
      .select("total_cents")
      .eq("expense_id", expense.id)
      .eq("version_no", expense.current_version_no as number);
    expect(versions).toHaveLength(1);
    expect(versions![0].total_cents).toBe(10000);

    const { data: participants } = await adminClient
      .from("expense_participants")
      .select("user_id, share_cents, paid_cents")
      .eq("expense_id", expense.id);

    const participantUserIds = (participants ?? []).map((p) => p.user_id).sort();
    expect(participantUserIds).toEqual([alice.id, carol.id].sort());
    expect(
      participants!.reduce((sum, p) => sum + (p.share_cents as number), 0),
    ).toBe(10000);

    const paidByUser = Object.fromEntries(
      (participants ?? []).map((p) => [p.user_id as string, p.paid_cents as number]),
    );
    expect(paidByUser[alice.id]).toBe(10000);
    expect(paidByUser[carol.id]).toBe(0);

    // The reviewed set excluded Bob entirely -- the active ledger must
    // credit only Alice/Carol, never touch Bob.
    const { data: balances } = await adminClient
      .from("group_balances")
      .select("kind, participant_id, net_cents")
      .eq("group_id", group.id);

    const netByParticipant = Object.fromEntries(
      (balances ?? []).map((b) => [b.participant_id as string, Number(b.net_cents)]),
    );
    expect(netByParticipant[alice.id]).toBe(5000);
    expect(netByParticipant[carol.id]).toBe(-5000);
    expect(netByParticipant[bob.id]).toBeUndefined();
  });

  test("a stale editor cannot overwrite a newer expense version (#495 item 23)", async ({
    seed,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice Stale" });
    const bob = await seed.createUser({ name: "Bob Stale" });
    const carol = await seed.createUser({ name: "Carol Stale" });
    const group = await seed.createGroup(alice.id, [bob.id, carol.id], "Stale Group");

    const expense = await seed.createExpense(
      group.id,
      alice.id,
      [alice.id, bob.id, carol.id],
      { title: "Split", totalCents: 9000 },
    );
    expect(expense.versionNo).toBe(1);

    const aliceClient = await seed.authenticateAs(alice.id);
    const occurredOn = new Date().toISOString().slice(0, 10);
    const withoutBob = {
      items: [],
      participants: [
        { kind: "user", userId: alice.id },
        { kind: "user", userId: carol.id },
      ],
      shares: [4500, 4500],
      payers: [{ participantIndex: 0, amountCents: 9000 }],
      itemAssignments: null,
    };

    // The winning edit removes Bob and advances the expense to version 2.
    const { error: winnerError } = await aliceClient.rpc("edit_expense", {
      p_expense_id: expense.id,
      p_expected_version_no: 1,
      p_occurred_on: occurredOn,
      p_title: "Split without Bob",
      p_merchant_name: null,
      p_expense_type: "single_amount",
      p_total_cents: 9000,
      p_service_fee_bps: 0,
      p_fixed_fee_cents: 0,
      p_payload: withoutBob,
    });
    expect(winnerError).toBeNull();

    // A second view loaded before the removal still believes version 1 is
    // current; its save must be rejected, not applied over the winner.
    const { error: staleError } = await aliceClient.rpc("edit_expense", {
      p_expense_id: expense.id,
      p_expected_version_no: 1,
      p_occurred_on: occurredOn,
      p_title: "Split with Bob",
      p_merchant_name: null,
      p_expense_type: "single_amount",
      p_total_cents: 9000,
      p_service_fee_bps: 0,
      p_fixed_fee_cents: 0,
      p_payload: {
        items: [],
        participants: [
          { kind: "user", userId: alice.id },
          { kind: "user", userId: bob.id },
          { kind: "user", userId: carol.id },
        ],
        shares: [3000, 3000, 3000],
        payers: [{ participantIndex: 0, amountCents: 9000 }],
        itemAssignments: null,
      },
    });
    expect(staleError).not.toBeNull();
    expect(staleError!.message).toContain("stale_version");

    const { data: rows } = await adminClient
      .from("expenses")
      .select("current_version_no")
      .eq("id", expense.id);
    expect(rows![0].current_version_no).toBe(2);

    const { data: participants } = await adminClient
      .from("expense_participants")
      .select("user_id")
      .eq("expense_id", expense.id);
    expect((participants ?? []).map((p) => p.user_id).sort()).toEqual(
      [alice.id, carol.id].sort(),
    );
  });

  test("removing a guest deletes guest/share references and preserves the valid registered payer when total is unchanged (#495 item 25)", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice Guest Cleanup" });
    const bob = await seed.createUser({ name: "Bob Guest Cleanup" });

    const group = await seed.createGroup(alice.id, [bob.id], "Guest Cleanup Group");

    await loginAs(alice, { navigate: false });
    await page.goto(
      `/app/bill/new?groupId=${group.id}&title=Guest%20Dinner&amount=9000`,
    );
    await page.waitForLoadState("networkidle");
    // Group members are auto-added; their names show inside the sheet.
    await page.getByRole("button", { name: "Participantes" }).click();
    await expect(page.getByText("Bob Guest Cleanup").first()).toBeVisible({
      timeout: 5000,
    });

    // Add a guest via the sheet's own UI.
    const guestName = "Temporary Guest";
    await page.getByRole("button", { name: /Adicionar convidado/i }).click();
    await page.getByPlaceholder("Nome do convidado").fill(guestName);
    await page.getByPlaceholder("Nome do convidado").press("Enter");
    await expect(page.getByText(guestName)).toBeVisible();

    // Same sheet visit: the guest is added and removed in one pass.
    await page.getByLabel(`Remover ${guestName}`).click();
    await expect(page.getByText(guestName)).not.toBeVisible();
    await page.getByRole("button", { name: "Concluir" }).click();

    // The form keeps the draft local: nothing is persisted before submit.
    const { data: beforeSubmit } = await adminClient
      .from("expenses")
      .select("id")
      .eq("group_id", group.id);
    expect(beforeSubmit ?? []).toHaveLength(0);

    await page.getByRole("button", { name: "Continuar" }).click();

    // Bob (a real registered user, unaffected by the guest removal) pays.
    await expect(page.getByRole("heading", { name: "Quem pagou" })).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: /Bob/ }).click();
    await page.getByRole("button", { name: "Criar conta" }).click();

    await expect(page).toHaveURL(/\/app\/bill\/[0-9a-f-]{8,}/i, { timeout: 15000 });

    await expect
      .poll(
        async () => {
          const { data } = await adminClient
            .from("expenses")
            .select("id")
            .eq("group_id", group.id);
          return data?.length ?? 0;
        },
        { timeout: 10000 },
      )
      .toBe(1);

    const { data: expenses } = await adminClient
      .from("expenses")
      .select("id, status, current_version_no")
      .eq("group_id", group.id);
    expect(expenses).toHaveLength(1);
    expect(expenses![0].status).toBe("active");
    const expenseId = expenses![0].id as string;

    const { data: versions } = await adminClient
      .from("expense_versions")
      .select("total_cents")
      .eq("expense_id", expenseId)
      .eq("version_no", expenses![0].current_version_no as number);
    expect(versions).toHaveLength(1);
    expect(versions![0].total_cents).toBe(9000);

    // The removed guest leaves no row behind, so it cannot retain a claim.
    const { data: guestsAfter } = await adminClient
      .from("guests")
      .select("id")
      .eq("expense_id", expenseId);
    expect(guestsAfter ?? []).toHaveLength(0);

    const { data: participants } = await adminClient
      .from("expense_participants")
      .select("kind, user_id, share_cents, paid_cents")
      .eq("expense_id", expenseId);

    expect((participants ?? []).every((p) => p.kind === "user")).toBe(true);
    expect((participants ?? []).map((p) => p.user_id).sort()).toEqual(
      [alice.id, bob.id].sort(),
    );
    expect(
      participants!.reduce((sum, p) => sum + (p.share_cents as number), 0),
    ).toBe(9000);

    const paidByUser = Object.fromEntries(
      (participants ?? []).map((p) => [p.user_id as string, p.paid_cents as number]),
    );
    expect(paidByUser[bob.id]).toBe(9000);
    expect(paidByUser[alice.id]).toBe(0);

    const { data: balances } = await adminClient
      .from("group_balances")
      .select("participant_id, net_cents")
      .eq("group_id", group.id);
    const netByParticipant = Object.fromEntries(
      (balances ?? []).map((b) => [b.participant_id as string, Number(b.net_cents)]),
    );
    expect(netByParticipant[bob.id]).toBe(4500);
    expect(netByParticipant[alice.id]).toBe(-4500);
  });
});
