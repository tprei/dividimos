import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestUsers,
  authenticateAs,
  createTestGroup,
  type TestUser,
} from "@/test/integration-helpers";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";

describe.skipIf(!isIntegrationTestReady)("expense tables schema", () => {
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let groupId: string;

  beforeEach(async () => {
    [alice, bob, carol] = await createTestUsers(3);
    const group = await createTestGroup(alice.id, [bob.id, carol.id]);
    groupId = group.id;
    // Accept all members
    await adminClient!
      .from("group_members")
      .update({ status: "accepted" })
      .eq("group_id", groupId);
  });

  describe("expenses", () => {
    it("creator can insert an expense into their group", async () => {
      const client = authenticateAs(alice);
      const { data, error } = await client
        .from("expenses")
        .insert({
          group_id: groupId,
          creator_id: alice.id,
          title: "Dinner",
          expense_type: "single_amount",
          total_amount: 10000,
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data!.title).toBe("Dinner");
      expect(data!.total_amount).toBe(10000);
      expect(data!.status).toBe("draft");
    });

    it("group member can read group expenses", async () => {
      // Create expense as admin
      const { data: expense } = await adminClient!
        .from("expenses")
        .insert({
          group_id: groupId,
          creator_id: alice.id,
          title: "Lunch",
          total_amount: 5000,
        })
        .select()
        .single();

      // Bob (group member) should see it
      const bobClient = authenticateAs(bob);
      const { data, error } = await bobClient
        .from("expenses")
        .select("*")
        .eq("id", expense!.id)
        .single();

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data!.title).toBe("Lunch");
    });

    it("non-member cannot read group expenses", async () => {
      const [outsider] = await createTestUsers(1);

      await adminClient!
        .from("expenses")
        .insert({
          group_id: groupId,
          creator_id: alice.id,
          title: "Secret Dinner",
          total_amount: 5000,
        });

      const outsiderClient = authenticateAs(outsider);
      const { data } = await outsiderClient
        .from("expenses")
        .select("*")
        .eq("group_id", groupId);

      expect(data).toHaveLength(0);
    });

    it("rejects negative total_amount", async () => {
      const { error } = await adminClient!
        .from("expenses")
        .insert({
          group_id: groupId,
          creator_id: alice.id,
          title: "Bad expense",
          total_amount: -100,
        });

      expect(error).not.toBeNull();
    });

    it("auto-updates updated_at on change", async () => {
      const { data: expense } = await adminClient!
        .from("expenses")
        .insert({
          group_id: groupId,
          creator_id: alice.id,
          title: "Original",
          total_amount: 1000,
        })
        .select()
        .single();

      const originalUpdatedAt = expense!.updated_at;

      // Small delay to ensure timestamp differs
      await new Promise((r) => setTimeout(r, 50));

      await adminClient!
        .from("expenses")
        .update({ title: "Updated" })
        .eq("id", expense!.id);

      const { data: updated } = await adminClient!
        .from("expenses")
        .select("updated_at")
        .eq("id", expense!.id)
        .single();

      expect(updated!.updated_at).not.toBe(originalUpdatedAt);
    });
  });

  describe("expense_items", () => {
    it("can insert items linked to an expense", async () => {
      const { data: expense } = await adminClient!
        .from("expenses")
        .insert({
          group_id: groupId,
          creator_id: alice.id,
          title: "Grocery",
          expense_type: "itemized",
          total_amount: 3000,
        })
        .select()
        .single();

      const { data, error } = await adminClient!
        .from("expense_items")
        .insert({
          expense_id: expense!.id,
          description: "Rice",
          quantity: 2,
          unit_price_cents: 500,
          total_price_cents: 1000,
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data!.description).toBe("Rice");
      expect(data!.total_price_cents).toBe(1000);
    });

    it("cascades delete when expense is deleted", async () => {
      const { data: expense } = await adminClient!
        .from("expenses")
        .insert({
          group_id: groupId,
          creator_id: alice.id,
          title: "To delete",
          total_amount: 1000,
        })
        .select()
        .single();

      await adminClient!.from("expense_items").insert({
        expense_id: expense!.id,
        description: "Item",
        unit_price_cents: 500,
        total_price_cents: 500,
      });

      await adminClient!.from("expenses").delete().eq("id", expense!.id);

      const { data } = await adminClient!
        .from("expense_items")
        .select("*")
        .eq("expense_id", expense!.id);

      expect(data).toHaveLength(0);
    });
  });

  describe("expense_shares", () => {
    it("can insert shares for users", async () => {
      const { data: expense } = await adminClient!
        .from("expenses")
        .insert({
          group_id: groupId,
          creator_id: alice.id,
          title: "Split dinner",
          total_amount: 9000,
        })
        .select()
        .single();

      const { error } = await adminClient!.from("expense_shares").insert([
        { expense_id: expense!.id, user_id: alice.id, share_amount_cents: 3000 },
        { expense_id: expense!.id, user_id: bob.id, share_amount_cents: 3000 },
        { expense_id: expense!.id, user_id: carol.id, share_amount_cents: 3000 },
      ]);

      expect(error).toBeNull();
    });

    it("enforces unique (expense_id, user_id)", async () => {
      const { data: expense } = await adminClient!
        .from("expenses")
        .insert({
          group_id: groupId,
          creator_id: alice.id,
          title: "Dupe test",
          total_amount: 1000,
        })
        .select()
        .single();

      await adminClient!.from("expense_shares").insert({
        expense_id: expense!.id,
        user_id: alice.id,
        share_amount_cents: 500,
      });

      const { error } = await adminClient!.from("expense_shares").insert({
        expense_id: expense!.id,
        user_id: alice.id,
        share_amount_cents: 500,
      });

      expect(error).not.toBeNull();
    });
  });

  describe("expense_payers", () => {
    it("can insert payers with amounts", async () => {
      const { data: expense } = await adminClient!
        .from("expenses")
        .insert({
          group_id: groupId,
          creator_id: alice.id,
          title: "Paid dinner",
          total_amount: 10000,
        })
        .select()
        .single();

      const { error } = await adminClient!.from("expense_payers").insert([
        { expense_id: expense!.id, user_id: alice.id, amount_cents: 7000 },
        { expense_id: expense!.id, user_id: bob.id, amount_cents: 3000 },
      ]);

      expect(error).toBeNull();
    });

    it("rejects zero or negative amount_cents", async () => {
      const { data: expense } = await adminClient!
        .from("expenses")
        .insert({
          group_id: groupId,
          creator_id: alice.id,
          title: "Bad payer",
          total_amount: 1000,
        })
        .select()
        .single();

      const { error } = await adminClient!.from("expense_payers").insert({
        expense_id: expense!.id,
        user_id: alice.id,
        amount_cents: 0,
      });

      expect(error).not.toBeNull();
    });
  });

  describe("balances", () => {
    it("can insert a balance with canonical user ordering", async () => {
      // Determine canonical order
      const [userA, userB] =
        alice.id < bob.id ? [alice.id, bob.id] : [bob.id, alice.id];

      const { data, error } = await adminClient!
        .from("balances")
        .insert({
          group_id: groupId,
          user_a: userA,
          user_b: userB,
          amount_cents: 5000,
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data!.amount_cents).toBe(5000);
    });

    it("rejects non-canonical user ordering (user_a >= user_b)", async () => {
      const [userA, userB] =
        alice.id < bob.id ? [bob.id, alice.id] : [alice.id, bob.id];

      const { error } = await adminClient!.from("balances").insert({
        group_id: groupId,
        user_a: userA,
        user_b: userB,
        amount_cents: 1000,
      });

      expect(error).not.toBeNull();
    });

    it("allows negative amount_cents (reverse debt direction)", async () => {
      const [userA, userB] =
        alice.id < bob.id ? [alice.id, bob.id] : [bob.id, alice.id];

      const { data, error } = await adminClient!
        .from("balances")
        .insert({
          group_id: groupId,
          user_a: userA,
          user_b: userB,
          amount_cents: -3000,
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data!.amount_cents).toBe(-3000);
    });

    it("group member can read balances", async () => {
      const [userA, userB] =
        alice.id < bob.id ? [alice.id, bob.id] : [bob.id, alice.id];

      await adminClient!.from("balances").insert({
        group_id: groupId,
        user_a: userA,
        user_b: userB,
        amount_cents: 2000,
      });

      const bobClient = authenticateAs(bob);
      const { data } = await bobClient
        .from("balances")
        .select("*")
        .eq("group_id", groupId);

      expect(data!.length).toBeGreaterThanOrEqual(1);
    });

    it("non-member cannot read balances", async () => {
      const [outsider] = await createTestUsers(1);
      const [userA, userB] =
        alice.id < bob.id ? [alice.id, bob.id] : [bob.id, alice.id];

      await adminClient!.from("balances").insert({
        group_id: groupId,
        user_a: userA,
        user_b: userB,
        amount_cents: 2000,
      });

      const outsiderClient = authenticateAs(outsider);
      const { data } = await outsiderClient
        .from("balances")
        .select("*")
        .eq("group_id", groupId);

      expect(data).toHaveLength(0);
    });
  });

  describe("settlements", () => {
    it("from_user can insert a settlement", async () => {
      const client = authenticateAs(alice);
      const { data, error } = await client
        .from("settlements")
        .insert({
          group_id: groupId,
          from_user_id: alice.id,
          to_user_id: bob.id,
          amount_cents: 5000,
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data!.status).toBe("pending");
      expect(data!.amount_cents).toBe(5000);
    });

    it("cannot insert settlement as someone else", async () => {
      const bobClient = authenticateAs(bob);
      const { error } = await bobClient.from("settlements").insert({
        group_id: groupId,
        from_user_id: alice.id, // Bob trying to create as Alice
        to_user_id: carol.id,
        amount_cents: 1000,
      });

      expect(error).not.toBeNull();
    });

    it("group member can read group settlements", async () => {
      await adminClient!.from("settlements").insert({
        group_id: groupId,
        from_user_id: alice.id,
        to_user_id: bob.id,
        amount_cents: 3000,
      });

      const carolClient = authenticateAs(carol);
      const { data } = await carolClient
        .from("settlements")
        .select("*")
        .eq("group_id", groupId);

      expect(data!.length).toBeGreaterThanOrEqual(1);
    });

    it("rejects zero or negative amount_cents", async () => {
      const { error } = await adminClient!.from("settlements").insert({
        group_id: groupId,
        from_user_id: alice.id,
        to_user_id: bob.id,
        amount_cents: 0,
      });

      expect(error).not.toBeNull();
    });
  });
});
