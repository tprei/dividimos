import { describe, it, expect, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  adminClient,
  isIntegrationTestReady,
} from "@/test/integration-setup";
import {
  createTestUsers,
  createTestGroupWithMembers,
  authenticateAs,
  createAndActivateExpense,
  getBalanceBetween,
  type TestUser,
} from "@/test/integration-helpers";

// Schema types for chat_messages / is_dm / dm_pairs land in a separate types
// PR. Use an untyped client so new-surface checks compile today.
function untypedAs(user: TestUser) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${user.accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

describe.skipIf(!isIntegrationTestReady)("RLS hardening guards", () => {
  // ────────────────────────────────────────────────────────
  // groups INSERT: clients cannot create DM groups directly
  // ────────────────────────────────────────────────────────
  describe("groups INSERT blocks direct is_dm creation", () => {
    let alice: TestUser;

    beforeAll(async () => {
      [alice] = await createTestUsers(1);
    });

    it("allows creating a regular (is_dm = false) group", async () => {
      const client = untypedAs(alice);
      const { error } = await client
        .from("groups")
        .insert({ name: "Regular", creator_id: alice.id, is_dm: false })
        .select("id")
        .single();

      expect(error).toBeNull();
    });

    it("rejects direct INSERT of a DM group from the client", async () => {
      const client = untypedAs(alice);
      const { data, error } = await client
        .from("groups")
        .insert({ name: "Fake DM", creator_id: alice.id, is_dm: true })
        .select("id");

      // RLS WITH CHECK fails → no row inserted. Depending on PostgREST
      // behaviour the response is either an empty array or an error.
      if (error) {
        expect(error.message.toLowerCase()).toMatch(
          /(row-level security|permission|violates)/,
        );
      } else {
        expect(data ?? []).toHaveLength(0);
      }
    });
  });

  // ────────────────────────────────────────────────────────
  // expenses UPDATE: creators cannot flip status directly
  // ────────────────────────────────────────────────────────
  describe("expenses UPDATE blocks status transitions", () => {
    let alice: TestUser;
    let bob: TestUser;
    let groupId: string;
    let draftId: string;

    beforeAll(async () => {
      [alice, bob] = await createTestUsers(2);
      const group = await createTestGroupWithMembers(alice, [bob]);
      groupId = group.id;

      const { data: draft } = await adminClient!
        .from("expenses")
        .insert({
          group_id: groupId,
          creator_id: alice.id,
          title: "Draft",
          expense_type: "single_amount",
          total_amount: 2000,
          status: "draft",
        })
        .select("id")
        .single();

      draftId = draft!.id;

      await adminClient!.from("expense_shares").insert([
        { expense_id: draftId, user_id: alice.id, share_amount_cents: 1000 },
        { expense_id: draftId, user_id: bob.id, share_amount_cents: 1000 },
      ]);
      await adminClient!.from("expense_payers").insert({
        expense_id: draftId,
        user_id: alice.id,
        amount_cents: 2000,
      });
    });

    it("creator cannot flip status from draft to active via direct UPDATE", async () => {
      const client = authenticateAs(alice);
      const { error } = await client
        .from("expenses")
        .update({ status: "active" })
        .eq("id", draftId);

      // Either an RLS error or a silent no-op; status must still be 'draft'
      if (!error) {
        const { data } = await adminClient!
          .from("expenses")
          .select("status")
          .eq("id", draftId)
          .single();
        expect(data!.status).toBe("draft");
      } else {
        expect(error.message.toLowerCase()).toMatch(
          /row-level security|permission|violates/,
        );
      }
    });

    it("activate_expense RPC still transitions draft → active", async () => {
      const client = authenticateAs(alice);
      const { error } = await client.rpc("activate_expense", {
        p_expense_id: draftId,
      });

      expect(error).toBeNull();

      const { data } = await adminClient!
        .from("expenses")
        .select("status")
        .eq("id", draftId)
        .single();
      expect(data!.status).toBe("active");
    });
  });

  // ────────────────────────────────────────────────────────
  // activate_expense: phantom-share attack is rejected
  // ────────────────────────────────────────────────────────
  describe("activate_expense validates counterparty membership", () => {
    let alice: TestUser;
    let bob: TestUser;
    let unrelated: TestUser;
    let groupId: string;

    beforeAll(async () => {
      [alice, bob, unrelated] = await createTestUsers(3);
      const group = await createTestGroupWithMembers(alice, [bob]);
      groupId = group.id;
      // unrelated is NOT added to this group at any point
    });

    it("rejects activation when a share references a non-member", async () => {
      // #477's guard routes every expenses row through save_expense_draft_graph,
      // which validates accepted membership at SAVE time. A non-member share
      // is now rejected one stage earlier (strictly safer).
      const client = authenticateAs(alice);
      const { data, error } = await client.rpc("save_expense_draft_graph", {
        p_expense: { group_id: groupId, title: "Phantom share", merchant_name: null,
          expense_type: "single_amount", total_amount: 6000, service_fee_basis_points: 0, fixed_fees: 0 },
        p_items: [],
        p_shares: [
          { user_id: alice.id, share_amount_cents: 3000 },
          { user_id: unrelated.id, share_amount_cents: 3000 },
        ],
        p_payers: [{ user_id: alice.id, amount_cents: 6000 }],
        p_guests: [], p_guest_shares: [], p_participant_order: [],
        p_expected_graph_revision: 0, p_save_operation_id: crypto.randomUUID(),
      });

      expect(error).not.toBeNull();
      expect(data).toBeNull();

      const balance = await getBalanceBetween(groupId, alice.id, unrelated.id);
      expect(balance).toBe(0);
    });

    it("rejects activation when a payer references a non-member", async () => {
      // Same: save_expense_draft_graph validates all participants at save time.
      const client = authenticateAs(alice);
      const { data, error } = await client.rpc("save_expense_draft_graph", {
        p_expense: { group_id: groupId, title: "Phantom payer", merchant_name: null,
          expense_type: "single_amount", total_amount: 4000, service_fee_basis_points: 0, fixed_fees: 0 },
        p_items: [],
        p_shares: [
          { user_id: alice.id, share_amount_cents: 2000 },
          { user_id: bob.id, share_amount_cents: 2000 },
        ],
        p_payers: [{ user_id: unrelated.id, amount_cents: 4000 }],
        p_guests: [], p_guest_shares: [], p_participant_order: [],
        p_expected_graph_revision: 0, p_save_operation_id: crypto.randomUUID(),
      });

      expect(error).not.toBeNull();
      expect(data).toBeNull();
    });

    it("allows activation when shares reference an invited (not-yet-accepted) member", async () => {
      const [invited] = await createTestUsers(1);
      await adminClient!.from("group_members").insert({
        group_id: groupId,
        user_id: invited.id,
        status: "invited",
        invited_by: alice.id,
      });

      const { data: expense } = await adminClient!
        .from("expenses")
        .insert({
          group_id: groupId,
          creator_id: alice.id,
          title: "Adhoc bill with invited member",
          expense_type: "single_amount",
          total_amount: 8000,
          status: "draft",
        })
        .select("id")
        .single();

      await adminClient!.from("expense_shares").insert([
        { expense_id: expense!.id, user_id: alice.id, share_amount_cents: 4000 },
        { expense_id: expense!.id, user_id: invited.id, share_amount_cents: 4000 },
      ]);
      await adminClient!.from("expense_payers").insert({
        expense_id: expense!.id,
        user_id: alice.id,
        amount_cents: 8000,
      });

      const client = authenticateAs(alice);
      const { error } = await client.rpc("activate_expense", {
        p_expense_id: expense!.id,
      });

      expect(error).toBeNull();

      await adminClient!.from("expenses").delete().eq("id", expense!.id);
      await adminClient!
        .from("group_members")
        .delete()
        .eq("group_id", groupId)
        .eq("user_id", invited.id);
    });
  });

  // ────────────────────────────────────────────────────────
  // record_settlements: phantom counterparty is rejected
  // ────────────────────────────────────────────────────────
  describe("record_settlements validates counterparty membership", () => {
    let alice: TestUser;
    let bob: TestUser;
    let unrelated: TestUser;
    let groupId: string;

    beforeAll(async () => {
      [alice, bob, unrelated] = await createTestUsers(3);
      const group = await createTestGroupWithMembers(alice, [bob]);
      groupId = group.id;
    });

    it("rejects settlement against a non-member counterparty", async () => {
      const client = authenticateAs(alice);
      const { error } = await client.rpc("record_settlements", {
        p_allocations: [{
          group_id: groupId,
          from_user_id: alice.id,
          to_user_id: unrelated.id,
          amount_cents: 1000,
        }],
        p_operation_id: crypto.randomUUID(),
      });

      expect(error).not.toBeNull();
      expect(error!.message).toContain("counterparty is not a group member");
    });

    it("allows settlement against an invited (not-yet-accepted) member", async () => {
      const [invited] = await createTestUsers(1);
      await adminClient!.from("group_members").insert({
        group_id: groupId,
        user_id: invited.id,
        status: "invited",
        invited_by: alice.id,
      });

      await createAndActivateExpense({
        creator: alice,
        groupId,
        shares: [
          { userId: alice.id, amount: 2500 },
          { userId: invited.id, amount: 2500 },
        ],
        payers: [{ userId: alice.id, amount: 5000 }],
      });

      const client = authenticateAs(alice);
      const { error } = await client.rpc("record_settlements", {
        p_allocations: [{
          group_id: groupId,
          from_user_id: invited.id,
          to_user_id: alice.id,
          amount_cents: 2500,
        }],
        p_operation_id: crypto.randomUUID(),
      });

      expect(error).toBeNull();

      const balance = await getBalanceBetween(groupId, invited.id, alice.id);
      expect(balance).toBe(0);
    });
  });
});
