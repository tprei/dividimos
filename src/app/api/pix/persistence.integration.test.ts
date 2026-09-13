/**
 * Persistence boundary for POST /api/pix/generate.
 *
 * The route runs against the real database, real AES-256-GCM crypto and the
 * real Supabase session reader: both users onboard through the same
 * complete_onboarding RPC the app uses (with a real encryptPixKey ciphertext),
 * the payable edge is built through the real create_expense RPC, and the
 * route's createClient() parses a genuine Supabase session. The only stub is
 * the next/headers cookie transport — the jar holds the actor's real
 * sign-in tokens encoded exactly the way @supabase/ssr writes them, so the
 * deployed cookie flow is what authenticates every call.
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
import { generatePixCopiaECola, maskPixKey } from "@/lib/pix";

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

// supabase-js derives its default storage key from the project URL host and
// src/lib/supabase/server.ts sets no custom cookieOptions.name, so this is
// the cookie the server client reads in a real request.
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

function clearSession(): void {
  cookieJar.splice(0, cookieJar.length);
}

function pixRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/pix/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Onboards exactly as the app does: real ciphertext through the real RPC. */
async function onboardWithPixKey(user: TestUser, rawKey: string): Promise<string> {
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
  return encrypted;
}

describe.skipIf(!isIntegrationTestReady)("pix generate persistence boundary", () => {
  const TOTAL_CENTS = 10_000;
  const OWED_CENTS = 5_000;

  let debtor: TestUser;
  let creditor: TestUser;
  let outsider: TestUser;
  let groupId!: string;
  let debtorRawKey!: string;
  let creditorRawKey!: string;
  let creditorEncryptedKey!: string;

  beforeAll(async () => {
    [debtor, creditor, outsider] = await createTestUsers(3, {
      onboarded: false,
      pixKeyType: "random",
    });

    debtorRawKey = crypto.randomUUID();
    creditorRawKey = crypto.randomUUID();
    await onboardWithPixKey(debtor, debtorRawKey);
    creditorEncryptedKey = await onboardWithPixKey(creditor, creditorRawKey);

    // Real payable edge: the creditor paid everything and split evenly, so
    // the debtor owes exactly OWED_CENTS to the creditor.
    groupId = await createGroupWithMembers(debtor, [creditor]);
    await createExpense(creditor, {
      groupId,
      title: "Creditor paid",
      totalCents: TOTAL_CENTS,
      payload: equalSplitPayload([creditor.id, debtor.id], TOTAL_CENTS),
    });
  });

  it("discloses the decrypted key across a real payable edge, exactly once", async () => {
    actAs(debtor);
    const response = await POST(
      pixRequest({
        recipientUserId: creditor.id,
        amountCents: OWED_CENTS,
        groupId,
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const text = await response.text();
    const body = JSON.parse(text) as { copiaECola: string };
    expect(Object.keys(body)).toEqual(["copiaECola"]);
    expect(body.copiaECola).toBe(
      generatePixCopiaECola({
        pixKey: creditorRawKey,
        merchantName: creditor.name,
        merchantCity: "SAO PAULO",
        amountCents: OWED_CENTS,
      }),
    );

    // The key is disclosed exactly once — inside the BR Code — never in any
    // other field, and the stored ciphertext never leaves the database.
    expect(text.split(body.copiaECola).join("")).not.toContain(creditorRawKey);
    expect(text).not.toContain(creditorEncryptedKey);
  });

  it("serves the caller's own key on self-request without a payable edge", async () => {
    actAs(debtor);
    const response = await POST(
      pixRequest({
        recipientUserId: debtor.id,
        amountCents: TOTAL_CENTS,
        groupId,
      }),
    );

    expect(response.status).toBe(200);
    const text = await response.text();
    const body = JSON.parse(text) as { copiaECola: string };
    expect(body.copiaECola).toBe(
      generatePixCopiaECola({
        pixKey: debtorRawKey,
        merchantName: debtor.name,
        merchantCity: "SAO PAULO",
        amountCents: TOTAL_CENTS,
      }),
    );
    expect(text.split(body.copiaECola).join("")).not.toContain(debtorRawKey);
    expect(text).not.toContain(creditorEncryptedKey);
  });

  it("rejects an unauthenticated caller with 401", async () => {
    clearSession();
    const response = await POST(
      pixRequest({
        recipientUserId: creditor.id,
        amountCents: OWED_CENTS,
        groupId,
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Não autenticado" });
  });

  it("rejects a non-member caller and an over-edge amount with one denial", async () => {
    actAs(outsider);
    const nonMember = await POST(
      pixRequest({
        recipientUserId: creditor.id,
        amountCents: OWED_CENTS,
        groupId,
      }),
    );

    actAs(debtor);
    const overEdge = await POST(
      pixRequest({
        recipientUserId: creditor.id,
        amountCents: OWED_CENTS + 1,
        groupId,
      }),
    );

    expect(nonMember.status).toBe(403);
    expect(overEdge.status).toBe(403);
    // Byte-identical denial: no probing whether a co-member has a key or owes.
    const nonMemberText = await nonMember.text();
    const overEdgeText = await overEdge.text();
    expect(nonMemberText).toBe(overEdgeText);
    expect(JSON.parse(overEdgeText)).toEqual({ error: "Acesso negado" });
    expect(overEdgeText).not.toContain(creditorRawKey);
    expect(overEdgeText).not.toContain(debtorRawKey);
    expect(overEdgeText).not.toContain(creditorEncryptedKey);
  });
});
