import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { forceLockContentionRace } from "@/test/db-race-barrier";
import type { Database } from "@/types/database";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createTestUsers,
  decodeRpcData,
  expectRpcError,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";
import type { ValidationResult } from "@/lib/expense-money";
import { bool, exactKeys, fail, id, isRecord } from "@/lib/ledger/decode-expense";
import type { WireIssue } from "@/types/ledger";

type ClaimResult = { subscriptionId: string; transferred: boolean };

function decodeClaimResult(
  raw: unknown,
): ValidationResult<ClaimResult, WireIssue> {
  if (!isRecord(raw)) return fail(["claim"]);
  const keys = exactKeys(raw, ["subscriptionId", "transferred"], []);
  if (!keys.ok) return keys;
  const subscriptionId = id(raw.subscriptionId, ["subscriptionId"]);
  if (!subscriptionId.ok) return subscriptionId;
  const transferred = bool(raw.transferred, ["transferred"]);
  if (!transferred.ok) return transferred;
  return {
    ok: true,
    value: { subscriptionId: subscriptionId.value, transferred: transferred.value },
  };
}

function serviceClient(): SupabaseClient<Database> {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

async function claim(
  client: SupabaseClient<Database>,
  userId: string,
  endpoint: string,
  channel: "web" | "fcm" = "web",
): Promise<ClaimResult> {
  const { data, error } = await client.rpc("claim_push_subscription", {
    p_user_id: userId,
    p_channel: channel,
    p_endpoint_digest: `\\x${Buffer.from(endpoint, "utf8").toString("hex")}`,
    p_subscription_encrypted: `encrypted:${endpoint}`,
  });
  if (error) throw new Error(error.message);
  return decodeRpcData("claim_push_subscription", data, decodeClaimResult);
}

async function ownersOf(endpoint: string): Promise<string[]> {
  return withPg(async (pg) => {
    const result = await pg.query<{ user_id: string }>(
      "SELECT user_id FROM push_subscriptions WHERE endpoint_digest = decode($1, 'hex')",
      [Buffer.from(endpoint, "utf8").toString("hex")],
    );
    return result.rows.map((row) => row.user_id);
  });
}

describe.skipIf(!isIntegrationTestReady)("claim_push_subscription", () => {
  let userA: TestUser;
  let userB: TestUser;
  let service: SupabaseClient<Database>;

  beforeAll(async () => {
    [userA, userB] = await createTestUsers(2);
    service = serviceClient();
  });

  it("gives one endpoint exactly one owner", async () => {
    const endpoint = `https://push.example.com/${crypto.randomUUID()}`;

    const first = await claim(service, userA.id, endpoint);
    expect(first.transferred).toBe(false);
    expect(await ownersOf(endpoint)).toEqual([userA.id]);

    // The same physical device now belongs to B, so A stops receiving.
    const second = await claim(service, userB.id, endpoint);
    expect(second.transferred).toBe(true);
    expect(await ownersOf(endpoint)).toEqual([userB.id]);
    expect(second.subscriptionId).toBe(first.subscriptionId);
  });

  it("re-claiming for the same account is not a transfer and stays one row", async () => {
    const endpoint = `https://push.example.com/${crypto.randomUUID()}`;

    await claim(service, userA.id, endpoint);
    const again = await claim(service, userA.id, endpoint, "fcm");

    expect(again.transferred).toBe(false);
    expect(await ownersOf(endpoint)).toEqual([userA.id]);
  });

  it("settles simultaneous claims into one row with one owner", async () => {
    const databaseUrl = process.env.SUPABASE_DB_URL ?? "";
    if (!databaseUrl) throw new Error("SUPABASE_DB_URL is required for contention tests");

    const endpoint = `https://push.example.com/${crypto.randomUUID()}`;
    const initial = await claim(service, userA.id, endpoint);
    expect(initial.transferred).toBe(false);

    // The upsert locks the row behind the unique endpoint_digest, so holding
    // that exact row forces B's transfer and A's refresh to queue inside
    // PostgreSQL. The `transferred` read is race-dependent, so only the
    // stored outcome is pinned.
    const hexDigest = Buffer.from(endpoint, "utf8").toString("hex");
    const { result, contention } = await forceLockContentionRace(
      databaseUrl,
      {
        lockSql:
          "select id from public.push_subscriptions where endpoint_digest = decode($1, 'hex') for update",
        lockParams: [hexDigest],
        queryContains: ["claim_push_subscription"],
        expectedRacers: 2,
      },
      () =>
        Promise.allSettled([
          claim(service, userB.id, endpoint),
          claim(service, userA.id, endpoint, "fcm"),
        ]),
    );

    expect(contention.observed).toBe(true);
    const claims = result.map((outcome) => {
      if (outcome.status === "rejected") throw new Error(String(outcome.reason));
      return outcome.value;
    });
    // Both claims address the same row: a transfer never duplicates or
    // renames it.
    for (const outcome of claims) {
      expect(outcome.subscriptionId).toBe(initial.subscriptionId);
    }

    const rows = await withPg(async (pg) => {
      const stored = await pg.query<{ id: string; user_id: string }>(
        "select id, user_id from push_subscriptions where endpoint_digest = decode($1, 'hex')",
        [hexDigest],
      );
      return stored.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(initial.subscriptionId);
    // Exactly one of the two claimants ends up holding the endpoint.
    expect([userA.id, userB.id]).toContain(rows[0]!.user_id);
    expect(await ownersOf(endpoint)).toEqual([rows[0]!.user_id]);
  });

  it("keeps distinct endpoints of one account independent", async () => {
    const phone = `https://push.example.com/${crypto.randomUUID()}`;
    const laptop = `https://push.example.com/${crypto.randomUUID()}`;

    await claim(service, userA.id, phone);
    await claim(service, userA.id, laptop);

    expect(await ownersOf(phone)).toEqual([userA.id]);
    expect(await ownersOf(laptop)).toEqual([userA.id]);
  });

  it("rejects an unknown owner and an unknown channel", async () => {
    const endpoint = `https://push.example.com/${crypto.randomUUID()}`;
    expect(
      await expectRpcError(
        service.rpc("claim_push_subscription", {
          p_user_id: crypto.randomUUID(),
          p_channel: "web",
          p_endpoint_digest: `\\x${Buffer.from(endpoint, "utf8").toString("hex")}`,
          p_subscription_encrypted: "encrypted",
        }),
      ),
    ).toContain("user_not_found");

    expect(
      await expectRpcError(
        service.rpc("claim_push_subscription", {
          p_user_id: userA.id,
          p_channel: "sms",
          p_endpoint_digest: `\\x${Buffer.from(endpoint, "utf8").toString("hex")}`,
          p_subscription_encrypted: "encrypted",
        }),
      ),
    ).toContain("invalid_argument");

    expect(await ownersOf(endpoint)).toEqual([]);
  });

  it("is not callable by a signed-in user", async () => {
    const client = authenticateAs(userA);
    const endpoint = `https://push.example.com/${crypto.randomUUID()}`;

    const { error } = await client.rpc("claim_push_subscription", {
      p_user_id: userA.id,
      p_channel: "web",
      p_endpoint_digest: `\\x${Buffer.from(endpoint, "utf8").toString("hex")}`,
      p_subscription_encrypted: "encrypted",
    });

    expect(error).not.toBeNull();
    expect(await ownersOf(endpoint)).toEqual([]);
  });
});
