import { describe, it, expect } from "vitest";
import {
  adminClient,
  isIntegrationTestReady,
} from "@/test/integration-setup";
import {
  createTestUser,
  authenticateAs,
} from "@/test/integration-helpers";

describe.skipIf(!isIntegrationTestReady)(
  "push_subscriptions table and RLS",
  () => {
    it("user can insert their own subscription", async () => {
      const user = await createTestUser();
      const client = authenticateAs(user);

      const { data, error } = await client
        .from("push_subscriptions")
        .insert({
          user_id: user.id,
          subscription: "encrypted_subscription_json_here",
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data!.user_id).toBe(user.id);
      expect(data!.subscription).toBe("encrypted_subscription_json_here");
      expect(data!.id).toBeTruthy();
      expect(data!.created_at).toBeTruthy();
    });

    it("user can read their own subscriptions", async () => {
      const user = await createTestUser();
      const client = authenticateAs(user);

      // Insert two subscriptions (different devices)
      await client.from("push_subscriptions").insert([
        { user_id: user.id, subscription: "device_1_sub" },
        { user_id: user.id, subscription: "device_2_sub" },
      ]);

      const { data, error } = await client
        .from("push_subscriptions")
        .select("*")
        .eq("user_id", user.id);

      expect(error).toBeNull();
      expect(data).toHaveLength(2);
    });

    it("user cannot read another user's subscriptions", async () => {
      const [userA, userB] = await Promise.all([
        createTestUser(),
        createTestUser(),
      ]);

      // Insert subscription for userA using admin
      await adminClient!.from("push_subscriptions").insert({
        user_id: userA.id,
        subscription: "secret_sub_a",
      });

      // userB tries to read userA's subscriptions
      const clientB = authenticateAs(userB);
      const { data, error } = await clientB
        .from("push_subscriptions")
        .select("*")
        .eq("user_id", userA.id);

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it("user cannot insert a subscription for another user", async () => {
      const [userA, userB] = await Promise.all([
        createTestUser(),
        createTestUser(),
      ]);

      const clientB = authenticateAs(userB);
      const { error } = await clientB
        .from("push_subscriptions")
        .insert({
          user_id: userA.id,
          subscription: "malicious_sub",
        });

      expect(error).not.toBeNull();
    });

    it("user can delete their own subscription", async () => {
      const user = await createTestUser();
      const client = authenticateAs(user);

      const { data: inserted } = await client
        .from("push_subscriptions")
        .insert({
          user_id: user.id,
          subscription: "to_be_deleted",
        })
        .select("id")
        .single();

      const { error: deleteError } = await client
        .from("push_subscriptions")
        .delete()
        .eq("id", inserted!.id);

      expect(deleteError).toBeNull();

      const { data: remaining } = await client
        .from("push_subscriptions")
        .select("*")
        .eq("user_id", user.id);

      expect(remaining).toHaveLength(0);
    });

    it("user cannot delete another user's subscription", async () => {
      const [userA, userB] = await Promise.all([
        createTestUser(),
        createTestUser(),
      ]);

      // Insert subscription for userA using admin
      const { data: inserted } = await adminClient!
        .from("push_subscriptions")
        .insert({
          user_id: userA.id,
          subscription: "protected_sub",
        })
        .select("id")
        .single();

      // userB tries to delete userA's subscription
      const clientB = authenticateAs(userB);
      await clientB
        .from("push_subscriptions")
        .delete()
        .eq("id", inserted!.id);

      // Verify it still exists via admin
      const { data: stillExists } = await adminClient!
        .from("push_subscriptions")
        .select("id")
        .eq("id", inserted!.id)
        .single();

      expect(stillExists).not.toBeNull();
    });

    it("service role (admin) can read all subscriptions for sending notifications", async () => {
      const [userA, userB] = await Promise.all([
        createTestUser(),
        createTestUser(),
      ]);

      await adminClient!.from("push_subscriptions").insert([
        { user_id: userA.id, subscription: "sub_a" },
        { user_id: userB.id, subscription: "sub_b" },
      ]);

      // Admin can read both
      const { data, error } = await adminClient!
        .from("push_subscriptions")
        .select("*")
        .in("user_id", [userA.id, userB.id]);

      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(2);
    });

    it("cascades on user deletion", async () => {
      const user = await createTestUser();

      await adminClient!.from("push_subscriptions").insert({
        user_id: user.id,
        subscription: "will_cascade",
      });

      // Delete the user (triggers ON DELETE CASCADE)
      await adminClient!.from("users").delete().eq("id", user.id);

      const { data } = await adminClient!
        .from("push_subscriptions")
        .select("id")
        .eq("user_id", user.id);

      expect(data).toHaveLength(0);

      // Clean up auth user too
      await adminClient!.auth.admin.deleteUser(user.id);
    });
  },
);
