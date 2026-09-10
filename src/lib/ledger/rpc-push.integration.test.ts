import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createTestUsers,
  expectRpcError,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";

type ClaimResult = { subscriptionId: string; transferred: boolean };

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
  return data as unknown as ClaimResult;
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
