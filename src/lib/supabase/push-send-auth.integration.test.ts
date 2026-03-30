import { describe, it, expect, beforeAll } from "vitest";
import {
  adminClient,
  isIntegrationTestReady,
} from "@/test/integration-setup";
import {
  createTestUsers,
  createTestGroupWithMembers,
  acceptGroupInvite,
  authenticateAs,
  type TestUser,
} from "@/test/integration-helpers";

/**
 * Integration tests for push notification send authorization.
 *
 * The POST /api/push/send route gates notification delivery on group membership:
 * the caller must share at least one "accepted" group_members row with the target.
 * These tests exercise the exact query pattern the route uses against a real
 * Supabase instance to verify RLS + authorization semantics.
 */
describe.skipIf(!isIntegrationTestReady)(
  "push send authorization — group membership gating",
  () => {
    /**
     * Reproduces the exact authorization check from POST /api/push/send:
     * 1. Get the caller's accepted group_ids
     * 2. Check if the target also has an accepted membership in any of those groups
     * Returns the count of shared accepted groups (0 = unauthorized).
     */
    async function checkSendAuthorization(
      caller: TestUser,
      targetUserId: string,
    ): Promise<number> {
      const callerClient = authenticateAs(caller);

      // Step 1: caller's accepted groups (via their authenticated client / RLS)
      const { data: callerGroups } = await callerClient
        .from("group_members")
        .select("group_id")
        .eq("user_id", caller.id)
        .eq("status", "accepted");

      const callerGroupIds = (callerGroups ?? []).map((g) => g.group_id);
      if (callerGroupIds.length === 0) return 0;

      // Step 2: target's accepted membership in any of caller's groups
      const { count } = await callerClient
        .from("group_members")
        .select("*", { count: "exact", head: true })
        .eq("user_id", targetUserId)
        .eq("status", "accepted")
        .in("group_id", callerGroupIds);

      return count ?? 0;
    }

    // ──────────────────────────────────────────────
    // 4.1 — Accepted members in the same group can notify each other
    // ──────────────────────────────────────────────
    describe("4.1 — accepted group members can notify each other", () => {
      let alice: TestUser;
      let bob: TestUser;

      beforeAll(async () => {
        [alice, bob] = await createTestUsers(2);
        await createTestGroupWithMembers(alice, [bob]);
      });

      it("alice can send to bob", async () => {
        const count = await checkSendAuthorization(alice, bob.id);
        expect(count).toBeGreaterThanOrEqual(1);
      });

      it("bob can send to alice", async () => {
        const count = await checkSendAuthorization(bob, alice.id);
        expect(count).toBeGreaterThanOrEqual(1);
      });
    });

    // ──────────────────────────────────────────────
    // 4.2 — Users not sharing a group cannot notify each other
    // ──────────────────────────────────────────────
    describe("4.2 — unrelated users are blocked", () => {
      let alice: TestUser;
      let bob: TestUser;
      let carol: TestUser;

      beforeAll(async () => {
        [alice, bob, carol] = await createTestUsers(3);
        // Alice and bob share a group; carol is in no group at all
        await createTestGroupWithMembers(alice, [bob]);
      });

      it("carol (no groups) cannot send to alice", async () => {
        const count = await checkSendAuthorization(carol, alice.id);
        expect(count).toBe(0);
      });

      it("alice cannot send to carol (no shared group)", async () => {
        const count = await checkSendAuthorization(alice, carol.id);
        expect(count).toBe(0);
      });
    });

    // ──────────────────────────────────────────────
    // 4.3 — Invited (not accepted) member cannot send or be targeted
    // ──────────────────────────────────────────────
    describe("4.3 — invited-only member is excluded", () => {
      let alice: TestUser;
      let bob: TestUser;
      let invitee: TestUser;
      let groupId: string;

      beforeAll(async () => {
        [alice, bob, invitee] = await createTestUsers(3);
        const group = await createTestGroupWithMembers(alice, [bob]);
        groupId = group.id;

        // Invite invitee but do NOT accept
        await adminClient!.from("group_members").insert({
          group_id: groupId,
          user_id: invitee.id,
          status: "invited",
          invited_by: alice.id,
        });
      });

      it("invitee cannot send to accepted members", async () => {
        const count = await checkSendAuthorization(invitee, alice.id);
        expect(count).toBe(0);
      });

      it("accepted member targeting invitee gets 0 (invitee not accepted)", async () => {
        const count = await checkSendAuthorization(alice, invitee.id);
        expect(count).toBe(0);
      });

      it("after accepting, invitee can send to group members", async () => {
        await acceptGroupInvite(invitee, groupId);

        const count = await checkSendAuthorization(invitee, alice.id);
        expect(count).toBeGreaterThanOrEqual(1);
      });

      it("after accepting, accepted members can send to invitee", async () => {
        const count = await checkSendAuthorization(bob, invitee.id);
        expect(count).toBeGreaterThanOrEqual(1);
      });
    });

    // ──────────────────────────────────────────────
    // 4.4 — Cross-group isolation: shared membership in one group
    //        does not bleed into another
    // ──────────────────────────────────────────────
    describe("4.4 — cross-group isolation", () => {
      let alice: TestUser;
      let bob: TestUser;
      let carol: TestUser;

      beforeAll(async () => {
        [alice, bob, carol] = await createTestUsers(3);
        // Group 1: alice + bob
        await createTestGroupWithMembers(alice, [bob]);
        // Group 2: alice + carol
        await createTestGroupWithMembers(alice, [carol]);
      });

      it("bob cannot send to carol (different groups)", async () => {
        const count = await checkSendAuthorization(bob, carol.id);
        expect(count).toBe(0);
      });

      it("carol cannot send to bob (different groups)", async () => {
        const count = await checkSendAuthorization(carol, bob.id);
        expect(count).toBe(0);
      });

      it("alice can send to both (shared group with each)", async () => {
        const [toBob, toCarol] = await Promise.all([
          checkSendAuthorization(alice, bob.id),
          checkSendAuthorization(alice, carol.id),
        ]);
        expect(toBob).toBeGreaterThanOrEqual(1);
        expect(toCarol).toBeGreaterThanOrEqual(1);
      });
    });

    // ──────────────────────────────────────────────
    // 4.5 — Removed member loses send authorization
    // ──────────────────────────────────────────────
    describe("4.5 — removed member loses authorization", () => {
      let alice: TestUser;
      let bob: TestUser;
      let groupId: string;

      beforeAll(async () => {
        [alice, bob] = await createTestUsers(2);
        const group = await createTestGroupWithMembers(alice, [bob]);
        groupId = group.id;
      });

      it("bob can send to alice before removal", async () => {
        const count = await checkSendAuthorization(bob, alice.id);
        expect(count).toBeGreaterThanOrEqual(1);
      });

      it("after removal, bob cannot send to alice", async () => {
        await adminClient!
          .from("group_members")
          .delete()
          .eq("group_id", groupId)
          .eq("user_id", bob.id);

        const count = await checkSendAuthorization(bob, alice.id);
        expect(count).toBe(0);
      });

      it("after removal, alice cannot send to bob", async () => {
        const count = await checkSendAuthorization(alice, bob.id);
        expect(count).toBe(0);
      });
    });

    // ──────────────────────────────────────────────
    // 4.6 — Multiple shared groups count correctly
    // ──────────────────────────────────────────────
    describe("4.6 — multiple shared groups", () => {
      let alice: TestUser;
      let bob: TestUser;

      beforeAll(async () => {
        [alice, bob] = await createTestUsers(2);
        // Two shared groups
        await createTestGroupWithMembers(alice, [bob]);
        await createTestGroupWithMembers(alice, [bob]);
      });

      it("reports shared count >= 2 when users share multiple groups", async () => {
        const count = await checkSendAuthorization(alice, bob.id);
        expect(count).toBeGreaterThanOrEqual(2);
      });
    });

    // ──────────────────────────────────────────────
    // 4.7 — Push subscriptions + send auth end-to-end
    //        (subscription CRUD gated by RLS + auth check in same flow)
    // ──────────────────────────────────────────────
    describe("4.7 — subscription lifecycle with send authorization", () => {
      let alice: TestUser;
      let bob: TestUser;
      let outsider: TestUser;

      beforeAll(async () => {
        [alice, bob, outsider] = await createTestUsers(3);
        await createTestGroupWithMembers(alice, [bob]);
      });

      it("admin can insert subscription for target, then authorized caller's auth check passes", async () => {
        // Simulate server-side subscription storage (admin inserts encrypted sub)
        const { error: insertError } = await adminClient!
          .from("push_subscriptions")
          .insert({
            user_id: bob.id,
            subscription: "encrypted_push_sub_for_bob",
          });
        expect(insertError).toBeNull();

        // Alice (same group) passes the auth check
        const count = await checkSendAuthorization(alice, bob.id);
        expect(count).toBeGreaterThanOrEqual(1);

        // Server would now read bob's subscriptions via admin client
        const { data: subs } = await adminClient!
          .from("push_subscriptions")
          .select("subscription")
          .eq("user_id", bob.id);
        expect(subs!.length).toBeGreaterThanOrEqual(1);
      });

      it("outsider fails auth check even when target has subscriptions", async () => {
        const count = await checkSendAuthorization(outsider, bob.id);
        expect(count).toBe(0);
      });

      it("after subscription deletion, auth check still passes (independent of subscription existence)", async () => {
        // Delete all bob's subscriptions
        await adminClient!
          .from("push_subscriptions")
          .delete()
          .eq("user_id", bob.id);

        // Auth check is about group membership, not subscription existence
        const count = await checkSendAuthorization(alice, bob.id);
        expect(count).toBeGreaterThanOrEqual(1);
      });
    });
  },
);
