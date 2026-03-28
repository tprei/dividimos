import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestUsers,
  authenticateAs,
  createTestBill,
  createTestGroup,
  type TestUser,
} from "@/test/integration-helpers";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";
import type { Database } from "@/types/database";

describe.skipIf(!isIntegrationTestReady)(
  "Group settlement cascade trigger (cascade_group_settlement)",
  () => {
    let alice: TestUser;
    let bob: TestUser;
    let carol: TestUser;
    let groupId: string;

    beforeEach(async () => {
      [alice, bob, carol] = await createTestUsers(3);

      // Create a group with all three users
      const group = await createTestGroup(alice.id, [bob.id, carol.id]);
      groupId = group.id;

      // Accept all invitations
      await adminClient!
        .from("group_members")
        .update({ status: "accepted" })
        .eq("group_id", groupId)
        .eq("user_id", bob.id);
      await adminClient!
        .from("group_members")
        .update({ status: "accepted" })
        .eq("group_id", groupId)
        .eq("user_id", carol.id);
    });

    it("settles forward-direction ledger entries when group settlement is settled", async () => {
      // Create a bill in the group
      const bill = await createTestBill(alice.id, {
        status: "active",
        total_amount: 3000,
        group_id: groupId,
      });

      // Bob → Alice: 1000 (forward direction, same as settlement)
      const { data: ledger } = await adminClient!
        .from("ledger")
        .insert({
          bill_id: bill.id,
          from_user_id: bob.id,
          to_user_id: alice.id,
          amount_cents: 1000,
          status: "pending",
          entry_type: "debt",
          group_id: groupId,
        })
        .select("id")
        .single();

      // Create the group settlement
      const { data: settlement } = await adminClient!
        .from("group_settlements")
        .insert({
          group_id: groupId,
          from_user_id: bob.id,
          to_user_id: alice.id,
          amount_cents: 1000,
          status: "pending",
        })
        .select("id")
        .single();

      // Settle the group settlement
      await adminClient!
        .from("group_settlements")
        .update({ status: "settled" })
        .eq("id", settlement!.id);

      // Verify the ledger entry was auto-settled
      const { data: updatedLedger } = await adminClient!
        .from("ledger")
        .select("status, confirmed_at")
        .eq("id", ledger!.id)
        .single();

      expect(updatedLedger!.status).toBe("settled");
      expect(updatedLedger!.confirmed_at).not.toBeNull();
    });

    it("settles reverse-direction ledger entries (netting)", async () => {
      // Create a bill in the group
      const bill = await createTestBill(alice.id, {
        status: "active",
        total_amount: 3000,
        group_id: groupId,
      });

      // Alice → Bob: 500 (REVERSE direction from settlement)
      const { data: reverseLedger } = await adminClient!
        .from("ledger")
        .insert({
          bill_id: bill.id,
          from_user_id: alice.id,
          to_user_id: bob.id,
          amount_cents: 500,
          status: "pending",
          entry_type: "debt",
          group_id: groupId,
        })
        .select("id")
        .single();

      // Group settlement: Bob → Alice (the net direction)
      const { data: settlement } = await adminClient!
        .from("group_settlements")
        .insert({
          group_id: groupId,
          from_user_id: bob.id,
          to_user_id: alice.id,
          amount_cents: 500,
          status: "pending",
        })
        .select("id")
        .single();

      await adminClient!
        .from("group_settlements")
        .update({ status: "settled" })
        .eq("id", settlement!.id);

      // Reverse ledger entry should also be settled
      const { data: updatedLedger } = await adminClient!
        .from("ledger")
        .select("status")
        .eq("id", reverseLedger!.id)
        .single();

      expect(updatedLedger!.status).toBe("settled");
    });

    it("does not settle ledger entries from other groups", async () => {
      // Create a bill OUTSIDE the group
      const otherBill = await createTestBill(alice.id, {
        status: "active",
        total_amount: 1000,
      });

      const { data: otherLedger } = await adminClient!
        .from("ledger")
        .insert({
          bill_id: otherBill.id,
          from_user_id: bob.id,
          to_user_id: alice.id,
          amount_cents: 500,
          status: "pending",
          entry_type: "debt",
        })
        .select("id")
        .single();

      // Settle group settlement in our group
      const { data: settlement } = await adminClient!
        .from("group_settlements")
        .insert({
          group_id: groupId,
          from_user_id: bob.id,
          to_user_id: alice.id,
          amount_cents: 500,
          status: "pending",
        })
        .select("id")
        .single();

      await adminClient!
        .from("group_settlements")
        .update({ status: "settled" })
        .eq("id", settlement!.id);

      // The non-group ledger entry should NOT be affected
      const { data: checkLedger } = await adminClient!
        .from("ledger")
        .select("status")
        .eq("id", otherLedger!.id)
        .single();

      expect(checkLedger!.status).toBe("pending");
    });

    it("does not settle ledger entries involving unrelated users", async () => {
      const bill = await createTestBill(alice.id, {
        status: "active",
        total_amount: 3000,
        group_id: groupId,
      });

      // Carol → Alice (NOT part of the Bob→Alice settlement)
      const { data: unrelatedLedger } = await adminClient!
        .from("ledger")
        .insert({
          bill_id: bill.id,
          from_user_id: carol.id,
          to_user_id: alice.id,
          amount_cents: 500,
          status: "pending",
          entry_type: "debt",
          group_id: groupId,
        })
        .select("id")
        .single();

      // Settle Bob → Alice
      const { data: settlement } = await adminClient!
        .from("group_settlements")
        .insert({
          group_id: groupId,
          from_user_id: bob.id,
          to_user_id: alice.id,
          amount_cents: 500,
          status: "pending",
        })
        .select("id")
        .single();

      await adminClient!
        .from("group_settlements")
        .update({ status: "settled" })
        .eq("id", settlement!.id);

      // Carol's entry should NOT be affected
      const { data: checkLedger } = await adminClient!
        .from("ledger")
        .select("status")
        .eq("id", unrelatedLedger!.id)
        .single();

      expect(checkLedger!.status).toBe("pending");
    });

    it("handles multiple bills in the same group", async () => {
      // Two bills in the same group, both with Bob → Alice debts
      const bill1 = await createTestBill(alice.id, {
        status: "active",
        total_amount: 1500,
        group_id: groupId,
      });
      const bill2 = await createTestBill(alice.id, {
        status: "active",
        total_amount: 1500,
        group_id: groupId,
      });

      const { data: ledger1 } = await adminClient!
        .from("ledger")
        .insert({
          bill_id: bill1.id,
          from_user_id: bob.id,
          to_user_id: alice.id,
          amount_cents: 500,
          status: "pending",
          entry_type: "debt",
          group_id: groupId,
        })
        .select("id")
        .single();

      const { data: ledger2 } = await adminClient!
        .from("ledger")
        .insert({
          bill_id: bill2.id,
          from_user_id: bob.id,
          to_user_id: alice.id,
          amount_cents: 700,
          status: "pending",
          entry_type: "debt",
          group_id: groupId,
        })
        .select("id")
        .single();

      // Settle the group settlement
      const { data: settlement } = await adminClient!
        .from("group_settlements")
        .insert({
          group_id: groupId,
          from_user_id: bob.id,
          to_user_id: alice.id,
          amount_cents: 1200,
          status: "pending",
        })
        .select("id")
        .single();

      await adminClient!
        .from("group_settlements")
        .update({ status: "settled" })
        .eq("id", settlement!.id);

      // Both ledger entries across both bills should be settled
      const { data: check1 } = await adminClient!
        .from("ledger")
        .select("status")
        .eq("id", ledger1!.id)
        .single();
      const { data: check2 } = await adminClient!
        .from("ledger")
        .select("status")
        .eq("id", ledger2!.id)
        .single();

      expect(check1!.status).toBe("settled");
      expect(check2!.status).toBe("settled");
    });

    it("trigger is idempotent — re-setting settled to settled does not error", async () => {
      const bill = await createTestBill(alice.id, {
        status: "active",
        total_amount: 1000,
        group_id: groupId,
      });

      await adminClient!.from("ledger").insert({
        bill_id: bill.id,
        from_user_id: bob.id,
        to_user_id: alice.id,
        amount_cents: 500,
        status: "pending",
        entry_type: "debt",
        group_id: groupId,
      });

      const { data: settlement } = await adminClient!
        .from("group_settlements")
        .insert({
          group_id: groupId,
          from_user_id: bob.id,
          to_user_id: alice.id,
          amount_cents: 500,
          status: "pending",
        })
        .select("id")
        .single();

      // First settle
      await adminClient!
        .from("group_settlements")
        .update({ status: "settled" })
        .eq("id", settlement!.id);

      // Settle again (no-op) — should not throw
      const { error } = await adminClient!
        .from("group_settlements")
        .update({ status: "settled" })
        .eq("id", settlement!.id);

      expect(error).toBeNull();
    });
  },
);
