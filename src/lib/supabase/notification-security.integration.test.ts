import { describe, it, expect } from "vitest";
import {
  adminClient,
  isIntegrationTestReady,
} from "@/test/integration-setup";
import {
  createTestUser,
  createTestUsers,
  createTestGroup,
  authenticateAs,
} from "@/test/integration-helpers";

// ---------------------------------------------------------------------------
// 1. notification_preferences — own-row-only RLS
// ---------------------------------------------------------------------------

describe.skipIf(!isIntegrationTestReady)(
  "notification_preferences RLS",
  () => {
    it("user can insert their own preferences", async () => {
      const user = await createTestUser();
      const client = authenticateAs(user);

      const { data, error } = await client
        .from("notification_preferences")
        .upsert({
          user_id: user.id,
          preferences: { nudge: false },
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data!.user_id).toBe(user.id);
      expect(data!.preferences).toEqual({ nudge: false });
    });

    it("user can read their own preferences", async () => {
      const user = await createTestUser();

      await adminClient!.from("notification_preferences").upsert({
        user_id: user.id,
        preferences: { expense_created: true },
      });

      const client = authenticateAs(user);
      const { data, error } = await client
        .from("notification_preferences")
        .select("*")
        .eq("user_id", user.id)
        .single();

      expect(error).toBeNull();
      expect(data!.preferences).toEqual({ expense_created: true });
    });

    it("user can update their own preferences", async () => {
      const user = await createTestUser();

      await adminClient!.from("notification_preferences").upsert({
        user_id: user.id,
        preferences: { nudge: true },
      });

      const client = authenticateAs(user);
      const { error } = await client
        .from("notification_preferences")
        .update({ preferences: { nudge: false } })
        .eq("user_id", user.id);

      expect(error).toBeNull();

      const { data } = await adminClient!
        .from("notification_preferences")
        .select("preferences")
        .eq("user_id", user.id)
        .single();

      expect(data!.preferences).toEqual({ nudge: false });
    });

    it("user cannot read another user's preferences", async () => {
      const [userA, userB] = await createTestUsers(2);

      await adminClient!.from("notification_preferences").upsert({
        user_id: userA.id,
        preferences: { nudge: false },
      });

      const clientB = authenticateAs(userB);
      const { data, error } = await clientB
        .from("notification_preferences")
        .select("*")
        .eq("user_id", userA.id);

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it("user cannot insert preferences for another user", async () => {
      const [userA, userB] = await createTestUsers(2);

      const clientB = authenticateAs(userB);
      const { error } = await clientB
        .from("notification_preferences")
        .upsert({
          user_id: userA.id,
          preferences: { nudge: false },
        });

      expect(error).not.toBeNull();
    });

    it("user cannot update another user's preferences", async () => {
      const [userA, userB] = await createTestUsers(2);

      await adminClient!.from("notification_preferences").upsert({
        user_id: userA.id,
        preferences: { nudge: true },
      });

      const clientB = authenticateAs(userB);
      await clientB
        .from("notification_preferences")
        .update({ preferences: { nudge: false } })
        .eq("user_id", userA.id);

      const { data } = await adminClient!
        .from("notification_preferences")
        .select("preferences")
        .eq("user_id", userA.id)
        .single();

      expect(data!.preferences).toEqual({ nudge: true });
    });

    it("service role can read all preferences", async () => {
      const [userA, userB] = await createTestUsers(2);

      await adminClient!.from("notification_preferences").upsert([
        { user_id: userA.id, preferences: { a: 1 } },
        { user_id: userB.id, preferences: { b: 2 } },
      ]);

      const { data, error } = await adminClient!
        .from("notification_preferences")
        .select("*")
        .in("user_id", [userA.id, userB.id]);

      expect(error).toBeNull();
      expect(data).toHaveLength(2);
    });

    it("cascades on user deletion", async () => {
      const user = await createTestUser();

      await adminClient!.from("notification_preferences").upsert({
        user_id: user.id,
        preferences: { will: "cascade" },
      });

      await adminClient!.from("users").delete().eq("id", user.id);

      const { data } = await adminClient!
        .from("notification_preferences")
        .select("user_id")
        .eq("user_id", user.id);

      expect(data).toHaveLength(0);

      await adminClient!.auth.admin.deleteUser(user.id);
    });
  },
);

// ---------------------------------------------------------------------------
// 2. nudge_log — no client access (RLS enabled, no policies)
// ---------------------------------------------------------------------------

describe.skipIf(!isIntegrationTestReady)(
  "nudge_log RLS",
  () => {
    it("authenticated user cannot read nudge_log", async () => {
      const [userA, userB] = await createTestUsers(2);
      const group = await createTestGroup(userA.id, [userB.id]);

      await adminClient!.from("nudge_log").insert({
        group_id: group.id,
        from_user: userA.id,
        to_user: userB.id,
      });

      const clientA = authenticateAs(userA);
      const { data, error } = await clientA
        .from("nudge_log")
        .select("*");

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it("authenticated user cannot insert into nudge_log", async () => {
      const [userA, userB] = await createTestUsers(2);
      const group = await createTestGroup(userA.id, [userB.id]);

      const clientA = authenticateAs(userA);
      const { error } = await clientA
        .from("nudge_log")
        .insert({
          group_id: group.id,
          from_user: userA.id,
          to_user: userB.id,
        });

      expect(error).not.toBeNull();
    });

    it("authenticated user cannot delete from nudge_log", async () => {
      const [userA, userB] = await createTestUsers(2);
      const group = await createTestGroup(userA.id, [userB.id]);

      await adminClient!.from("nudge_log").insert({
        group_id: group.id,
        from_user: userA.id,
        to_user: userB.id,
      });

      const clientA = authenticateAs(userA);
      await clientA
        .from("nudge_log")
        .delete()
        .eq("from_user", userA.id);

      const { data } = await adminClient!
        .from("nudge_log")
        .select("id")
        .eq("from_user", userA.id)
        .eq("to_user", userB.id);

      expect(data!.length).toBeGreaterThanOrEqual(1);
    });

    it("service role can read and write nudge_log", async () => {
      const [userA, userB] = await createTestUsers(2);
      const group = await createTestGroup(userA.id, [userB.id]);

      const { error: insertError } = await adminClient!
        .from("nudge_log")
        .insert({
          group_id: group.id,
          from_user: userA.id,
          to_user: userB.id,
        });

      expect(insertError).toBeNull();

      const { data, error: readError } = await adminClient!
        .from("nudge_log")
        .select("*")
        .eq("from_user", userA.id)
        .eq("to_user", userB.id);

      expect(readError).toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(1);
    });

    it("cascades on group deletion", async () => {
      const [userA, userB] = await createTestUsers(2);
      const group = await createTestGroup(userA.id, [userB.id]);

      await adminClient!.from("nudge_log").insert({
        group_id: group.id,
        from_user: userA.id,
        to_user: userB.id,
      });

      await adminClient!.from("groups").delete().eq("id", group.id);

      const { data } = await adminClient!
        .from("nudge_log")
        .select("id")
        .eq("group_id", group.id);

      expect(data).toHaveLength(0);
    });
  },
);

// ---------------------------------------------------------------------------
// 3. push_subscriptions cap trigger (max 20)
// ---------------------------------------------------------------------------

describe.skipIf(!isIntegrationTestReady)(
  "push_subscriptions cap trigger",
  () => {
    it("allows up to 20 subscriptions per user", async () => {
      const user = await createTestUser();

      const subs = Array.from({ length: 20 }, (_, i) => ({
        user_id: user.id,
        subscription: `device_${i}`,
      }));

      const { error } = await adminClient!
        .from("push_subscriptions")
        .insert(subs);

      expect(error).toBeNull();
    });

    it("rejects the 21st subscription", async () => {
      const user = await createTestUser();

      const subs = Array.from({ length: 20 }, (_, i) => ({
        user_id: user.id,
        subscription: `device_cap_${i}`,
      }));

      await adminClient!.from("push_subscriptions").insert(subs);

      const { error } = await adminClient!
        .from("push_subscriptions")
        .insert({
          user_id: user.id,
          subscription: "device_21_overflow",
        });

      expect(error).not.toBeNull();
      expect(error!.message).toContain("push_subscription_limit_exceeded");
    });

    it("cap is per-user, not global", async () => {
      const [userA, userB] = await createTestUsers(2);

      const subsA = Array.from({ length: 20 }, (_, i) => ({
        user_id: userA.id,
        subscription: `a_device_${i}`,
      }));

      await adminClient!.from("push_subscriptions").insert(subsA);

      const { error } = await adminClient!
        .from("push_subscriptions")
        .insert({
          user_id: userB.id,
          subscription: "b_first_device",
        });

      expect(error).toBeNull();
    });
  },
);
