/**
 * Pair-budget boundary for POST /api/pix/generate.
 *
 * The route runs against the real database and the real rate limiter: the
 * payable edges are built through the real create_expense RPC and every
 * spend lands in the real rate_limit_counters table. Only the next/headers
 * cookie transport is stubbed (the jar holds the actor's real sign-in
 * tokens), mirroring the pix persistence integration test.
 *
 * Every test provisions its own users, so the per-pair subject
 * ("<callerId>:<recipientId>") is unique per run: a saturated pair from a
 * previous run can never leak into a later one.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  createExpense,
  createGroupWithMembers,
  createTestUsers,
  equalSplitPayload,
  type TestUser,
} from "@/test/integration-helpers";
import { encryptPixKey } from "@/lib/crypto";
import { maskPixKey } from "@/lib/pix";

// server-only unconditionally throws outside a Next.js server bundle. This
// mocks the guard package itself (not business logic), matching the same
// pattern used by every other test that imports a "server-only" module.
vi.mock("server-only", () => ({}));

const cookieJar: Array<{ name: string; value: string }> = [];

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [...cookieJar],
    set: () => {
      // Writes back into a request-scoped cookie store carry no session
      // change these assertions depend on.
    },
  }),
}));

// Imported after the vi.mock factories and the cookieJar declaration: the
// factories close over module state, so the route module must only evaluate
// once that state exists (a static import would resolve them against
// uninitialized bindings).
const { POST } = await import("@/app/api/pix/generate/route");

const AUTH_COOKIE_NAME = `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0]}-auth-token`;

/** exp claim of the real access token — the session's true expiry second. */
function accessTokenExpiry(accessToken: string): number {
  const payloadSegment = accessToken.split(".")[1];
  const payload = JSON.parse(
    Buffer.from(payloadSegment, "base64url").toString("utf8"),
  ) as { exp?: unknown };
  if (typeof payload.exp !== "number") {
    throw new Error("access token carries no exp claim");
  }
  return payload.exp;
}

/**
 * Encode the actor's real sign-in session into the cookie jar the way a
 * browser would have stored it: @supabase/ssr prefixes its base64url
 * encoding with "base64-" (its default cookieEncoding).
 */
function actAs(user: TestUser): void {
  if (!user.accessToken || !user.refreshToken) {
    throw new Error(`user ${user.handle} has no sign-in tokens`);
  }
  const session = {
    access_token: user.accessToken,
    refresh_token: user.refreshToken,
    token_type: "bearer",
    expires_at: accessTokenExpiry(user.accessToken),
  };
  cookieJar.splice(0, cookieJar.length, {
    name: AUTH_COOKIE_NAME,
    value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
  });
}

function pixRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/pix/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Onboards exactly as the app does: real ciphertext through the real RPC. */
async function onboardWithPixKey(user: TestUser, rawKey: string): Promise<void> {
  const encrypted = encryptPixKey(rawKey);
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${user.accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const { error } = await client.rpc("complete_onboarding", {
    p_handle: user.handle,
    p_name: user.name,
    p_pix_key_encrypted: encrypted,
    p_pix_key_hint: maskPixKey(rawKey),
    p_pix_key_type: user.pixKeyType,
  });
  if (error) {
    throw new Error(`complete_onboarding failed for ${user.handle}: ${error.message}`);
  }
}

/**
 * A debtor owing exactly OWED_CENTS to each of two creditors, both with a
 * configured Pix key: two independent payable edges from one caller.
 */
async function setupTwoPayableEdges(): Promise<{
  debtor: TestUser;
  creditorA: TestUser;
  creditorB: TestUser;
  groupId: string;
}> {
  const [debtor, creditorA, creditorB] = await createTestUsers(3, {
    onboarded: false,
    pixKeyType: "random",
  });
  await onboardWithPixKey(debtor, crypto.randomUUID());
  await onboardWithPixKey(creditorA, crypto.randomUUID());
  await onboardWithPixKey(creditorB, crypto.randomUUID());

  const groupId = await createGroupWithMembers(debtor, [creditorA, creditorB]);
  for (const creditor of [creditorA, creditorB]) {
    await createExpense(creditor, {
      groupId,
      title: "Creditor paid",
      totalCents: 10_000,
      payload: equalSplitPayload([creditor.id, debtor.id], 10_000),
    });
  }
  return { debtor, creditorA, creditorB, groupId };
}

async function generate(
  debtor: TestUser,
  recipientId: string,
  groupId: string,
  amountCents = 100,
): Promise<Response> {
  return POST(pixRequest({ recipientUserId: recipientId, amountCents, groupId }));
}

describe.skipIf(!isIntegrationTestReady)("pix generate pair budget boundary", () => {
  beforeAll(() => {
    if (process.env.RATE_LIMIT_DISABLED === "1") {
      throw new Error("the real boundary tests require the limiter to be on");
    }
  });

  it("serves exactly 20 disclosures per pair per day, then 429, while another recipient still succeeds", async () => {
    const { debtor, creditorA, creditorB, groupId } = await setupTwoPayableEdges();
    actAs(debtor);

    for (let spent = 1; spent <= 20; spent += 1) {
      const response = await generate(debtor, creditorA.id, groupId);
      if (response.status !== 200) {
        throw new Error(`disclosure ${spent}/20 already failed: ${response.status}`);
      }
      await response.text();
    }

    const exhausted = await generate(debtor, creditorA.id, groupId);
    expect(exhausted.status).toBe(429);
    expect(await exhausted.json()).toEqual({
      error: "Muitas requisições. Tente novamente em alguns segundos.",
    });

    // The budget is per pair, not per caller: a second payable edge of the
    // same debtor is untouched.
    const otherPair = await generate(debtor, creditorB.id, groupId);
    expect(otherPair.status).toBe(200);
  });

  it("does not spend the pair budget on denials or self-generation", async () => {
    const { debtor, creditorA, creditorB, groupId } = await setupTwoPayableEdges();
    actAs(debtor);

    // Over-edge denial: passes membership, fails the payable edge.
    const denied = await generate(debtor, creditorA.id, groupId, 5_001);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "Acesso negado" });

    // Self-generation skips the pair bucket entirely.
    const self = await generate(debtor, debtor.id, groupId);
    expect(self.status).toBe(200);
    await self.text();

    // All 20 pair tokens are still there for the genuine edge.
    for (let spent = 1; spent <= 20; spent += 1) {
      const response = await generate(debtor, creditorA.id, groupId);
      if (response.status !== 200) {
        throw new Error(
          `disclosure ${spent}/20 failed after a denial and a self-generation: ${response.status}`,
        );
      }
      await response.text();
    }
    const exhausted = await generate(debtor, creditorA.id, groupId);
    expect(exhausted.status).toBe(429);

    // The caller bucket (60/min) had room left: creditorB still gets through.
    const otherPair = await generate(debtor, creditorB.id, groupId);
    expect(otherPair.status).toBe(200);
  });
});
