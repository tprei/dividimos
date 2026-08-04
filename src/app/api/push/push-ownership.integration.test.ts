import { describe, expect, it } from "vitest";
import {
  adminClient,
  isIntegrationTestReady,
  registerTestUser,
} from "@/test/integration-setup";
import {
  authenticateAs,
  createTestUsers,
} from "@/test/integration-helpers";

/**
 * #483 — push subscription ownership at the data layer.
 *
 * Exercises the claim_push_subscription / release_push_subscription RPCs and
 * the extended enforce_push_subscription_cap trigger added by migration
 * 20260815130000_push_subscription_ownership.sql. The unit suite covers the
 * route layer; this proves the cross-account transfer, owner-scoped release,
 * cap, and concurrency guarantees hold against the real database.
 */
describe.skipIf(!isIntegrationTestReady)(
  "push subscription ownership (#483)",
  () => {
    async function rowsFor(channel: string, fingerprint: string) {
      const { data, error } = await adminClient!
        .from("push_subscriptions")
        .select("id, user_id, subscription")
        .eq("channel", channel)
        .eq("fingerprint", fingerprint);
      if (error) throw error;
      return data ?? [];
    }

    it("transfers a fingerprint to the latest claimant (A-then-B leaves one row owned by B)", async () => {
      const [a, b] = await createTestUsers(2);
      registerTestUser(a.id);
      registerTestUser(b.id);
      const aClient = authenticateAs(a);
      const bClient = authenticateAs(b);
      const fp = `fp-transfer-${a.id}-${b.id}`;

      const { error: aErr } = await aClient.rpc("claim_push_subscription", {
        p_channel: "web",
        p_fingerprint: fp,
        p_subscription: "sub-a",
      });
      expect(aErr).toBeNull();

      const { error: bErr } = await bClient.rpc("claim_push_subscription", {
        p_channel: "web",
        p_fingerprint: fp,
        p_subscription: "sub-b",
      });
      expect(bErr).toBeNull();

      const rows = await rowsFor("web", fp);
      expect(rows).toHaveLength(1);
      expect(rows[0].user_id).toBe(b.id);
      expect(rows[0].subscription).toBe("sub-b");
    });

    it("releases only the caller's own subscription", async () => {
      const [a, b] = await createTestUsers(2);
      registerTestUser(a.id);
      registerTestUser(b.id);
      const aClient = authenticateAs(a);
      const bClient = authenticateAs(b);
      const fp = `fp-release-${a.id}`;

      await aClient.rpc("claim_push_subscription", {
        p_channel: "web",
        p_fingerprint: fp,
        p_subscription: "sub-a",
      });

      // B cannot release A's capability — returns 0, A's row untouched.
      const { data: bDeleted, error: bErr } = await bClient.rpc(
        "release_push_subscription",
        { p_channel: "web", p_fingerprint: fp },
      );
      expect(bErr).toBeNull();
      expect(bDeleted).toBe(0);
      expect(await rowsFor("web", fp)).toHaveLength(1);

      // A releases its own — 1 deleted.
      const { data: aDeleted, error: aErr } = await aClient.rpc(
        "release_push_subscription",
        { p_channel: "web", p_fingerprint: fp },
      );
      expect(aErr).toBeNull();
      expect(aDeleted).toBe(1);
      expect(await rowsFor("web", fp)).toHaveLength(0);
    });

    it("rejects claim_push_subscription without a user JWT (PST01)", async () => {
      // adminClient uses the service-role key, which has no auth.uid().
      const { error } = await adminClient!.rpc("claim_push_subscription", {
        p_channel: "web",
        p_fingerprint: "fp-noauth",
        p_subscription: "sub",
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe("PST01");
    });

    it("caps at 5 subscriptions but allows re-claiming an existing one", async () => {
      const [u] = await createTestUsers(1);
      registerTestUser(u.id);
      const client = authenticateAs(u);

      for (let i = 0; i < 5; i++) {
        const { error } = await client.rpc("claim_push_subscription", {
          p_channel: "web",
          p_fingerprint: `fp-cap-${u.id}-${i}`,
          p_subscription: `sub-${i}`,
        });
        expect(error).toBeNull();
      }

      // A sixth DISTINCT fingerprint hits the cap.
      const { error: sixthErr } = await client.rpc("claim_push_subscription", {
        p_channel: "web",
        p_fingerprint: `fp-cap-${u.id}-5`,
        p_subscription: "sub-5",
      });
      expect(sixthErr).not.toBeNull();
      expect(sixthErr!.code).toBe("PST09");

      // Re-claiming one of the five the caller already owns succeeds — the
      // NEW.user_id = OLD.user_id short-circuit must keep it free at the cap.
      const { error: reclaimErr } = await client.rpc("claim_push_subscription", {
        p_channel: "web",
        p_fingerprint: `fp-cap-${u.id}-0`,
        p_subscription: "sub-0-refreshed",
      });
      expect(reclaimErr).toBeNull();

      const rows = await rowsFor("web", `fp-cap-${u.id}-0`);
      expect(rows).toHaveLength(1);
      expect(rows[0].subscription).toBe("sub-0-refreshed");
    });

    it("does not let a capped user transfer-steal another's subscription", async () => {
      const [a, b] = await createTestUsers(2);
      registerTestUser(a.id);
      registerTestUser(b.id);
      const aClient = authenticateAs(a);
      const bClient = authenticateAs(b);
      const aFp = `fp-xfer-a-${a.id}`;

      // A owns one subscription.
      await aClient.rpc("claim_push_subscription", {
        p_channel: "web",
        p_fingerprint: aFp,
        p_subscription: "sub-a",
      });

      // B fills up to the cap.
      for (let i = 0; i < 5; i++) {
        await bClient.rpc("claim_push_subscription", {
          p_channel: "web",
          p_fingerprint: `fp-xfer-b-${b.id}-${i}`,
          p_subscription: `sub-b-${i}`,
        });
      }

      // B, at the cap, tries to claim A's fingerprint → PST09, A intact.
      const { error } = await bClient.rpc("claim_push_subscription", {
        p_channel: "web",
        p_fingerprint: aFp,
        p_subscription: "sub-a-stolen",
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe("PST09");

      const rows = await rowsFor("web", aFp);
      expect(rows).toHaveLength(1);
      expect(rows[0].user_id).toBe(a.id);
      expect(rows[0].subscription).toBe("sub-a");
    });

    it("leaves exactly one survivor when two accounts claim the same fingerprint concurrently", async () => {
      const [a, b] = await createTestUsers(2);
      registerTestUser(a.id);
      registerTestUser(b.id);
      const aClient = authenticateAs(a);
      const bClient = authenticateAs(b);
      const fp = `fp-concurrent-${a.id}-${b.id}`;

      const [aRes, bRes] = await Promise.all([
        aClient.rpc("claim_push_subscription", {
          p_channel: "web",
          p_fingerprint: fp,
          p_subscription: "sub-a",
        }),
        bClient.rpc("claim_push_subscription", {
          p_channel: "web",
          p_fingerprint: fp,
          p_subscription: "sub-b",
        }),
      ]);
      expect(aRes.error).toBeNull();
      expect(bRes.error).toBeNull();

      const rows = await rowsFor("web", fp);
      expect(rows).toHaveLength(1);
      const owner = rows[0].user_id;
      expect([a.id, b.id]).toContain(owner);
    });
  },
);
