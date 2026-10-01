import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  adminClient,
  isIntegrationTestReady,
} from "@/test/integration-setup";
import {
  createTestUsers,
  authenticateAs,
  expectRpcError,
} from "@/test/integration-helpers";

type ConsumeResult = { data: boolean | null; error: { message: string } | null };

async function consume(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<ConsumeResult> {
  const { data, error } = await client.rpc("consume_ai_request", {
    p_user_id: userId,
  });
  return { data, error } as ConsumeResult;
}

describe.skipIf(!isIntegrationTestReady)(
  "consume_ai_request RPC — daily AI budget",
  () => {
    let admin: NonNullable<typeof adminClient>;
    let anonClient: SupabaseClient<Database>;

    beforeAll(() => {
      admin = adminClient!;
      anonClient = createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
    });

    afterAll(async () => {
      // Only this suite spends the ai.daily bucket.
      await admin.from("rate_limit_counters").delete().eq("bucket", "ai.daily");
    });

    it("admits exactly 200 requests for one user, then blocks", async () => {
      const [user] = await createTestUsers(1);

      for (let i = 1; i <= 200; i++) {
        const { data, error } = await consume(admin, user.id);
        expect(error).toBeNull();
        expect(data).toBe(true);
      }

      const rejected = await consume(admin, user.id);
      expect(rejected.error).toBeNull();
      expect(rejected.data).toBe(false);

      // Once saturated, the same user stays blocked inside the window.
      const again = await consume(admin, user.id);
      expect(again.data).toBe(false);

      // The increment flows through increment_rate_limit with the user id as
      // subject, so the committed count reflects every spent token.
      const { data: row } = await admin
        .from("rate_limit_counters")
        .select("count")
        .eq("bucket", "ai.daily")
        .eq("subject", user.id)
        .single();
      expect(row?.count).toBe(201);
    });

    it("isolates budgets per user", async () => {
      const [userA, userB] = await createTestUsers(2);

      const first = await consume(admin, userA.id);
      expect(first.data).toBe(true);

      const fresh = await consume(admin, userB.id);
      expect(fresh.data).toBe(true);

      const { data: rowA } = await admin
        .from("rate_limit_counters")
        .select("count")
        .eq("bucket", "ai.daily")
        .eq("subject", userA.id)
        .single();
      expect(rowA?.count).toBe(1);

      const { data: rowB } = await admin
        .from("rate_limit_counters")
        .select("count")
        .eq("bucket", "ai.daily")
        .eq("subject", userB.id)
        .single();
      expect(rowB?.count).toBe(1);
    });

    it("raises account_deleted for a deleted account and spends no token", async () => {
      const [user] = await createTestUsers(1);
      const deleteResult = await admin.rpc("delete_account", {
        p_user_id: user.id,
      });
      expect(deleteResult.error).toBeNull();

      await expect(
        expectRpcError(consume(admin, user.id)),
      ).resolves.toBe("account_deleted");

      const { data: row } = await admin
        .from("rate_limit_counters")
        .select("subject")
        .eq("bucket", "ai.daily")
        .eq("subject", user.id)
        .maybeSingle();
      expect(row).toBeNull();
    });

    it("denies the anon role", async () => {
      const [user] = await createTestUsers(1);

      const { data, error } = await consume(anonClient, user.id);
      expect(data).toBeNull();
      expect(error).not.toBeNull();

      const { data: row } = await admin
        .from("rate_limit_counters")
        .select("subject")
        .eq("bucket", "ai.daily")
        .eq("subject", user.id)
        .maybeSingle();
      expect(row).toBeNull();
    });

    it("denies the authenticated role", async () => {
      const [user] = await createTestUsers(1);
      const client = authenticateAs(user);

      const { data, error } = await consume(client, user.id);
      expect(data).toBeNull();
      expect(error).not.toBeNull();

      const { data: row } = await admin
        .from("rate_limit_counters")
        .select("subject")
        .eq("bucket", "ai.daily")
        .eq("subject", user.id)
        .maybeSingle();
      expect(row).toBeNull();
    });
  },
);
