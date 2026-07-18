import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestUsers,
  createTestGroupWithMembers,
  createAndActivateExpense,
  settleDebt,
  getBalanceBetween,
  authenticateAs,
  createTestGroup,
  type TestUser,
} from "@/test/integration-helpers";
import { isIntegrationTestReady } from "@/test/integration-setup";

function singleSettlementInput(
  groupId: string,
  fromUserId: string,
  toUserId: string,
  amountCents: number,
  operationId = crypto.randomUUID(),
) {
  return {
    p_allocations: [{
      group_id: groupId,
      from_user_id: fromUserId,
      to_user_id: toUserId,
      amount_cents: amountCents,
    }],
    p_operation_id: operationId,
  };
}

describe.skipIf(!isIntegrationTestReady)(
  "record_settlements RPC",
  () => {
    let alice: TestUser;
    let bob: TestUser;
    let carol: TestUser;
    let groupId: string;

    beforeEach(async () => {
      [alice, bob, carol] = await createTestUsers(3);
      const group = await createTestGroupWithMembers(alice, [bob, carol]);
      groupId = group.id;
    });

    // -----------------------------------------------------------------------
    // 1.1 Basic settlement reduces balance correctly
    // -----------------------------------------------------------------------
    describe("basic settlement", () => {
      it("reduces balance to zero after full settlement", async () => {
        // Alice pays 6000, split equally → Bob owes Alice 2000, Carol owes Alice 2000
        await createAndActivateExpense({
          creator: alice,
          groupId,
          shares: [
            { userId: alice.id, amount: 2000 },
            { userId: bob.id, amount: 2000 },
            { userId: carol.id, amount: 2000 },
          ],
          payers: [{ userId: alice.id, amount: 6000 }],
        });

        const balanceBefore = await getBalanceBetween(groupId, bob.id, alice.id);
        expect(balanceBefore).toBe(2000); // Bob owes Alice 2000

        // Bob settles the full amount
        const settlementId = await settleDebt({
          caller: bob,
          groupId,
          fromUserId: bob.id,
          toUserId: alice.id,
          amountCents: 2000,
        });

        expect(settlementId).toBeTruthy();
        expect(typeof settlementId).toBe("string");

        const balanceAfter = await getBalanceBetween(groupId, bob.id, alice.id);
        expect(balanceAfter).toBe(0);
      });

      it("allows partial settlement", async () => {
        // Alice pays 4000, Bob's share is 2000
        await createAndActivateExpense({
          creator: alice,
          groupId,
          shares: [
            { userId: alice.id, amount: 2000 },
            { userId: bob.id, amount: 2000 },
          ],
          payers: [{ userId: alice.id, amount: 4000 }],
        });

        // Bob settles half
        await settleDebt({
          caller: bob,
          groupId,
          fromUserId: bob.id,
          toUserId: alice.id,
          amountCents: 1000,
        });

        const balance = await getBalanceBetween(groupId, bob.id, alice.id);
        expect(balance).toBe(1000); // Bob still owes 1000
      });

      it("allows oversettlement (balance goes negative)", async () => {
        // Alice pays 4000, Bob's share is 2000
        await createAndActivateExpense({
          creator: alice,
          groupId,
          shares: [
            { userId: alice.id, amount: 2000 },
            { userId: bob.id, amount: 2000 },
          ],
          payers: [{ userId: alice.id, amount: 4000 }],
        });

        // Bob overpays
        await settleDebt({
          caller: bob,
          groupId,
          fromUserId: bob.id,
          toUserId: alice.id,
          amountCents: 3000,
        });

        // Now Alice owes Bob 1000
        const balance = await getBalanceBetween(groupId, bob.id, alice.id);
        expect(balance).toBe(-1000);
      });

      it("creates a confirmed settlement record", async () => {
        await createAndActivateExpense({
          creator: alice,
          groupId,
          shares: [
            { userId: alice.id, amount: 1000 },
            { userId: bob.id, amount: 1000 },
          ],
          payers: [{ userId: alice.id, amount: 2000 }],
        });

        const settlementId = await settleDebt({
          caller: bob,
          groupId,
          fromUserId: bob.id,
          toUserId: alice.id,
          amountCents: 1000,
        });

        // Verify the settlement record
        const bobClient = authenticateAs(bob);
        const { data: settlement, error } = await bobClient
          .from("settlements")
          .select("*")
          .eq("id", settlementId)
          .single();

        expect(error).toBeNull();
        expect(settlement).not.toBeNull();
        expect(settlement!.status).toBe("confirmed");
        expect(settlement!.confirmed_at).not.toBeNull();
        expect(settlement!.from_user_id).toBe(bob.id);
        expect(settlement!.to_user_id).toBe(alice.id);
        expect(settlement!.amount_cents).toBe(1000);
        expect(settlement!.group_id).toBe(groupId);
      });
    });

    describe("replay-safe operations", () => {
      it("replays exactly once, reconciles for the owner, and survives membership removal", async () => {
        await createAndActivateExpense({
          creator: alice,
          groupId,
          shares: [
            { userId: alice.id, amount: 1000 },
            { userId: bob.id, amount: 1000 },
          ],
          payers: [{ userId: alice.id, amount: 2000 }],
        });

        const bobClient = authenticateAs(bob);
        const operationId = crypto.randomUUID();
        const input = singleSettlementInput(
          groupId,
          bob.id,
          alice.id,
          1000,
          operationId,
        );
        const { data: first, error: firstError } = await bobClient.rpc(
          "record_settlements",
          input,
        );

        expect(firstError).toBeNull();
        expect(first).toHaveLength(1);
        expect(first![0].was_replay).toBe(false);

        const { data: replay, error: replayError } = await bobClient.rpc(
          "record_settlements",
          input,
        );

        expect(replayError).toBeNull();
        expect(replay).toHaveLength(1);
        expect(replay![0]).toMatchObject({
          settlement_id: first![0].settlement_id,
          was_replay: true,
        });
        expect(await getBalanceBetween(groupId, bob.id, alice.id)).toBe(0);

        const { data: reconciliation, error: reconciliationError } = await bobClient.rpc(
          "get_settlement_operation",
          { p_operation_id: operationId },
        );

        expect(reconciliationError).toBeNull();
        expect(reconciliation).toHaveLength(1);
        expect(reconciliation![0].settlement_id).toBe(first![0].settlement_id);

        const aliceClient = authenticateAs(alice);
        const { data: foreignOperation } = await aliceClient.rpc(
          "get_settlement_operation",
          { p_operation_id: operationId },
        );
        expect(foreignOperation).toHaveLength(0);

        const { error: removalError } = await aliceClient.rpc("remove_group_member", {
          p_group_id: groupId,
          p_user_id: bob.id,
        });
        expect(removalError).toBeNull();

        const { data: afterRemoval, error: afterRemovalError } = await bobClient.rpc(
          "get_settlement_operation",
          { p_operation_id: operationId },
        );
        expect(afterRemovalError).toBeNull();
        expect(afterRemoval).toHaveLength(1);
        expect(afterRemoval![0].settlement_id).toBe(first![0].settlement_id);
      });

      it("rejects a distinct canonical request reusing an operation ID", async () => {
        const bobClient = authenticateAs(bob);
        const operationId = crypto.randomUUID();
        const firstInput = singleSettlementInput(
          groupId,
          bob.id,
          alice.id,
          1000,
          operationId,
        );
        const { error: firstError } = await bobClient.rpc(
          "record_settlements",
          firstInput,
        );
        expect(firstError).toBeNull();

        const { error: conflictError } = await bobClient.rpc(
          "record_settlements",
          singleSettlementInput(groupId, bob.id, alice.id, 2000, operationId),
        );

        expect(conflictError).not.toBeNull();
        expect(conflictError!.code).toBe("PST10");
      });
    });

    // -----------------------------------------------------------------------
    // 1.2 Creditor can also call the RPC
    // -----------------------------------------------------------------------
    describe("caller permissions", () => {
      it("allows the creditor (to_user) to record the settlement", async () => {
        await createAndActivateExpense({
          creator: alice,
          groupId,
          shares: [
            { userId: alice.id, amount: 2000 },
            { userId: bob.id, amount: 2000 },
          ],
          payers: [{ userId: alice.id, amount: 4000 }],
        });

        // Alice (creditor) records the settlement on Bob's behalf
        await settleDebt({
          caller: alice,
          groupId,
          fromUserId: bob.id,
          toUserId: alice.id,
          amountCents: 2000,
        });

        const balance = await getBalanceBetween(groupId, bob.id, alice.id);
        expect(balance).toBe(0);
      });

      it("rejects a third party calling the RPC", async () => {
        await createAndActivateExpense({
          creator: alice,
          groupId,
          shares: [
            { userId: alice.id, amount: 2000 },
            { userId: bob.id, amount: 2000 },
          ],
          payers: [{ userId: alice.id, amount: 4000 }],
        });

        // Carol tries to settle between Alice and Bob — should fail
        const carolClient = authenticateAs(carol);
        const { error } = await carolClient.rpc(
          "record_settlements",
          singleSettlementInput(groupId, bob.id, alice.id, 2000),
        );

        expect(error).not.toBeNull();
        expect(error!.message).toContain("permission_denied");
      });
    });

    // -----------------------------------------------------------------------
    // 1.3 Validation: zero and negative amounts
    // -----------------------------------------------------------------------
    describe("amount validation", () => {
      it("rejects zero amount", async () => {
        const bobClient = authenticateAs(bob);
        const { error } = await bobClient.rpc(
          "record_settlements",
          singleSettlementInput(groupId, bob.id, alice.id, 0),
        );

        expect(error).not.toBeNull();
        expect(error!.message).toContain("invalid_amount");
      });

      it("rejects negative amount", async () => {
        const bobClient = authenticateAs(bob);
        const { error } = await bobClient.rpc(
          "record_settlements",
          singleSettlementInput(groupId, bob.id, alice.id, -500),
        );

        expect(error).not.toBeNull();
        expect(error!.message).toContain("invalid_amount");
      });
    });

    // -----------------------------------------------------------------------
    // 1.4 Validation: settling with yourself
    // -----------------------------------------------------------------------
    describe("self-settlement validation", () => {
      it("rejects settling with yourself", async () => {
        const aliceClient = authenticateAs(alice);
        const { error } = await aliceClient.rpc(
          "record_settlements",
          singleSettlementInput(groupId, alice.id, alice.id, 1000),
        );

        expect(error).not.toBeNull();
        expect(error!.message).toContain("invalid_users");
      });
    });

    // -----------------------------------------------------------------------
    // 1.5 Group membership enforcement
    // -----------------------------------------------------------------------
    describe("group membership enforcement", () => {
      it("rejects settlement from a non-group-member", async () => {
        const [outsider] = await createTestUsers(1);

        const outsiderClient = authenticateAs(outsider);
        const { error } = await outsiderClient.rpc(
          "record_settlements",
          singleSettlementInput(groupId, outsider.id, alice.id, 1000),
        );

        expect(error).not.toBeNull();
        expect(error!.message).toContain("permission_denied");
      });

      it("rejects settlement where counterparty is not a group member", async () => {
        const [outsider] = await createTestUsers(1);

        const aliceClient = authenticateAs(alice);
        const { error } = await aliceClient.rpc(
          "record_settlements",
          singleSettlementInput(groupId, outsider.id, alice.id, 1000),
        );

        expect(error).not.toBeNull();
        expect(error!.message).toContain("permission_denied");
      });

      it("rejects settlement from an invited-but-not-accepted member", async () => {
        const [dave] = await createTestUsers(1);
        const group2 = await createTestGroup(alice.id, [dave.id]);

        const daveClient = authenticateAs(dave);
        const { error } = await daveClient.rpc(
          "record_settlements",
          singleSettlementInput(group2.id, dave.id, alice.id, 500),
        );

        expect(error).not.toBeNull();
        expect(error!.message).toContain("permission_denied");
      });
    });

    // -----------------------------------------------------------------------
    // 1.6 Settlement without prior balance (creates new balance row)
    // -----------------------------------------------------------------------
    describe("settlement without prior balance", () => {
      it("creates a balance row when none exists", async () => {
        // No expense created — balance between Bob and Alice is 0 (no row)
        const balanceBefore = await getBalanceBetween(groupId, bob.id, alice.id);
        expect(balanceBefore).toBe(0);

        // Bob settles 1000 to Alice anyway
        await settleDebt({
          caller: bob,
          groupId,
          fromUserId: bob.id,
          toUserId: alice.id,
          amountCents: 1000,
        });

        // Now Alice owes Bob (negative: Bob overpaid with no prior debt)
        const balanceAfter = await getBalanceBetween(groupId, bob.id, alice.id);
        expect(balanceAfter).toBe(-1000);
      });
    });

    // -----------------------------------------------------------------------
    // 1.7 Multiple sequential settlements accumulate correctly
    // -----------------------------------------------------------------------
    describe("multiple settlements", () => {
      it("accumulates multiple partial settlements", async () => {
        // Alice pays 10000, Bob's share is 5000
        await createAndActivateExpense({
          creator: alice,
          groupId,
          shares: [
            { userId: alice.id, amount: 5000 },
            { userId: bob.id, amount: 5000 },
          ],
          payers: [{ userId: alice.id, amount: 10000 }],
        });

        // Bob settles in 3 installments
        await settleDebt({
          caller: bob,
          groupId,
          fromUserId: bob.id,
          toUserId: alice.id,
          amountCents: 2000,
        });

        const after1 = await getBalanceBetween(groupId, bob.id, alice.id);
        expect(after1).toBe(3000);

        await settleDebt({
          caller: bob,
          groupId,
          fromUserId: bob.id,
          toUserId: alice.id,
          amountCents: 2000,
        });

        const after2 = await getBalanceBetween(groupId, bob.id, alice.id);
        expect(after2).toBe(1000);

        await settleDebt({
          caller: bob,
          groupId,
          fromUserId: bob.id,
          toUserId: alice.id,
          amountCents: 1000,
        });

        const after3 = await getBalanceBetween(groupId, bob.id, alice.id);
        expect(after3).toBe(0);
      });

      it("handles settlements in both directions", async () => {
        // Alice pays 4000 split with Bob → Bob owes Alice 2000
        await createAndActivateExpense({
          creator: alice,
          groupId,
          shares: [
            { userId: alice.id, amount: 2000 },
            { userId: bob.id, amount: 2000 },
          ],
          payers: [{ userId: alice.id, amount: 4000 }],
        });

        // Bob pays Alice back 2000
        await settleDebt({
          caller: bob,
          groupId,
          fromUserId: bob.id,
          toUserId: alice.id,
          amountCents: 2000,
        });

        expect(await getBalanceBetween(groupId, bob.id, alice.id)).toBe(0);

        // Now Alice settles 1000 towards Bob (reverse direction)
        await settleDebt({
          caller: alice,
          groupId,
          fromUserId: alice.id,
          toUserId: bob.id,
          amountCents: 1000,
        });

        // Bob now owes Alice 1000 (Alice overpaid from zero balance)
        expect(await getBalanceBetween(groupId, alice.id, bob.id)).toBe(-1000);
      });
    });

    // -----------------------------------------------------------------------
    // 1.8 Settlement with three-way balances
    // -----------------------------------------------------------------------
    describe("three-way settlement scenarios", () => {
      it("settles independent pairs without affecting third-party balance", async () => {
        // Alice pays 9000, split 3-ways → Bob owes 3000, Carol owes 3000
        await createAndActivateExpense({
          creator: alice,
          groupId,
          shares: [
            { userId: alice.id, amount: 3000 },
            { userId: bob.id, amount: 3000 },
            { userId: carol.id, amount: 3000 },
          ],
          payers: [{ userId: alice.id, amount: 9000 }],
        });

        // Bob settles with Alice
        await settleDebt({
          caller: bob,
          groupId,
          fromUserId: bob.id,
          toUserId: alice.id,
          amountCents: 3000,
        });

        // Carol's balance with Alice should be unchanged
        expect(await getBalanceBetween(groupId, carol.id, alice.id)).toBe(3000);
        // Bob's balance with Alice should be zero
        expect(await getBalanceBetween(groupId, bob.id, alice.id)).toBe(0);
        // Bob and Carol should have no balance
        expect(await getBalanceBetween(groupId, bob.id, carol.id)).toBe(0);
      });
    });
  },
);
