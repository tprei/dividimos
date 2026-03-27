import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestUsers,
  authenticateAs,
  createTestGroup,
  type TestUser,
} from "@/test/integration-helpers";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";
import type { Database } from "@/types/database";

type GroupSettlementRow = Database["public"]["Tables"]["group_settlements"]["Row"];

describe.skipIf(!isIntegrationTestReady)("sync_group_settlements RPC", () => {
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let groupId: string;

  beforeEach(async () => {
    [alice, bob, carol] = await createTestUsers(3, { pixKeyType: "email" });

    const group = await createTestGroup(alice.id, [bob.id, carol.id]);
    groupId = group.id;

    // Accept all members so they can call the RPC
    await adminClient!
      .from("group_members")
      .update({ status: "accepted" })
      .eq("group_id", groupId);
  });

  it("creates pending settlements from edges", async () => {
    const aliceClient = authenticateAs(alice);

    const { data, error } = await aliceClient.rpc("sync_group_settlements", {
      p_group_id: groupId,
      p_edges: [
        { from_user_id: bob.id, to_user_id: alice.id, amount_cents: 5000 },
      ],
    });

    expect(error).toBeNull();
    const settlements = data as GroupSettlementRow[];
    expect(settlements).toHaveLength(1);
    expect(settlements[0]).toMatchObject({
      group_id: groupId,
      from_user_id: bob.id,
      to_user_id: alice.id,
      amount_cents: 5000,
      status: "pending",
    });
  });

  it("creates multiple edges atomically", async () => {
    const aliceClient = authenticateAs(alice);

    const { data, error } = await aliceClient.rpc("sync_group_settlements", {
      p_group_id: groupId,
      p_edges: [
        { from_user_id: bob.id, to_user_id: alice.id, amount_cents: 3000 },
        { from_user_id: carol.id, to_user_id: alice.id, amount_cents: 2000 },
      ],
    });

    expect(error).toBeNull();
    const settlements = data as GroupSettlementRow[];
    expect(settlements).toHaveLength(2);
  });

  it("replaces pending settlements on re-sync", async () => {
    const aliceClient = authenticateAs(alice);

    // First sync: bob→alice 5000
    await aliceClient.rpc("sync_group_settlements", {
      p_group_id: groupId,
      p_edges: [
        { from_user_id: bob.id, to_user_id: alice.id, amount_cents: 5000 },
      ],
    });

    // Second sync: bob→alice 3000, carol→alice 2000
    const { data, error } = await aliceClient.rpc("sync_group_settlements", {
      p_group_id: groupId,
      p_edges: [
        { from_user_id: bob.id, to_user_id: alice.id, amount_cents: 3000 },
        { from_user_id: carol.id, to_user_id: alice.id, amount_cents: 2000 },
      ],
    });

    expect(error).toBeNull();
    const settlements = data as GroupSettlementRow[];
    // Should have 2 settlements (old bob→alice 5000 replaced by 3000)
    expect(settlements).toHaveLength(2);

    const bobSettlement = settlements.find(
      (s) => s.from_user_id === bob.id,
    );
    expect(bobSettlement!.amount_cents).toBe(3000);
  });

  it("preserves non-pending settlements and subtracts from new edges", async () => {
    const aliceClient = authenticateAs(alice);

    // First sync: bob→alice 5000
    await aliceClient.rpc("sync_group_settlements", {
      p_group_id: groupId,
      p_edges: [
        { from_user_id: bob.id, to_user_id: alice.id, amount_cents: 5000 },
      ],
    });

    // Get the settlement ID and mark it as partially paid via a payment
    const { data: settlements } = await adminClient!
      .from("group_settlements")
      .select("id")
      .eq("group_id", groupId)
      .eq("from_user_id", bob.id)
      .eq("to_user_id", alice.id)
      .single();

    // Insert a payment to trigger the settlement to partially_paid
    await adminClient!.from("payments").insert({
      group_settlement_id: settlements!.id,
      from_user_id: bob.id,
      to_user_id: alice.id,
      amount_cents: 2000,
      status: "unconfirmed",
    });

    // Re-sync with a higher total: bob→alice 8000
    const { data, error } = await aliceClient.rpc("sync_group_settlements", {
      p_group_id: groupId,
      p_edges: [
        { from_user_id: bob.id, to_user_id: alice.id, amount_cents: 8000 },
      ],
    });

    expect(error).toBeNull();
    const result = data as GroupSettlementRow[];

    // Should have 2 rows: the partially_paid one (5000) + new pending (8000 - 5000 = 3000)
    const partiallyPaid = result.find((s) => s.status !== "pending");
    const pending = result.find((s) => s.status === "pending");

    expect(partiallyPaid).toBeDefined();
    expect(partiallyPaid!.amount_cents).toBe(5000);
    expect(pending).toBeDefined();
    expect(pending!.amount_cents).toBe(3000);
  });

  it("removes pending settlements when edges go to zero", async () => {
    const aliceClient = authenticateAs(alice);

    // First sync: bob→alice 5000
    await aliceClient.rpc("sync_group_settlements", {
      p_group_id: groupId,
      p_edges: [
        { from_user_id: bob.id, to_user_id: alice.id, amount_cents: 5000 },
      ],
    });

    // Second sync: empty edges
    const { data, error } = await aliceClient.rpc("sync_group_settlements", {
      p_group_id: groupId,
      p_edges: [],
    });

    expect(error).toBeNull();
    const settlements = data as GroupSettlementRow[];
    expect(settlements).toHaveLength(0);
  });

  it("does not insert edge when remaining is <= 1 centavo", async () => {
    const aliceClient = authenticateAs(alice);

    // Create a settled settlement via admin
    await adminClient!.from("group_settlements").insert({
      group_id: groupId,
      from_user_id: bob.id,
      to_user_id: alice.id,
      amount_cents: 5000,
      status: "settled",
      paid_amount_cents: 5000,
    });

    // Sync with same amount — remaining is 0
    const { data, error } = await aliceClient.rpc("sync_group_settlements", {
      p_group_id: groupId,
      p_edges: [
        { from_user_id: bob.id, to_user_id: alice.id, amount_cents: 5000 },
      ],
    });

    expect(error).toBeNull();
    const settlements = data as GroupSettlementRow[];
    // Only the settled row should remain, no new pending
    const pending = settlements.filter((s) => s.status === "pending");
    expect(pending).toHaveLength(0);
  });

  it("non-member cannot call the RPC", async () => {
    // Create a user not in the group
    const [outsider] = await createTestUsers(1, { pixKeyType: "email" });
    const outsiderClient = authenticateAs(outsider);

    const { error } = await outsiderClient.rpc("sync_group_settlements", {
      p_group_id: groupId,
      p_edges: [
        { from_user_id: bob.id, to_user_id: alice.id, amount_cents: 5000 },
      ],
    });

    expect(error).not.toBeNull();
  });

  it("no 409 conflict when called concurrently", async () => {
    const aliceClient = authenticateAs(alice);
    const bobClient = authenticateAs(bob);

    const edges = [
      { from_user_id: bob.id, to_user_id: alice.id, amount_cents: 5000 },
    ];

    // Fire two concurrent calls — one should succeed, the other should
    // either succeed or fail gracefully (no 409 CONFLICT)
    const results = await Promise.allSettled([
      aliceClient.rpc("sync_group_settlements", {
        p_group_id: groupId,
        p_edges: edges,
      }),
      bobClient.rpc("sync_group_settlements", {
        p_group_id: groupId,
        p_edges: edges,
      }),
    ]);

    // At least one should succeed
    const successes = results.filter(
      (r) => r.status === "fulfilled" && !(r.value as { error: unknown }).error,
    );
    expect(successes.length).toBeGreaterThanOrEqual(1);

    // Neither should get a 409 conflict — the loser should get a lock wait, not a unique violation
    for (const r of results) {
      if (r.status === "fulfilled") {
        const { error } = r.value as { error: { code?: string } | null };
        if (error) {
          expect(error.code).not.toBe("23505"); // unique_violation
        }
      }
    }
  });
});
