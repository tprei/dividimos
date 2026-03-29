/**
 * Suite 5 — Concurrency integration tests
 *
 * Validates that concurrent operations on balances produce correct results.
 * The `record_and_settle` RPC relies on PostgreSQL's `INSERT ... ON CONFLICT
 * DO UPDATE` atomicity (no explicit `FOR UPDATE` lock). These tests confirm
 * that this is sufficient under concurrent load.
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

        // Prepare the draft expense first (not yet activated)
        const { adminClient } = await import("@/test/integration-setup");
        const { data: expense } = await adminClient!
          .from("expenses")
          .insert({
            group_id: groupId,
            creator_id: alice.id,
            title: "5.1 concurrent expense",
            expense_type: "single_amount",
            total_amount: 6000,
            status: "draft",
          })
          .select("id")
          .single();

        const expenseId = expense!.id;

        await Promise.all([
          adminClient!.from("expense_shares").insert([
            { expense_id: expenseId, user_id: alice.id, share_amount_cents: 3000 },
            { expense_id: expenseId, user_id: bob.id, share_amount_cents: 3000 },
          ]),
          adminClient!.from("expense_payers").insert([
            { expense_id: expenseId, user_id: alice.id, amount_cents: 6000 },
          ]),
        ]);

        // Fire both concurrently
        const aliceClient = authenticateAs(alice);
        const bobClient = authenticateAs(bob);

        const [activationResult, settlementResult] = await Promise.allSettled([
          aliceClient.rpc("activate_expense", { p_expense_id: expenseId }),
          bobClient.rpc("record_and_settle", {
            p_group_id: groupId,
            p_from_user_id: bob.id,
            p_to_user_id: alice.id,
            p_amount_cents: 2000,
          }),
        ]);

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

        // Now fire expense activation and settlement concurrently on different pairs
        const { adminClient } = await import("@/test/integration-setup");
        const { data: expense } = await adminClient!
          .from("expenses")
          .insert({
            group_id: groupId,
            creator_id: alice.id,
            title: "5.3 concurrent expense AB",
            expense_type: "single_amount",
            total_amount: 4000,
            status: "draft",
          })
          .select("id")
          .single();

        await Promise.all([
          adminClient!.from("expense_shares").insert([
            { expense_id: expense!.id, user_id: alice.id, share_amount_cents: 2000 },
            { expense_id: expense!.id, user_id: bob.id, share_amount_cents: 2000 },
          ]),
          adminClient!.from("expense_payers").insert([
            { expense_id: expense!.id, user_id: alice.id, amount_cents: 4000 },
          ]),
        ]);

        const [expenseResult, settlementResult] = await Promise.allSettled([
          authenticateAs(alice).rpc("activate_expense", {
            p_expense_id: expense!.id,
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

        const { adminClient } = await import("@/test/integration-setup");
        const { data: expense } = await adminClient!
          .from("expenses")
          .insert({
            group_id: groupId,
            creator_id: alice.id,
            title: "5.3 overlapping participants",
            expense_type: "single_amount",
            total_amount: 9000,
            status: "draft",
          })
          .select("id")
          .single();

        await Promise.all([
          adminClient!.from("expense_shares").insert([
            { expense_id: expense!.id, user_id: alice.id, share_amount_cents: 3000 },
            { expense_id: expense!.id, user_id: bob.id, share_amount_cents: 3000 },
            { expense_id: expense!.id, user_id: carol.id, share_amount_cents: 3000 },
          ]),
          adminClient!.from("expense_payers").insert([
            { expense_id: expense!.id, user_id: alice.id, amount_cents: 9000 },
          ]),
        ]);

        const [expResult, settleResult] = await Promise.allSettled([
          authenticateAs(alice).rpc("activate_expense", {
            p_expense_id: expense!.id,
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

        // Prepare two draft expenses both affecting Alice-Bob
        const { adminClient } = await import("@/test/integration-setup");

        const [{ data: exp1 }, { data: exp2 }] = await Promise.all([
          adminClient!
            .from("expenses")
            .insert({
              group_id: groupId,
              creator_id: alice.id,
              title: "5.5 expense A",
              expense_type: "single_amount",
              total_amount: 2000,
              status: "draft",
            })
            .select("id")
            .single(),
          adminClient!
            .from("expenses")
            .insert({
              group_id: groupId,
              creator_id: alice.id,
              title: "5.5 expense B",
              expense_type: "single_amount",
              total_amount: 3000,
              status: "draft",
            })
            .select("id")
            .single(),
        ]);

        await Promise.all([
          adminClient!.from("expense_shares").insert([
            { expense_id: exp1!.id, user_id: alice.id, share_amount_cents: 1000 },
            { expense_id: exp1!.id, user_id: bob.id, share_amount_cents: 1000 },
          ]),
          adminClient!.from("expense_payers").insert([
            { expense_id: exp1!.id, user_id: alice.id, amount_cents: 2000 },
          ]),
          adminClient!.from("expense_shares").insert([
            { expense_id: exp2!.id, user_id: alice.id, share_amount_cents: 1500 },
            { expense_id: exp2!.id, user_id: bob.id, share_amount_cents: 1500 },
          ]),
          adminClient!.from("expense_payers").insert([
            { expense_id: exp2!.id, user_id: alice.id, amount_cents: 3000 },
          ]),
        ]);

        // Activate both concurrently
        const [r1, r2] = await Promise.allSettled([
          authenticateAs(alice).rpc("activate_expense", {
            p_expense_id: exp1!.id,
          }),
          authenticateAs(alice).rpc("activate_expense", {
            p_expense_id: exp2!.id,
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
  },
);
