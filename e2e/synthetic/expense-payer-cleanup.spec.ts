import { test, expect, loginInContext } from "../fixtures";

/**
 * Issue #495 checklist items 23-25: browser-driven proof that payer/guest
 * removal through the real wizard UI persists correctly through the real
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
      `/app/bill/new?groupId=${group.id}&title=Jantar%20Cleanup&amount=10000`,
    );
    await page.waitForLoadState("networkidle");

    // participants step: Bob and Carol auto-loaded (checked) from the group.
    await expect(page.getByText("Bob Cleanup").first()).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText("Carol Cleanup").first()).toBeVisible();

    // Remove Bob -- clicking his already-checked row toggles him off.
    await page.getByRole("button", { name: "Bob Cleanup" }).click();
    // The row re-renders unchecked rather than disappearing; assert via the
    // checkbox state instead of visibility, which is the authoritative signal.
    const bobRow = page.getByRole("button", { name: "Bob Cleanup" });
    await expect(bobRow.locator('input[type="checkbox"]')).not.toBeChecked();

    await page
      .getByRole("button", { name: /Próximo|Continuar/i })
      .first()
      .click();

    // amount-split step -> equal split between Alice and Carol only.
    await page
      .getByRole("button", { name: /Próximo|Continuar/i })
      .first()
      .click();

    // payer step: Alice pays the full reviewed (Bob-excluded) total.
    await expect(page.getByText(/quem pagou/i)).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: alice.name }).click();
    await page
      .getByRole("button", { name: /Próximo|Continuar/i })
      .first()
      .click();

    // summary -> finalize.
    await page
      .getByRole("button", { name: /Gerar cobranças Pix/i })
      .click();

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
      .select("id, total_amount")
      .eq("group_id", group.id)
      .eq("status", "active");
    const expense = expenses![0];
    expect(expense.total_amount).toBe(10000);

    const { data: shares } = await adminClient
      .from("expense_shares")
      .select("user_id, share_amount_cents")
      .eq("expense_id", expense.id);
    const shareUserIds = (shares ?? []).map((s) => s.user_id).sort();
    expect(shareUserIds).toEqual([alice.id, carol.id].sort());
    expect(shares!.reduce((sum, s) => sum + s.share_amount_cents, 0)).toBe(10000);

    const { data: payers } = await adminClient
      .from("expense_payers")
      .select("user_id, amount_cents")
      .eq("expense_id", expense.id);
    expect(payers).toEqual([{ user_id: alice.id, amount_cents: 10000 }]);

    // The reviewed set excluded Bob entirely -- the active ledger must
    // credit only Alice/Carol, never touch Bob.
    const [userA, userB] = [alice.id, carol.id].sort();
    const { data: balanceRow } = await adminClient
      .from("balances")
      .select("user_a, user_b, amount_cents")
      .eq("group_id", group.id)
      .eq("user_a", userA)
      .eq("user_b", userB)
      .maybeSingle();
    expect(balanceRow).not.toBeNull();
    expect(Math.abs(balanceRow!.amount_cents)).toBe(5000);

    const { data: bobBalances } = await adminClient
      .from("balances")
      .select("id")
      .eq("group_id", group.id)
      .or(`user_a.eq.${bob.id},user_b.eq.${bob.id}`);
    expect(bobBalances ?? []).toHaveLength(0);
  });

  test("a stale second view cannot save/finalize after the winning removal (#495 item 23)", async ({
    page,
    seed,
    loginAs,
    adminClient,
    browser,
  }) => {
    const alice = await seed.createUser({ name: "Alice Stale" });
    const bob = await seed.createUser({ name: "Bob Stale" });
    const carol = await seed.createUser({ name: "Carol Stale" });

    const group = await seed.createGroup(
      alice.id,
      [bob.id, carol.id],
      "Cleanup Group Stale",
    );

    // Context 1: Alice creates the draft (participants step save includes
    // Bob), capturing its id before removing him.
    await loginAs(alice, { navigate: false });
    await page.goto(
      `/app/bill/new?groupId=${group.id}&title=Jantar%20Stale&amount=9000`,
    );
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Bob Stale").first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Carol Stale").first()).toBeVisible();

    await page
      .getByRole("button", { name: /Próximo|Continuar/i })
      .first()
      .click();

    await expect
      .poll(
        async () => {
          const { data } = await adminClient
            .from("expenses")
            .select("id")
            .eq("group_id", group.id)
            .eq("status", "draft");
          return data?.length ?? 0;
        },
        { timeout: 10000 },
      )
      .toBeGreaterThan(0);

    const { data: draftRows } = await adminClient
      .from("expenses")
      .select("id")
      .eq("group_id", group.id)
      .eq("status", "draft");
    const draftId = draftRows![0].id as string;

    // Context 2: a second Alice session (e.g. another device/tab) opens the
    // same draft -- still includes Bob, at the revision as of this load.
    const staleContext = await browser.newContext();
    const stalePage = await staleContext.newPage();
    await loginInContext(staleContext, stalePage, alice);
    await stalePage.goto(`/app/bill/new?draft=${draftId}`);
    await stalePage.waitForLoadState("networkidle");

    // Context 1: goes back to participants (the prior save already
    // advanced its local step to amount-split), removes Bob, then drives
    // the draft all the way to finalization -- this wins and advances the
    // revision past what context 2 loaded.
    await page.getByRole("button", { name: /Voltar/i }).click();
    await expect(page.getByText("Bob Stale").first()).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: "Bob Stale" }).click();
    const bobRow = page.getByRole("button", { name: "Bob Stale" });
    await expect(bobRow.locator('input[type="checkbox"]')).not.toBeChecked();

    await page
      .getByRole("button", { name: /Próximo|Continuar/i })
      .first()
      .click();
    await page
      .getByRole("button", { name: /Próximo|Continuar/i })
      .first()
      .click();
    await expect(page.getByText(/quem pagou/i)).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: alice.name }).click();
    await page
      .getByRole("button", { name: /Próximo|Continuar/i })
      .first()
      .click();
    await page.getByRole("button", { name: /Gerar cobranças Pix/i }).click();

    await expect(page).toHaveURL(/\/app\/bill\/[0-9a-f-]{8,}/i, { timeout: 15000 });

    await expect
      .poll(
        async () => {
          const { data } = await adminClient
            .from("expenses")
            .select("status")
            .eq("id", draftId)
            .single();
          return data?.status ?? null;
        },
        { timeout: 10000 },
      )
      .toBe("active");

    // Context 2 (stale, still on whatever step it landed on after loading
    // the now-superseded revision) attempts to proceed -- its save must be
    // rejected, not silently applied over the winning removal.
    await stalePage
      .getByRole("button", { name: /Próximo|Continuar/i })
      .first()
      .click();

    await expect(
      stalePage.getByText(/Este rascunho foi alterado|não foi possível/i),
    ).toBeVisible({ timeout: 10000 });

    // The stale attempt must not have navigated context 2 to any bill
    // detail/finalized URL of its own making, nor mutated the winning graph.
    await expect(stalePage).not.toHaveURL(/\/app\/bill\/(?!new)[0-9a-f-]{8,}/i);

    const { data: finalShares } = await adminClient
      .from("expense_shares")
      .select("user_id")
      .eq("expense_id", draftId);
    const finalUserIds = (finalShares ?? []).map((s) => s.user_id).sort();
    expect(finalUserIds).toEqual([alice.id, carol.id].sort());

    await staleContext.close();
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
      `/app/bill/new?groupId=${group.id}&title=Jantar%20Convidado&amount=9000`,
    );
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Bob Guest Cleanup").first()).toBeVisible({
      timeout: 5000,
    });

    // Add a guest via the wizard's own UI.
    const guestName = "Convidado Temporario";
    await page.getByRole("button", { name: /Adicionar convidado/i }).click();
    await page.getByPlaceholder("Nome do convidado").fill(guestName);
    await page.getByPlaceholder("Nome do convidado").press("Enter");
    await expect(page.getByText(guestName)).toBeVisible();

    // Save with the guest included (participants step -> amount-split).
    await page
      .getByRole("button", { name: /Próximo|Continuar/i })
      .first()
      .click();

    await expect
      .poll(
        async () => {
          const { data } = await adminClient
            .from("expenses")
            .select("id")
            .eq("group_id", group.id)
            .eq("status", "draft");
          return data?.length ?? 0;
        },
        { timeout: 10000 },
      )
      .toBeGreaterThan(0);

    const { data: draftBefore } = await adminClient
      .from("expenses")
      .select("id")
      .eq("group_id", group.id)
      .eq("status", "draft");
    const expenseId = draftBefore![0].id as string;

    const { data: guestsBefore } = await adminClient
      .from("expense_guests")
      .select("id")
      .eq("expense_id", expenseId);
    expect(guestsBefore ?? []).toHaveLength(1);

    // Go back to participants and remove the guest.
    await page.getByRole("button", { name: /Voltar/i }).click();
    await expect(page.getByText(guestName)).toBeVisible();
    await page.getByLabel(`Remover ${guestName}`).click();
    await expect(page.getByText(guestName)).not.toBeVisible();

    await page
      .getByRole("button", { name: /Próximo|Continuar/i })
      .first()
      .click();
    await page
      .getByRole("button", { name: /Próximo|Continuar/i })
      .first()
      .click();

    // Bob (a real registered user, unaffected by the guest removal) pays.
    await expect(page.getByText(/quem pagou/i)).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: bob.name }).click();
    await page
      .getByRole("button", { name: /Próximo|Continuar/i })
      .first()
      .click();
    await page.getByRole("button", { name: /Gerar cobranças Pix/i }).click();

    await expect(page).toHaveURL(/\/app\/bill\/[0-9a-f-]{8,}/i, { timeout: 15000 });

    await expect
      .poll(
        async () => {
          const { data } = await adminClient
            .from("expenses")
            .select("status, total_amount")
            .eq("id", expenseId)
            .single();
          return data?.status ?? null;
        },
        { timeout: 10000 },
      )
      .toBe("active");

    const { data: finalExpense } = await adminClient
      .from("expenses")
      .select("total_amount")
      .eq("id", expenseId)
      .single();
    expect(finalExpense!.total_amount).toBe(9000);

    const { data: guestsAfter } = await adminClient
      .from("expense_guests")
      .select("id")
      .eq("expense_id", expenseId);
    expect(guestsAfter ?? []).toHaveLength(0);

    const { data: guestSharesAfter } = await adminClient
      .from("expense_guest_shares")
      .select("id")
      .eq("expense_id", expenseId);
    expect(guestSharesAfter ?? []).toHaveLength(0);

    const { data: sharesAfter } = await adminClient
      .from("expense_shares")
      .select("user_id, share_amount_cents")
      .eq("expense_id", expenseId);
    const shareUserIds = (sharesAfter ?? []).map((s) => s.user_id).sort();
    expect(shareUserIds).toEqual([alice.id, bob.id].sort());
    expect(sharesAfter!.reduce((sum, s) => sum + s.share_amount_cents, 0)).toBe(9000);

    const { data: payersAfter } = await adminClient
      .from("expense_payers")
      .select("user_id, amount_cents")
      .eq("expense_id", expenseId);
    expect(payersAfter).toEqual([{ user_id: bob.id, amount_cents: 9000 }]);
  });

  test("a protected-claim fixture omits the removal control, survives save/reload, and finalizes with the canonical graph complete (#495 item 24)", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice Protected" });
    const carol = await seed.createUser({ name: "Carol Protected" });
    const group = await seed.createGroup(alice.id, [], "Protected Claim Group");

    // Seed a draft directly through the real save RPC: Alice + an
    // unclaimed guest, no payer yet (so the edit-load jumps only as far
    // as amount-split, not straight to payer -- see page.tsx's
    // load.payers.length gate).
    const aliceClient = await seed.authenticateAs(alice.id);
    const { data: saved, error: saveError } = await aliceClient.rpc("save_expense_draft_graph", {
      p_expense: {
        group_id: group.id,
        title: "Jantar com convidada",
        merchant_name: null,
        expense_type: "single_amount",
        total_amount: 6000,
        service_fee_basis_points: 0,
        fixed_fees: 0,
      },
      p_items: [],
      p_shares: [{ user_id: alice.id, share_amount_cents: 3000 }],
      p_payers: [],
      p_guests: [{ local_id: "g1", display_name: "Futura Carol" }],
      p_guest_shares: [{ local_id: "g1", share_amount_cents: 3000 }],
      p_participant_order: [],
      p_expected_graph_revision: 0,
      p_save_operation_id: crypto.randomUUID(),
    });
    expect(saveError).toBeNull();
    const draftId = (saved as { id: string }).id;

    const { data: guestRow } = await adminClient
      .from("expense_guests")
      .select("claim_token")
      .eq("expense_id", draftId)
      .single();

    // Carol claims the guest spot while the expense is still a draft --
    // she becomes a protected claimant: a real participant whose removal
    // the server guard (claimed_guest_not_participant, #495 item 2) rejects.
    const carolClient = await seed.authenticateAs(carol.id);
    const { error: claimError } = await carolClient.rpc("claim_guest_spot", {
      p_claim_token: (guestRow as { claim_token: string }).claim_token,
    });
    expect(claimError).toBeNull();

    // Alice opens the draft for editing. Shares exist but no payer yet, so
    // the load lands on amount-split; go back to see the participants row.
    await loginAs(alice, { navigate: false });
    await page.goto(`/app/bill/new?draft=${draftId}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /Voltar/i }).click();

    // The removal control is omitted: Carol shows as protected, with no
    // "Remover Carol Protected" control anywhere on the page.
    await expect(page.getByText("Carol Protected").first()).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText("Protegido")).toBeVisible();
    await expect(
      page.getByLabel(`Remover ${carol.name}`),
    ).not.toBeVisible();

    // Save/reload survival: proceed through the wizard without touching
    // Carol. Each step re-saves the draft; the protected claimant must
    // still be present afterward or the server would reject the save
    // (claimed_guest_not_participant) and finalization would never reach
    // "Gerar cobranças Pix".
    await page
      .getByRole("button", { name: /Próximo|Continuar/i })
      .first()
      .click();
    await page
      .getByRole("button", { name: /Próximo|Continuar/i })
      .first()
      .click();
    await expect(page.getByText(/quem pagou/i)).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: alice.name }).click();
    await page
      .getByRole("button", { name: /Próximo|Continuar/i })
      .first()
      .click();

    // Finalizes only once the canonical graph (Alice + Carol) remains
    // complete -- activation succeeds.
    await page.getByRole("button", { name: /Gerar cobranças Pix/i }).click();
    await expect(page).toHaveURL(/\/app\/bill\/[0-9a-f-]{8,}/i, { timeout: 15000 });

    await expect
      .poll(
        async () => {
          const { data } = await adminClient
            .from("expenses")
            .select("status")
            .eq("id", draftId)
            .single();
          return data?.status ?? null;
        },
        { timeout: 10000 },
      )
      .toBe("active");

    const { data: finalShares } = await adminClient
      .from("expense_shares")
      .select("user_id, share_amount_cents")
      .eq("expense_id", draftId);
    const finalUserIds = (finalShares ?? []).map((s) => s.user_id).sort();
    expect(finalUserIds).toEqual([alice.id, carol.id].sort());
    expect(finalShares!.reduce((sum, s) => sum + s.share_amount_cents, 0)).toBe(6000);

    const { data: guestAfter } = await adminClient
      .from("expense_guests")
      .select("claimed_by")
      .eq("expense_id", draftId)
      .single();
    expect(guestAfter!.claimed_by).toBe(carol.id);
  });
});
