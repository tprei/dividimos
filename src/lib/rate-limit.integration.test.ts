import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  adminClient,
  isIntegrationTestReady,
} from "@/test/integration-setup";

function makeSubject(): string {
  return `rl-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function callRpc(
  client: ReturnType<typeof createClient<Database>>,
  bucket: string,
  subject: string,
  limit: number,
  windowSeconds: number,
): Promise<{ data: number | null; error: { message: string } | null }> {
  return client.rpc("increment_rate_limit", {
    p_bucket:         bucket,
    p_subject:        subject,
    p_limit:          limit,
    p_window_seconds: windowSeconds,
  }) as unknown as { data: number | null; error: { message: string } | null };
}

describe.skipIf(!isIntegrationTestReady)(
  "increment_rate_limit RPC — behavior",
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
    // Happy path: counts up correctly
    // -----------------------------------------------------------------------

    it("returns counts 1-5 for 5 calls under a limit of 10", async () => {
      const subject = makeSubject();

      for (let i = 1; i <= 5; i++) {
        const { data, error } = await callRpc(admin, "test.bucket", subject, 10, 60);
        expect(error).toBeNull();
        expect(data).toBe(i);
      }
    });

    // -----------------------------------------------------------------------
    // Exceed path: raises rate_limited on the call that goes over
    // -----------------------------------------------------------------------

    it("raises rate_limited on the call that exceeds the limit", async () => {
      const subject = makeSubject();

      for (let i = 1; i <= 5; i++) {
        const { error } = await callRpc(admin, "test.bucket", subject, 5, 60);
        expect(error).toBeNull();
      }

      const { error } = await callRpc(admin, "test.bucket", subject, 5, 60);
      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/rate_limited/);
    });

    // -----------------------------------------------------------------------
    // Window reset: a new short window restarts count at 1
    // -----------------------------------------------------------------------

    it("resets count to 1 after the window expires", async () => {
      const subject = makeSubject();

      const first = await callRpc(admin, "test.bucket", subject, 10, 1);
      expect(first.error).toBeNull();
      expect(first.data).toBe(1);

      await new Promise((resolve) => setTimeout(resolve, 1100));

      const second = await callRpc(admin, "test.bucket", subject, 10, 1);
      expect(second.error).toBeNull();
      expect(second.data).toBe(1);
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
      expect(data).toBe(1);
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
      expect(data).toBe(1);
    });

    // -----------------------------------------------------------------------
    // Real concurrency: two independent Supabase clients race the same
    // (bucket, subject) simultaneously. The FOR UPDATE row lock must serialize
    // them so no double-count occurs and exactly limit calls succeed.
    //
    // Using two separate createClient instances ensures separate HTTP
    // connections to PostgREST, preventing any single-connection serialization
    // that would give false confidence.
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
        (r): r is PromiseFulfilledResult<{ data: number | null; error: { message: string } | null }> =>
          r.status === "fulfilled",
      );

      // All 20 HTTP calls resolved (no network failures).
      expect(fulfilled).toHaveLength(totalCalls);

      const successes = fulfilled.filter((r) => r.value.error === null);
      const limited   = fulfilled.filter((r) => r.value.error !== null && r.value.error.message.includes("rate_limited"));

      expect(successes).toHaveLength(limit);
      expect(limited).toHaveLength(totalCalls - limit);

      // Counts from successful calls must be the integers 1..limit (no gaps,
      // no duplicates) — proving the FOR UPDATE lock prevented double-counting.
      const counts = successes
        .map((r) => r.value.data as number)
        .sort((a, b) => a - b);

      expect(counts).toEqual(Array.from({ length: limit }, (_, i) => i + 1));
    }, 15_000);
  },
);

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
