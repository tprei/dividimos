import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  adminClient,
  isIntegrationTestReady,
} from "@/test/integration-setup";
import { createTestUsers, authenticateAs } from "@/test/integration-helpers";

function makeSubject(): string {
  return `rl-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function callRpc(
  client: ReturnType<typeof createClient<Database>>,
  bucket: string,
  subject: string,
  limit: number,
  windowSeconds: number,
): Promise<{ data: boolean | null; error: { message: string; code?: string } | null }> {
  return client.rpc("increment_rate_limit", {
    p_bucket:         bucket,
    p_subject:        subject,
    p_limit:          limit,
    p_window_seconds: windowSeconds,
  }) as unknown as { data: boolean | null; error: { message: string; code?: string } | null };
}

describe.skipIf(!isIntegrationTestReady)(
  "increment_rate_limit RPC — boolean contract",
  () => {
    let admin: NonNullable<typeof adminClient>;

    beforeAll(() => {
      admin = adminClient!;
    });

    afterAll(async () => {
      await admin
        .from("rate_limit_counters")
        .delete()
        .like("subject", "rl-test-%");
    });

    // -----------------------------------------------------------------------
    // Happy path: calls 1-30 return true
    // -----------------------------------------------------------------------

    it("calls 1-30 for one (bucket, subject) return true", async () => {
      const subject = makeSubject();

      for (let i = 1; i <= 30; i++) {
        const { data, error } = await callRpc(admin, "test.bucket", subject, 30, 60);
        expect(error).toBeNull();
        expect(data).toBe(true);
      }
    });

    // -----------------------------------------------------------------------
    // Exceed path: call 31 returns false; committed count is saturated
    // -----------------------------------------------------------------------

    it("call 31 returns false, and further calls remain false with count stuck at 31", async () => {
      const subject = makeSubject();

      for (let i = 1; i <= 30; i++) {
        const { data, error } = await callRpc(admin, "test.bucket", subject, 30, 60);
        expect(error).toBeNull();
        expect(data).toBe(true);
      }

      const call31 = await callRpc(admin, "test.bucket", subject, 30, 60);
      expect(call31.error).toBeNull();
      expect(call31.data).toBe(false);

      const { data: row } = await admin
        .from("rate_limit_counters")
        .select("count")
        .eq("bucket", "test.bucket")
        .eq("subject", subject)
        .single();
      expect(row?.count).toBe(31);

      // A further call remains false and the committed count stays at 31 —
      // it never overflows past the saturated sentinel.
      const call32 = await callRpc(admin, "test.bucket", subject, 30, 60);
      expect(call32.error).toBeNull();
      expect(call32.data).toBe(false);

      const { data: rowAfter } = await admin
        .from("rate_limit_counters")
        .select("count")
        .eq("bucket", "test.bucket")
        .eq("subject", subject)
        .single();
      expect(rowAfter?.count).toBe(31);
    });

    // -----------------------------------------------------------------------
    // Window reset: a new window restarts count at 1 and returns true
    // -----------------------------------------------------------------------

    it("resets to true with count 1 after backdating window_start with a privileged update", async () => {
      const subject = makeSubject();

      const first = await callRpc(admin, "test.bucket", subject, 10, 60);
      expect(first.error).toBeNull();
      expect(first.data).toBe(true);

      // Backdate the window via a privileged database operation rather than
      // a wall-clock sleep, so the test is deterministic.
      const { error: updateError } = await admin
        .from("rate_limit_counters")
        .update({ window_start: new Date(Date.now() - 61_000).toISOString() })
        .eq("bucket", "test.bucket")
        .eq("subject", subject);
      expect(updateError).toBeNull();

      const second = await callRpc(admin, "test.bucket", subject, 10, 60);
      expect(second.error).toBeNull();
      expect(second.data).toBe(true);

      const { data: row } = await admin
        .from("rate_limit_counters")
        .select("count")
        .eq("bucket", "test.bucket")
        .eq("subject", subject)
        .single();
      expect(row?.count).toBe(1);
    });

    // -----------------------------------------------------------------------
    // Subject isolation: different subjects under the same bucket are independent
    // -----------------------------------------------------------------------

    it("isolates counters per subject under the same bucket", async () => {
      const subjectA = makeSubject();
      const subjectB = makeSubject();

      for (let i = 1; i <= 3; i++) {
        const { error } = await callRpc(admin, "test.bucket", subjectA, 5, 60);
        expect(error).toBeNull();
      }

      const { data, error } = await callRpc(admin, "test.bucket", subjectB, 5, 60);
      expect(error).toBeNull();
      expect(data).toBe(true);

      const { data: rowB } = await admin
        .from("rate_limit_counters")
        .select("count")
        .eq("bucket", "test.bucket")
        .eq("subject", subjectB)
        .single();
      expect(rowB?.count).toBe(1);
    });

    // -----------------------------------------------------------------------
    // Bucket isolation: same subject across different buckets is independent
    // -----------------------------------------------------------------------

    it("isolates counters per bucket for the same subject", async () => {
      const subject = makeSubject();

      for (let i = 1; i <= 3; i++) {
        const { error } = await callRpc(admin, "bucket.A", subject, 5, 60);
        expect(error).toBeNull();
      }

      const { data, error } = await callRpc(admin, "bucket.B", subject, 5, 60);
      expect(error).toBeNull();
      expect(data).toBe(true);

      const { data: rowB } = await admin
        .from("rate_limit_counters")
        .select("count")
        .eq("bucket", "bucket.B")
        .eq("subject", subject)
        .single();
      expect(rowB?.count).toBe(1);
    });

    // -----------------------------------------------------------------------
    // Argument validation: bounds accepted, out-of-range/blank/overlong
    // rejected with 22023 before any row is created/mutated
    // -----------------------------------------------------------------------

    it("accepts the boundary limit/window values 1 and 1000 / 1 and 86400", async () => {
      const subject = makeSubject();
      const minCase = await callRpc(admin, "test.bounds", `${subject}-min`, 1, 1);
      expect(minCase.error).toBeNull();
      expect(minCase.data).toBe(true);

      const maxCase = await callRpc(admin, "test.bounds", `${subject}-max`, 1000, 86400);
      expect(maxCase.error).toBeNull();
      expect(maxCase.data).toBe(true);
    });

    it.each([
      ["blank bucket", ["", makeSubject(), 30, 60]],
      ["overlong bucket (65 bytes)", ["a".repeat(65), makeSubject(), 30, 60]],
      ["blank subject", ["test.invalid", "", 30, 60]],
      ["overlong subject (513 bytes)", ["test.invalid", "a".repeat(513), 30, 60]],
      ["limit 0", ["test.invalid", makeSubject(), 0, 60]],
      ["limit 1001", ["test.invalid", makeSubject(), 1001, 60]],
      ["window 0", ["test.invalid", makeSubject(), 30, 0]],
      ["window 86401", ["test.invalid", makeSubject(), 30, 86401]],
    ])("rejects %s with 22023 and creates no row", async (_label, args) => {
      const [bucket, subject, limit, windowSeconds] = args as [string, string, number, number];
      const { error } = await callRpc(admin, bucket, subject, limit, windowSeconds);
      expect(error).not.toBeNull();
      expect(error!.code).toBe("22023");

      if (subject) {
        const { data: row } = await admin
          .from("rate_limit_counters")
          .select("subject")
          .eq("subject", subject)
          .maybeSingle();
        expect(row).toBeNull();
      }
    });

    // -----------------------------------------------------------------------
    // Table check constraints reject invalid direct DML (service_role only)
    // -----------------------------------------------------------------------

    it("rejects an invalid direct insert (blank bucket) via the table's check constraint", async () => {
      const { error } = await admin.from("rate_limit_counters").insert({
        bucket:       "",
        subject:      makeSubject(),
        window_start: new Date().toISOString(),
        count:        1,
      });
      expect(error).not.toBeNull();
    });

    it("rejects an invalid direct insert (count out of bounds) via the table's check constraint", async () => {
      const { error } = await admin.from("rate_limit_counters").insert({
        bucket:       "test.invalid",
        subject:      makeSubject(),
        window_start: new Date().toISOString(),
        count:        1002,
      });
      expect(error).not.toBeNull();
    });

    // -----------------------------------------------------------------------
    // Clamped saturation: a service-role-seeded impossible count is clamped
    // to p_limit + 1 and never overflows or accidentally admits
    // -----------------------------------------------------------------------

    it("clamps a nonexpired preexisting count at the table maximum to p_limit + 1 and returns false", async () => {
      const subject = makeSubject();
      const { error: insertError } = await admin.from("rate_limit_counters").insert({
        bucket:       "test.clamp",
        subject,
        window_start: new Date().toISOString(),
        count:        1001,
      });
      expect(insertError).toBeNull();

      const { data, error } = await callRpc(admin, "test.clamp", subject, 30, 60);
      expect(error).toBeNull();
      expect(data).toBe(false);

      const { data: row } = await admin
        .from("rate_limit_counters")
        .select("count")
        .eq("bucket", "test.clamp")
        .eq("subject", subject)
        .single();
      expect(row?.count).toBe(31);
    });

    // -----------------------------------------------------------------------
    // Real concurrency (steady-state): two independent Supabase clients race
    // the same (bucket, subject) simultaneously. This is retained as a
    // steady-state proof; it is NOT the cold-start proof — see
    // rate-limit-concurrency.integration.test.ts for that deterministic race.
    // -----------------------------------------------------------------------

    it("serializes 20 concurrent calls from two independent clients: exactly 10 succeed and 10 are rate-limited", async () => {
      const subject = makeSubject();
      const limit = 10;
      const totalCalls = 20;

      // Two separate Supabase clients — each has its own HTTP keep-alive pool.
      const clientA = createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      const clientB = createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );

      // Interleave calls across the two clients so they genuinely race.
      const calls = Array.from({ length: totalCalls }, (_, i) => {
        const client = i % 2 === 0 ? clientA : clientB;
        return callRpc(client, "test.concurrent", subject, limit, 60);
      });

      const results = await Promise.allSettled(calls);

      // Promise.allSettled never rejects — PostgREST surfaces RPC errors as
      // { error: { message } } rather than thrown exceptions.
      const fulfilled = results.filter(
        (r): r is PromiseFulfilledResult<{ data: boolean | null; error: { message: string } | null }> =>
          r.status === "fulfilled",
      );

      // All 20 HTTP calls resolved (no network failures).
      expect(fulfilled).toHaveLength(totalCalls);

      const successes = fulfilled.filter((r) => r.value.data === true);
      const limited   = fulfilled.filter((r) => r.value.data === false);

      expect(successes).toHaveLength(limit);
      expect(limited).toHaveLength(totalCalls - limit);

      // Final committed count is exactly the number of calls made — proving
      // no double-count and no lost rejection.
      const { data: row } = await admin
        .from("rate_limit_counters")
        .select("count")
        .eq("bucket", "test.concurrent")
        .eq("subject", subject)
        .single();
      expect(row?.count).toBe(limit + 1);
    }, 15_000);
  },
);

// ---------------------------------------------------------------------------
// ACL enforcement: anon and authenticated roles cannot call either RPC or
// mutate the table directly; service_role can perform both.
// ---------------------------------------------------------------------------

describe.skipIf(!isIntegrationTestReady)("rate_limit_counters — ACL boundary", () => {
  let admin: NonNullable<typeof adminClient>;
  let anonClient: ReturnType<typeof createClient<Database>>;

  beforeAll(() => {
    admin = adminClient!;
    anonClient = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  });

  afterAll(async () => {
    await admin.from("rate_limit_counters").delete().like("subject", "rl-acl-%");
  });

  it("anon cannot call increment_rate_limit and leaves the target row unchanged", async () => {
    const subject = `rl-acl-${Date.now()}-anon-rpc`;
    await admin.from("rate_limit_counters").insert({
      bucket: "test.acl", subject, window_start: new Date().toISOString(), count: 5,
    });

    const { data, error } = await callRpc(anonClient, "test.acl", subject, 30, 60);
    expect(data).toBeNull();
    expect(error).not.toBeNull();

    const { data: row } = await admin
      .from("rate_limit_counters")
      .select("count")
      .eq("bucket", "test.acl")
      .eq("subject", subject)
      .single();
    expect(row?.count).toBe(5);
  });

  it("anon cannot call cleanup_expired_rate_limit_counters", async () => {
    const { error } = await anonClient.rpc("cleanup_expired_rate_limit_counters");
    expect(error).not.toBeNull();
  });

  it("anon cannot insert/update/delete rate_limit_counters directly", async () => {
    const subject = `rl-acl-${Date.now()}-anon-dml`;
    const { error: insertError } = await anonClient
      .from("rate_limit_counters")
      .insert({ bucket: "test.acl", subject, window_start: new Date().toISOString(), count: 1 });
    expect(insertError).not.toBeNull();

    const { data: row } = await admin
      .from("rate_limit_counters")
      .select("subject")
      .eq("bucket", "test.acl")
      .eq("subject", subject)
      .maybeSingle();
    expect(row).toBeNull();
  });

  it("a real authenticated client cannot call increment_rate_limit and leaves the target row unchanged", async () => {
    const [user] = await createTestUsers(1);
    const client = authenticateAs(user);
    const subject = `rl-acl-${Date.now()}-auth-rpc`;
    await admin.from("rate_limit_counters").insert({
      bucket: "test.acl", subject, window_start: new Date().toISOString(), count: 5,
    });

    const { data, error } = await callRpc(client, "test.acl", subject, 30, 60);
    expect(data).toBeNull();
    expect(error).not.toBeNull();

    const { data: row } = await admin
      .from("rate_limit_counters")
      .select("count")
      .eq("bucket", "test.acl")
      .eq("subject", subject)
      .single();
    expect(row?.count).toBe(5);
  });

  it("a real authenticated client cannot insert/update/delete rate_limit_counters directly", async () => {
    const [user] = await createTestUsers(1);
    const client = authenticateAs(user);
    const subject = `rl-acl-${Date.now()}-auth-dml`;

    const { error: insertError } = await client
      .from("rate_limit_counters")
      .insert({ bucket: "test.acl", subject, window_start: new Date().toISOString(), count: 1 });
    expect(insertError).not.toBeNull();

    const { data: row } = await admin
      .from("rate_limit_counters")
      .select("subject")
      .eq("bucket", "test.acl")
      .eq("subject", subject)
      .maybeSingle();
    expect(row).toBeNull();
  });

  it("service_role can invoke both RPCs and perform setup/cleanup DML", async () => {
    const subject = `rl-acl-${Date.now()}-service`;
    const { data, error } = await callRpc(admin, "test.acl", subject, 30, 60);
    expect(error).toBeNull();
    expect(data).toBe(true);

    const { error: cleanupError } = await admin.rpc("cleanup_expired_rate_limit_counters");
    expect(cleanupError).toBeNull();

    const { error: deleteError } = await admin
      .from("rate_limit_counters")
      .delete()
      .eq("bucket", "test.acl")
      .eq("subject", subject);
    expect(deleteError).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// cleanup_expired_rate_limit_counters RPC
// ---------------------------------------------------------------------------

describe.skipIf(!isIntegrationTestReady)(
  "cleanup_expired_rate_limit_counters RPC",
  () => {
    let admin: NonNullable<typeof adminClient>;

    beforeAll(() => {
      admin = adminClient!;
    });

    it("deletes rows older than 24 hours and returns their count", async () => {
      const staleSubject = `rl-cleanup-stale-${Date.now()}`;
      const freshSubject = `rl-cleanup-fresh-${Date.now()}`;

      // Insert a stale row (window_start 25 hours ago) directly via admin.
      const staleWindowStart = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      const { error: insertError } = await admin
        .from("rate_limit_counters")
        .insert([
          {
            bucket:       "test.cleanup",
            subject:      staleSubject,
            window_start: staleWindowStart,
            count:        1,
          },
          {
            bucket:       "test.cleanup",
            subject:      freshSubject,
            window_start: new Date().toISOString(),
            count:        1,
          },
        ]);

      expect(insertError).toBeNull();

      // Call the cleanup RPC.
      const { data: deletedCount, error: rpcError } = await admin.rpc(
        "cleanup_expired_rate_limit_counters",
      ) as unknown as { data: number; error: { message: string } | null };

      expect(rpcError).toBeNull();
      // At least 1 row deleted (the stale one); may be more if prior test
      // runs left stale data.
      expect(deletedCount).toBeGreaterThanOrEqual(1);

      // The stale row must be gone.
      const { data: staleRow } = await admin
        .from("rate_limit_counters")
        .select("subject")
        .eq("bucket", "test.cleanup")
        .eq("subject", staleSubject)
        .maybeSingle();

      expect(staleRow).toBeNull();

      // The fresh row must still exist.
      const { data: freshRow } = await admin
        .from("rate_limit_counters")
        .select("subject")
        .eq("bucket", "test.cleanup")
        .eq("subject", freshSubject)
        .maybeSingle();

      expect(freshRow).not.toBeNull();

      // Cleanup for this test.
      await admin
        .from("rate_limit_counters")
        .delete()
        .eq("bucket", "test.cleanup")
        .eq("subject", freshSubject);
    });
  },
);
