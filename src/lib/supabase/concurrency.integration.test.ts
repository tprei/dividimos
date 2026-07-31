/**
 * Suite 5 — Concurrency integration tests
 *
 * Validates that concurrent operations on balances produce correct results.
 * The batch settlement RPC locks groups in a stable order and records one
 * immutable operation. These tests confirm it remains correct under load.
 *
 * Tests cover:
 *  5.1 — Concurrent expense activation + settlement on the same user pair
 *  5.2 — Concurrent settlements on the same user pair
 *  5.3 — Interleaved expense creates + settlements across multiple pairs
 */

import { describe, it, expect, beforeAll } from "vitest";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  type TestUser,
  createTestUsers,
  createTestGroupWithMembers,
  createAndActivateExpense,
  settleDebt,
  getBalanceBetween,
  authenticateAs,
} from "@/test/integration-helpers";
import { forceLockContentionRace } from "@/test/db-race-barrier";

/**
 * Issue #477: creates a draft expense through save_expense_draft_graph --
 * the only path allowed to insert a new expenses row (the guard's expenses
 * INSERT branch needs a 'new'-sourced token only this RPC can open, and
 * service_role has no grant on begin_expense_graph_direct_mutation either).
 */
async function saveDraft(
  creator: TestUser,
  groupId: string,
  fields: {
    title: string;
    totalAmount: number;
    shares: { userId: string; amount: number }[];
    payers: { userId: string; amount: number }[];
  },
): Promise<{ id: string; graphRevision: number }> {
  const client = authenticateAs(creator);
  const { data, error } = await client.rpc("save_expense_draft_graph", {
    p_expense: {
      group_id: groupId,
      title: fields.title,
      merchant_name: null,
      expense_type: "single_amount",
      total_amount: fields.totalAmount,
      service_fee_basis_points: 0,
      fixed_fees: 0,
    },
    p_items: [],
    p_shares: fields.shares.map((s) => ({ user_id: s.userId, share_amount_cents: s.amount })),
    p_payers: fields.payers.map((p) => ({ user_id: p.userId, amount_cents: p.amount })),
    p_guests: [],
    p_guest_shares: [],
    p_participant_order: [],
    p_expected_graph_revision: 0,
    p_save_operation_id: crypto.randomUUID(),
  });
  if (error || !data) {
    throw new Error(`Failed to save draft: ${error?.message}`);
  }
  const result = data as { id: string; graph_revision: number };
  return { id: result.id, graphRevision: result.graph_revision };
}
describe.skipIf(!isIntegrationTestReady)(
  "Concurrency — race conditions on balances",
  () => {
    let alice: TestUser;
    let bob: TestUser;
    let carol: TestUser;
    let dave: TestUser;
    let groupId: string;

    beforeAll(async () => {
      [alice, bob, carol, dave] = await createTestUsers(4, {
        name: "Concurrency",
      });
      const group = await createTestGroupWithMembers(alice, [bob, carol, dave]);
      groupId = group.id;
    });

    // -----------------------------------------------------------------------
    // 5.1 — Concurrent expense activation + settlement on the same pair
    // -----------------------------------------------------------------------

    describe("5.1 — concurrent expense activation and settlement on same pair", () => {
      it("expense activation and settlement execute atomically without corrupting balances", async () => {
        // Create an expense: Alice pays 10000, split equally with Bob (each 5000)
        // This gives Bob a debt of 5000 to Alice.
        await createAndActivateExpense({
          creator: alice,
          groupId,
          shares: [
            { userId: alice.id, amount: 5000 },
            { userId: bob.id, amount: 5000 },
          ],
          payers: [{ userId: alice.id, amount: 10000 }],
          title: "5.1 setup expense",
        });

        const balanceAfterSetup = await getBalanceBetween(
          groupId,
          bob.id,
          alice.id,
        );
        expect(balanceAfterSetup).toBe(5000); // Bob owes Alice 5000

        // Now fire a new expense activation AND a settlement concurrently.
        // New expense: Alice pays 6000, split equally (Alice 3000, Bob 3000)
        //   → Bob's debt increases by 3000
        // Settlement: Bob pays Alice 2000
        //   → Bob's debt decreases by 2000
        // Net effect: +3000 - 2000 = +1000, so final = 5000 + 1000 = 6000

        // Prepare the draft expense first (not yet activated) via the real
        // save_expense_draft_graph RPC (issue #477's guard rejects direct
        // table writes).
        const draft = await saveDraft(alice, groupId, {
          title: "5.1 concurrent expense",
          totalAmount: 6000,
          shares: [
            { userId: alice.id, amount: 3000 },
            { userId: bob.id, amount: 3000 },
          ],
          payers: [{ userId: alice.id, amount: 6000 }],
        });
        const expenseId = draft.id;

        // Fire both concurrently, and prove — by holding the exact `groups`
        // row lock both RPCs take, on an independent connection, until both
        // racing backends are observed genuinely queued behind it — that
        // the two writers actually contended inside PostgreSQL. Blind
        // client-side polling cannot reliably catch this: these RPC bodies
        // execute in well under a millisecond locally, so a bare
        // `Promise.allSettled` plus a hopeful poll would intermittently
        // report "no contention" even for a correctly atomic
        // implementation (issue #519). Forcing the lock guarantees the
        // observation window regardless of RPC execution speed, and a
        // purely sequential implementation still fails this proof: only one
        // backend would ever be dispatched while the lock is held.
        const aliceClient = authenticateAs(alice);
        const bobClient = authenticateAs(bob);

        const { result: [activationResult, settlementResult], contention } =
          await forceLockContentionRace(
            process.env.SUPABASE_DB_URL!,
            {
              lockSql: "select id from groups where id = $1 for update",
              lockParams: [groupId],
              queryContains: ["activate_saved_expense", "record_settlements"],
              expectedRacers: 2,
            },
            () =>
              Promise.allSettled([
                aliceClient.rpc("activate_saved_expense", {
                  p_expense_id: expenseId,
                  p_expected_graph_revision: draft.graphRevision,
                }),
                bobClient.rpc("record_settlements", {
                  p_allocations: [{
                    group_id: groupId,
                    from_user_id: bob.id,
                    to_user_id: alice.id,
                    amount_cents: 2000,
                  }],
                  p_operation_id: crypto.randomUUID(),
                }),
              ]),
          );

        expect(contention.observed).toBe(true);

        // Both should succeed
        expect(activationResult.status).toBe("fulfilled");
        expect(settlementResult.status).toBe("fulfilled");

        if (activationResult.status === "fulfilled") {
          expect(activationResult.value.error).toBeNull();
        }
        if (settlementResult.status === "fulfilled") {
          expect(settlementResult.value.error).toBeNull();
        }

        // Balance should be exactly 5000 + 3000 - 2000 = 6000
        const finalBalance = await getBalanceBetween(
          groupId,
          bob.id,
          alice.id,
        );
        expect(finalBalance).toBe(6000);
      });
    });

    // -----------------------------------------------------------------------
    // 5.2 — Concurrent settlements on the same user pair
    // -----------------------------------------------------------------------

    describe("5.2 — concurrent settlements on the same pair", () => {
      it("two simultaneous settlements both apply correctly", async () => {
        // Setup: create a large debt from Carol to Alice
        await createAndActivateExpense({
          creator: alice,
          groupId,
          shares: [
            { userId: alice.id, amount: 1000 },
            { userId: carol.id, amount: 9000 },
          ],
          payers: [{ userId: alice.id, amount: 10000 }],
          title: "5.2 setup expense",
        });

        const initialBalance = await getBalanceBetween(
          groupId,
          carol.id,
          alice.id,
        );
        // Carol owes Alice 9000
        expect(initialBalance).toBe(9000);

        // Fire two settlements concurrently: Carol pays 3000, then another 4000
        const [r1, r2] = await Promise.allSettled([
          settleDebt({
            caller: carol,
            groupId,
            fromUserId: carol.id,
            toUserId: alice.id,
            amountCents: 3000,
          }),
          settleDebt({
            caller: alice, // creditor initiates the second one
            groupId,
            fromUserId: carol.id,
            toUserId: alice.id,
            amountCents: 4000,
          }),
        ]);

        expect(r1.status).toBe("fulfilled");
        expect(r2.status).toBe("fulfilled");

        // Balance should be 9000 - 3000 - 4000 = 2000
        const finalBalance = await getBalanceBetween(
          groupId,
          carol.id,
          alice.id,
        );
        expect(finalBalance).toBe(2000);
      });

      it("many concurrent small settlements sum correctly", async () => {
        // Setup: create a big debt from Dave to Alice
        await createAndActivateExpense({
          creator: alice,
          groupId,
          shares: [
            { userId: alice.id, amount: 0 },
            { userId: dave.id, amount: 10000 },
          ],
          payers: [{ userId: alice.id, amount: 10000 }],
          title: "5.2 many settlements setup",
        });

        const initialBalance = await getBalanceBetween(
          groupId,
          dave.id,
          alice.id,
        );
        // Dave owes Alice 10000 (plus any prior balance from previous tests)
        const priorBalance = initialBalance;

        // Fire 5 concurrent settlements of 1000 each
        const settlementCount = 5;
        const amountEach = 1000;

        const results = await Promise.allSettled(
          Array.from({ length: settlementCount }, () =>
            settleDebt({
              caller: dave,
              groupId,
              fromUserId: dave.id,
              toUserId: alice.id,
              amountCents: amountEach,
            }),
          ),
        );

        // All should succeed
        const fulfilled = results.filter((r) => r.status === "fulfilled");
        expect(fulfilled.length).toBe(settlementCount);

        // Each settlement returned a unique ID
        const ids = fulfilled.map((r) =>
          r.status === "fulfilled" ? r.value : "",
        );
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(settlementCount);

        // Balance should decrease by exactly 5 * 1000 = 5000
        const finalBalance = await getBalanceBetween(
          groupId,
          dave.id,
          alice.id,
        );
        expect(finalBalance).toBe(priorBalance - settlementCount * amountEach);
      });
    });

    // -----------------------------------------------------------------------
    // 5.3 — Interleaved expense activations and settlements across pairs
    // -----------------------------------------------------------------------

    describe("5.3 — interleaved expenses and settlements across pairs", () => {
      it("concurrent operations on different pairs do not interfere", async () => {
        // Record initial balances for all pairs we'll touch
        const initialAB = await getBalanceBetween(groupId, bob.id, alice.id);

        // Concurrently:
        // 1) Expense: Alice pays 4000, Bob's share 2000, Alice's share 2000
        //    → Bob owes Alice +2000
        // 2) Settlement: Dave pays Carol 1500
        //    → Dave-Carol balance changes by -1500

        // First, set up a debt from Dave to Carol so the settlement makes sense
        await createAndActivateExpense({
          creator: carol,
          groupId,
          shares: [
            { userId: carol.id, amount: 1000 },
            { userId: dave.id, amount: 4000 },
          ],
          payers: [{ userId: carol.id, amount: 5000 }],
          title: "5.3 setup dave-carol debt",
        });

        const daveCarolAfterSetup = await getBalanceBetween(
          groupId,
          dave.id,
          carol.id,
        );

        // Now fire expense activation and settlement concurrently on
        // different pairs. Draft via save_expense_draft_graph (#477 guard).
        const draft = await saveDraft(alice, groupId, {
          title: "5.3 concurrent expense AB",
          totalAmount: 4000,
          shares: [
            { userId: alice.id, amount: 2000 },
            { userId: bob.id, amount: 2000 },
          ],
          payers: [{ userId: alice.id, amount: 4000 }],
        });

        const [expenseResult, settlementResult] = await Promise.allSettled([
          authenticateAs(alice).rpc("activate_saved_expense", {
            p_expense_id: draft.id,
            p_expected_graph_revision: draft.graphRevision,
          }),
          settleDebt({
            caller: dave,
            groupId,
            fromUserId: dave.id,
            toUserId: carol.id,
            amountCents: 1500,
          }),
        ]);

        expect(expenseResult.status).toBe("fulfilled");
        expect(settlementResult.status).toBe("fulfilled");

        if (expenseResult.status === "fulfilled") {
          expect(expenseResult.value.error).toBeNull();
        }

        // Verify each pair updated independently
        const finalAB = await getBalanceBetween(groupId, bob.id, alice.id);
        expect(finalAB).toBe(initialAB + 2000);

        const finalCD = await getBalanceBetween(groupId, dave.id, carol.id);
        expect(finalCD).toBe(daveCarolAfterSetup - 1500);
      });

      it("concurrent expense + settlement on overlapping participant sets", async () => {
        // Concurrently:
        // 1) Expense with Alice, Bob, Carol — Alice pays 9000 (3000 each)
        //    → Bob owes Alice +3000, Carol owes Alice +3000
        // 2) Settlement: Bob pays Alice 1000

        const initialBA = await getBalanceBetween(groupId, bob.id, alice.id);
        const initialCA = await getBalanceBetween(groupId, carol.id, alice.id);

        const draft = await saveDraft(alice, groupId, {
          title: "5.3 overlapping participants",
          totalAmount: 9000,
          shares: [
            { userId: alice.id, amount: 3000 },
            { userId: bob.id, amount: 3000 },
            { userId: carol.id, amount: 3000 },
          ],
          payers: [{ userId: alice.id, amount: 9000 }],
        });
        const [expResult, settleResult] = await Promise.allSettled([
          authenticateAs(alice).rpc("activate_saved_expense", {
            p_expense_id: draft.id,
            p_expected_graph_revision: draft.graphRevision,
          }),
          settleDebt({
            caller: bob,
            groupId,
            fromUserId: bob.id,
            toUserId: alice.id,
            amountCents: 1000,
          }),
        ]);

        expect(expResult.status).toBe("fulfilled");
        expect(settleResult.status).toBe("fulfilled");
        if (expResult.status === "fulfilled") {
          expect(expResult.value.error).toBeNull();
        }
        // Bob-Alice: +3000 from expense, -1000 from settlement = net +2000
        const finalBA = await getBalanceBetween(groupId, bob.id, alice.id);
        expect(finalBA).toBe(initialBA + 3000 - 1000);

        // Carol-Alice: +3000 from expense only
        const finalCA = await getBalanceBetween(groupId, carol.id, alice.id);
        expect(finalCA).toBe(initialCA + 3000);
      });
    });

    // -----------------------------------------------------------------------
    // 5.4 — Concurrent bidirectional settlements
    // -----------------------------------------------------------------------

    describe("5.4 — concurrent bidirectional settlements", () => {
      it("simultaneous settlements in opposite directions net out correctly", async () => {
        // Setup: Bob owes Carol via an expense
        await createAndActivateExpense({
          creator: carol,
          groupId,
          shares: [
            { userId: carol.id, amount: 0 },
            { userId: bob.id, amount: 6000 },
          ],
          payers: [{ userId: carol.id, amount: 6000 }],
          title: "5.4 setup bob-carol debt",
        });

        const initialBC = await getBalanceBetween(groupId, bob.id, carol.id);

        // Concurrently:
        // 1) Bob pays Carol 2000 (reduces Bob's debt)
        // 2) Carol pays Bob 1000 (increases Bob's debt — Carol overpaid)
        // Net effect: -2000 + 1000 = -1000
        const [r1, r2] = await Promise.allSettled([
          settleDebt({
            caller: bob,
            groupId,
            fromUserId: bob.id,
            toUserId: carol.id,
            amountCents: 2000,
          }),
          settleDebt({
            caller: carol,
            groupId,
            fromUserId: carol.id,
            toUserId: bob.id,
            amountCents: 1000,
          }),
        ]);

        expect(r1.status).toBe("fulfilled");
        expect(r2.status).toBe("fulfilled");

        // Net: initial - 2000 + 1000
        const finalBC = await getBalanceBetween(groupId, bob.id, carol.id);
        expect(finalBC).toBe(initialBC - 2000 + 1000);
      });
    });

    // -----------------------------------------------------------------------
    // 5.5 — Concurrent expense activations touching overlapping balance rows
    // -----------------------------------------------------------------------

    describe("5.5 — concurrent expense activations on overlapping balance rows", () => {
      it("two expenses involving the same pair accumulate correctly", async () => {
        const initialBA = await getBalanceBetween(groupId, bob.id, alice.id);

        // (created via the real save_expense_draft_graph RPC; #477 guard).
        const [draft1, draft2] = await Promise.all([
          saveDraft(alice, groupId, {
            title: "5.5 expense A",
            totalAmount: 2000,
            shares: [
              { userId: alice.id, amount: 1000 },
              { userId: bob.id, amount: 1000 },
            ],
            payers: [{ userId: alice.id, amount: 2000 }],
          }),
          saveDraft(alice, groupId, {
            title: "5.5 expense B",
            totalAmount: 3000,
            shares: [
              { userId: alice.id, amount: 1500 },
              { userId: bob.id, amount: 1500 },
            ],
            payers: [{ userId: alice.id, amount: 3000 }],
          }),
        ]);

        // Activate both concurrently
        const [r1, r2] = await Promise.allSettled([
          authenticateAs(alice).rpc("activate_saved_expense", {
            p_expense_id: draft1.id,
            p_expected_graph_revision: draft1.graphRevision,
          }),
          authenticateAs(alice).rpc("activate_saved_expense", {
            p_expense_id: draft2.id,
            p_expected_graph_revision: draft2.graphRevision,
          }),
        ]);

        expect(r1.status).toBe("fulfilled");
        expect(r2.status).toBe("fulfilled");

        if (r1.status === "fulfilled") expect(r1.value.error).toBeNull();
        if (r2.status === "fulfilled") expect(r2.value.error).toBeNull();

        // Bob owes Alice an additional 1000 + 1500 = 2500
        const finalBA = await getBalanceBetween(groupId, bob.id, alice.id);
        expect(finalBA).toBe(initialBA + 1000 + 1500);
      });
    });

    // -----------------------------------------------------------------------
    // 5.6 — Settlement records created under concurrency are all persisted
    // -----------------------------------------------------------------------

    describe("5.6 — settlement record persistence under concurrency", () => {
      it("all concurrent settlements create distinct settlement records", async () => {
        // Setup a debt
        await createAndActivateExpense({
          creator: alice,
          groupId,
          shares: [
            { userId: alice.id, amount: 0 },
            { userId: bob.id, amount: 20000 },
          ],
          payers: [{ userId: alice.id, amount: 20000 }],
          title: "5.6 setup for record check",
        });

        const count = 4;
        const results = await Promise.allSettled(
          Array.from({ length: count }, (_, i) =>
            settleDebt({
              caller: bob,
              groupId,
              fromUserId: bob.id,
              toUserId: alice.id,
              amountCents: 1000 + i, // slightly different amounts for traceability
            }),
          ),
        );

        const fulfilled = results.filter((r) => r.status === "fulfilled");
        expect(fulfilled.length).toBe(count);

        // Verify all settlement records exist in the DB
        const { adminClient } = await import("@/test/integration-setup");
        const ids = fulfilled.map((r) =>
          r.status === "fulfilled" ? r.value : "",
        );

        const { data: settlements, error } = await adminClient!
          .from("settlements")
          .select("id, amount_cents, status")
          .in("id", ids);

        expect(error).toBeNull();
        expect(settlements).toHaveLength(count);
        for (const s of settlements!) {
          expect(s.status).toBe("confirmed");
        }

        // Verify amounts match
        const dbAmounts = settlements!
          .map((s) => s.amount_cents)
          .sort((a, b) => a - b);
        const expectedAmounts = Array.from(
          { length: count },
          (_, i) => 1000 + i,
        );
        expect(dbAmounts).toEqual(expectedAmounts);
      });
    });

    // -----------------------------------------------------------------------
    // 5.7 — leave_group / remove_group_member serialized against a
    //       concurrent balance-writing RPC (issue #505)
    // -----------------------------------------------------------------------

    describe("5.7 — leave_group and remove_group_member serialize against balance writers", () => {
      it("leave_group and a concurrent expense activation resolve to exactly one coherent outcome", async () => {
        const [eve, frank] = await createTestUsers(2, { name: "5.7-leave" });
        const group = await createTestGroupWithMembers(eve, [frank]);

        // Draft via save_expense_draft_graph (#477 guard rejects direct
        // table writes).
        const draft = await saveDraft(eve, group.id, {
          title: "5.7 leave-vs-activate expense",
          totalAmount: 4000,
          shares: [
            { userId: eve.id, amount: 2000 },
            { userId: frank.id, amount: 2000 },
          ],
          payers: [{ userId: eve.id, amount: 4000 }],
        });
        const expenseId = draft.id;

        const eveClient = authenticateAs(eve);
        const frankClient = authenticateAs(frank);

        // Frank currently has a zero balance, so leave_group would succeed
        // if it ran alone; activating the draft expense above would give
        // Frank a fresh 2000-cent debt to Eve. Forcing contention on the
        // groups-row lock both RPCs take proves the two writers actually
        // overlapped inside PostgreSQL, not client-side timing (#519).
        const { result: [leaveResult, activateResult], contention } =
          await forceLockContentionRace(
            process.env.SUPABASE_DB_URL!,
            {
              lockSql: "select id from groups where id = $1 for update",
              lockParams: [group.id],
              queryContains: ["leave_group", "activate_saved_expense"],
              expectedRacers: 2,
            },
            () =>
              Promise.allSettled([
                frankClient.rpc("leave_group", { p_group_id: group.id }),
                eveClient.rpc("activate_saved_expense", {
                  p_expense_id: expenseId,
                  p_expected_graph_revision: draft.graphRevision,
                }),
              ]),
          );

        expect(contention.observed).toBe(true);
        if (leaveResult.status !== "fulfilled" || activateResult.status !== "fulfilled") {
          throw new Error("both RPC calls must resolve (not reject) regardless of ordering");
        }

        const leaveSucceeded = leaveResult.value.error === null;
        const activateSucceeded = activateResult.value.error === null;

        // The group lock makes the two outcomes mutually exclusive: leave
        // winning means activation must then see Frank as a non-member and
        // fail; activation winning means leave must then see Frank's fresh
        // balance and fail. Never both, never neither.
        expect(leaveSucceeded).not.toBe(activateSucceeded);

        const { adminClient } = await import("@/test/integration-setup");
        const { data: membership } = await adminClient!
          .from("group_members")
          .select("status")
          .eq("group_id", group.id)
          .eq("user_id", frank.id)
          .maybeSingle();

        if (leaveSucceeded) {
          expect(activateResult.value.error!.message).toContain("non_member_share");
          expect(membership).toBeNull();
          const { data: expenseAfter } = await adminClient!
            .from("expenses")
            .select("status")
            .eq("id", expenseId)
            .single();
          expect(expenseAfter!.status).toBe("draft");
        } else {
          expect(leaveResult.value.error!.message).toContain("has_outstanding_balance");
          expect(membership!.status).toBe("accepted");
          const balance = await getBalanceBetween(group.id, frank.id, eve.id);
          expect(balance).toBe(2000);
        }
      });

      it("remove_group_member and a concurrent expense activation resolve to exactly one coherent outcome", async () => {
        const [grace, heidi] = await createTestUsers(2, { name: "5.7-remove" });
        const group = await createTestGroupWithMembers(grace, [heidi]);

        const draft = await saveDraft(grace, group.id, {
          title: "5.7 remove-vs-activate expense",
          totalAmount: 3000,
          shares: [
            { userId: grace.id, amount: 1500 },
            { userId: heidi.id, amount: 1500 },
          ],
          payers: [{ userId: grace.id, amount: 3000 }],
        });
        const expenseId = draft.id;

        const graceClient = authenticateAs(grace);

        const { result: [removeResult, activateResult], contention } =
          await forceLockContentionRace(
            process.env.SUPABASE_DB_URL!,
            {
              lockSql: "select id from groups where id = $1 for update",
              lockParams: [group.id],
              queryContains: ["remove_group_member", "activate_saved_expense"],
              expectedRacers: 2,
            },
            () =>
              Promise.allSettled([
                graceClient.rpc("remove_group_member", {
                  p_group_id: group.id,
                  p_user_id: heidi.id,
                }),
                graceClient.rpc("activate_saved_expense", {
                  p_expense_id: expenseId,
                  p_expected_graph_revision: draft.graphRevision,
                }),
              ]),
          );

        expect(contention.observed).toBe(true);
        if (removeResult.status !== "fulfilled" || activateResult.status !== "fulfilled") {
          throw new Error("both RPC calls must resolve (not reject) regardless of ordering");
        }

        const removeSucceeded = removeResult.value.error === null;
        const activateSucceeded = activateResult.value.error === null;
        expect(removeSucceeded).not.toBe(activateSucceeded);

        const { adminClient } = await import("@/test/integration-setup");
        const { data: membership } = await adminClient!
          .from("group_members")
          .select("status")
          .eq("group_id", group.id)
          .eq("user_id", heidi.id)
          .maybeSingle();

        if (removeSucceeded) {
          expect(activateResult.value.error!.message).toContain("non_member_share");
          expect(membership).toBeNull();
        } else {
          expect(removeResult.value.error!.message).toContain("has_outstanding_balance");
          expect(membership!.status).toBe("accepted");
          const balance = await getBalanceBetween(group.id, heidi.id, grace.id);
          expect(balance).toBe(1500);
        }
      });
    });

    // -----------------------------------------------------------------------
    // 5.8 — #495 checklist item 20: two-connection stale Bob-payer PST08
    //       barrier test. Two racing save_expense_draft_graph replacements
    //       at the same expected revision: one removes Bob (payer)
    //       entirely and reallocates to Alice; the other resubmits Bob's
    //       unchanged share/payer state, representing a stale tab that
    //       never observed the removal. Exactly one wins; the loser gets
    //       PST08/stale_graph_revision with zero effect, and the winner's
    //       payload is exactly what persists -- proving the same CAS
    //       mechanism proven generically elsewhere in this suite also
    //       rejects a stale write whose payload still names a removed
    //       payer, not just an unrelated stale field.
    // -----------------------------------------------------------------------

    describe("5.8 — concurrent draft replacement: Bob removal vs stale Bob-payer resubmit", () => {
      it("exactly one save wins; the loser gets PST08 and the persisted graph matches only the winner", async () => {
        const [ivy, jack] = await createTestUsers(2, { name: "5.8-stale-bob" });
        const group = await createTestGroupWithMembers(ivy, [jack]);

        const draft = await saveDraft(ivy, group.id, {
          title: "5.8 stale Bob-payer fixture",
          totalAmount: 6000,
          shares: [
            { userId: ivy.id, amount: 3000 },
            { userId: jack.id, amount: 3000 },
          ],
          payers: [{ userId: jack.id, amount: 6000 }],
        });
        const expenseId = draft.id;
        const baseRevision = draft.graphRevision;

        const ivyClient = authenticateAs(ivy);

        const removalPayload = {
          p_expense: {
            id: expenseId,
            group_id: group.id,
            title: "5.8 stale Bob-payer fixture",
            merchant_name: null,
            expense_type: "single_amount",
            total_amount: 6000,
            service_fee_basis_points: 0,
            fixed_fees: 0,
          },
          p_items: [],
          p_shares: [{ user_id: ivy.id, share_amount_cents: 6000 }],
          p_payers: [{ user_id: ivy.id, amount_cents: 6000 }],
          p_guests: [],
          p_guest_shares: [],
          p_participant_order: [],
          p_expected_graph_revision: baseRevision,
          p_save_operation_id: crypto.randomUUID(),
        };
        const staleBobPayload = {
          p_expense: {
            id: expenseId,
            group_id: group.id,
            title: "5.8 stale Bob-payer fixture",
            merchant_name: null,
            expense_type: "single_amount",
            total_amount: 6000,
            service_fee_basis_points: 0,
            fixed_fees: 0,
          },
          p_items: [],
          p_shares: [
            { user_id: ivy.id, share_amount_cents: 3000 },
            { user_id: jack.id, share_amount_cents: 3000 },
          ],
          p_payers: [{ user_id: jack.id, amount_cents: 6000 }],
          p_guests: [],
          p_guest_shares: [],
          p_participant_order: [],
          p_expected_graph_revision: baseRevision,
          p_save_operation_id: crypto.randomUUID(),
        };

        const { result: [removeResult, staleResult], contention } =
          await forceLockContentionRace(
            process.env.SUPABASE_DB_URL!,
            {
              lockSql: "select id from groups where id = $1 for update",
              lockParams: [group.id],
              queryContains: ["save_expense_draft_graph"],
              expectedRacers: 2,
            },
            () =>
              Promise.allSettled([
                ivyClient.rpc("save_expense_draft_graph", removalPayload),
                ivyClient.rpc("save_expense_draft_graph", staleBobPayload),
              ]),
          );

        expect(contention.observed).toBe(true);
        if (removeResult.status !== "fulfilled" || staleResult.status !== "fulfilled") {
          throw new Error("both RPC calls must resolve (not reject) regardless of ordering");
        }

        const removalWon = removeResult.value.error === null;
        const staleWon = staleResult.value.error === null;
        // Exactly one save wins; never both, never neither.
        expect(removalWon).not.toBe(staleWon);
        if (removalWon) {
          expect(staleResult.value.error!.message).toMatch(/stale_graph_revision/);
        } else {
          expect(removeResult.value.error!.message).toMatch(/stale_graph_revision/);
        }

        const { adminClient } = await import("@/test/integration-setup");
        const [{ data: shareRows }, { data: payerRows }, { data: expenseRow }] = await Promise.all([
          adminClient!
            .from("expense_shares")
            .select("user_id, share_amount_cents")
            .eq("expense_id", expenseId),
          adminClient!
            .from("expense_payers")
            .select("user_id, amount_cents")
            .eq("expense_id", expenseId),
          adminClient!
            .from("expenses")
            .select("graph_revision")
            .eq("id", expenseId)
            .single(),
        ]);

        // Revision advances exactly once regardless of which side won.
        expect(expenseRow!.graph_revision).toBe(baseRevision + 1);

        if (removalWon) {
          // Exact readback equals the removal's graph: Bob is gone
          // entirely, no mixed children from the losing stale payload.
          expect(shareRows).toHaveLength(1);
          expect(shareRows![0]).toMatchObject({ user_id: ivy.id, share_amount_cents: 6000 });
          expect(payerRows).toHaveLength(1);
          expect(payerRows![0]).toMatchObject({ user_id: ivy.id, amount_cents: 6000 });
        } else {
          // The stale-but-first-to-commit resubmit won: Bob's original
          // graph persists byte-for-byte, and the losing removal made
          // zero effect (not a partial/mixed application of either).
          expect(shareRows).toHaveLength(2);
          expect(shareRows).toEqual(
            expect.arrayContaining([
              { user_id: ivy.id, share_amount_cents: 3000 },
              { user_id: jack.id, share_amount_cents: 3000 },
            ]),
          );
          expect(payerRows).toHaveLength(1);
          expect(payerRows![0]).toMatchObject({ user_id: jack.id, amount_cents: 6000 });
        }
      });
    });
  },
);
