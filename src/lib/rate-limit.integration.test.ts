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
    // Concurrency: FOR UPDATE serializes concurrent calls, no double-count
    // -----------------------------------------------------------------------

    it("serializes concurrent calls for the same (bucket, subject)", async () => {
      const subject = makeSubject();
      const concurrency = 5;
      const limit = 20;

      const results = await Promise.allSettled(
        Array.from({ length: concurrency }, () =>
          callRpc(admin, "test.concurrent", subject, limit, 60),
        ),
      );

      const successes = results.filter((r) => r.status === "fulfilled");
      expect(successes.length).toBe(concurrency);

      const counts = successes
        .map((r) => (r.status === "fulfilled" ? (r.value as { data: number | null }).data : null))
        .filter((c): c is number => c !== null)
        .sort((a, b) => a - b);

      expect(counts).toHaveLength(concurrency);
      expect(counts[counts.length - 1]).toBe(concurrency);
      const unique = new Set(counts);
      expect(unique.size).toBe(concurrency);
    });
  },
);
