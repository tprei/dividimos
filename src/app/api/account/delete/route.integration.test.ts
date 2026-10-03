import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { exportPKCS8, generateKeyPair, jwtVerify } from "jose";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createExpense,
  createGroupWithMembers,
  createTestUsers,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";
import { encryptPixKey } from "@/lib/crypto";
import { decodeAccountDeletionResponse } from "@/lib/account-deletion";

vi.mock("server-only", () => ({}));

const cookieJar: Array<{ name: string; value: string }> = [];

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [...cookieJar],
    set: () => {},
  }),
}));

// The only injected seam for the committed-RPC-then-Auth-failure case is the
// Auth transport: the real SQL runs, and deleteUser is made to fail exactly
// once before succeeding on the retry.
const authDeleteState = vi.hoisted(() => ({ failNext: false }));

const decodeState = vi.hoisted(() => ({ forceNullGroups: false }));

vi.mock("@/lib/account-deletion", async (importOriginal) => {
  const actual = await importOriginal<{
    decodeAccountDeletionGroups: (raw: unknown) => import("@/lib/account-deletion").AccountDeletionGroup[] | null;
    decodeAccountDeletionResponse: typeof import("@/lib/account-deletion").decodeAccountDeletionResponse;
  }>();
  return {
    ...actual,
    decodeAccountDeletionGroups: (raw: unknown) =>
      decodeState.forceNullGroups ? null : actual.decodeAccountDeletionGroups(raw),
  };
});

vi.mock("@/lib/supabase/admin", async (importOriginal) => {
  const actual = await importOriginal<{
    createAdminClient: () => ReturnType<
      typeof import("@/lib/supabase/admin").createAdminClient
    >;
  }>();
  return {
    createAdminClient: () => {
      const client = actual.createAdminClient();
      const originalDelete = client.auth.admin.deleteUser.bind(client.auth.admin);
      client.auth.admin.deleteUser = async (id: string, shouldSoftDelete?: boolean) => {
        if (authDeleteState.failNext) {
          authDeleteState.failNext = false;
          throw new Error("fetch failed");
        }
        return originalDelete(id, shouldSoftDelete);
      };
      return client;
    },
  };
});

// Imported after the vi.mock factories: the route module must only evaluate
// once the cookie jar exists.
const { POST } = await import("@/app/api/account/delete/route");

// Sign in with Apple revocation fixtures: one server key, a dispatcher that
// fakes only appleid.apple.com and forwards everything else (Supabase) to the
// real fetch, and the stored-credential helpers.
const appleKeys = await generateKeyPair("ES256", { extractable: true });
const applePrivateKeyPem = await exportPKCS8(appleKeys.privateKey);

type AppleRevokePlan = { status: number; body: string } | { throw: true } | null;
let appleRevokePlan: AppleRevokePlan = null;
const revokeRequests: URLSearchParams[] = [];
const realFetch = globalThis.fetch;
const appleAwareFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url === "https://appleid.apple.com/auth/revoke") {
    revokeRequests.push(new URLSearchParams(String(init?.body ?? "")));
    if (appleRevokePlan !== null && "throw" in appleRevokePlan) {
      throw new Error("apple unreachable");
    }
    const body = appleRevokePlan !== null && "body" in appleRevokePlan ? appleRevokePlan.body : null;
    return new Response(body, { status: appleRevokePlan === null ? 200 : appleRevokePlan.status });
  }
  return realFetch(input, init);
};

async function insertAppleCredential(userId: string, refreshToken: string): Promise<void> {
  await withPg(async (pg) => {
    await pg.query(
      "insert into public.apple_sign_in_credentials (user_id, apple_subject, refresh_token_encrypted) values ($1, $2, $3)",
      [userId, `apple-sub-${userId.slice(0, 8)}`, encryptPixKey(refreshToken)],
    );
  });
}

async function appleCredentialRowCount(userId: string): Promise<number> {
  return withPg(async (pg) => {
    const result = await pg.query<{ count: number }>(
      "select count(*)::int as count from public.apple_sign_in_credentials where user_id = $1",
      [userId],
    );
    return result.rows[0]?.count ?? 0;
  });
}

async function linkAppleIdentity(userId: string): Promise<void> {
  await withPg(async (pg) => {
    await pg.query(
      `insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
       values ($1, $2, jsonb_build_object('sub', $1::text), 'apple', now(), now(), now())`,
      [`apple-sub-${userId.slice(0, 8)}`, userId],
    );
  });
}

const AUTH_COOKIE_NAME = `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0]}-auth-token`;

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

function actAs(user: TestUser): void {
  if (!user.accessToken || !user.refreshToken) {
    throw new Error(`user ${user.handle} has no sign-in tokens`);
  }
  cookieJar.splice(0, cookieJar.length, {
    name: AUTH_COOKIE_NAME,
    value: `base64-${Buffer.from(JSON.stringify({
      access_token: user.accessToken,
      refresh_token: user.refreshToken,
      token_type: "bearer",
      expires_at: accessTokenExpiry(user.accessToken),
    })).toString("base64url")}`,
  });
}

function clearSession(): void {
  cookieJar.splice(0, cookieJar.length);
}

function deleteRequest(body: unknown): Request {
  return new Request("http://localhost/api/account/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function settledAccount(): Promise<{ leaver: TestUser; groupId: string }> {
  const [leaver, other] = await createTestUsers(2);
  const groupId = await createGroupWithMembers(leaver, [other], "Grupo da exclusão");
  await createExpense(leaver, {
    groupId,
    title: "Conta quitada",
    occurredOn: "2026-09-27",
    totalCents: 2000,
    payload: {
      items: [],
      participants: [
        { kind: "user", userId: leaver.id },
        { kind: "user", userId: other.id },
      ],
      shares: [1000, 1000],
      payers: [{ participantIndex: 0, amountCents: 2000 }],
      itemAssignments: null,
    },
  });
  const settle = await authenticateAs(leaver).rpc("record_settlement", {
    p_operation_id: crypto.randomUUID(),
    p_group_id: groupId,
    p_from_user_id: other.id,
    p_to_user_id: leaver.id,
    p_amount_cents: 1000,
  });
  if (settle.error) throw new Error(`record_settlement failed: ${settle.error.message}`);
  return { leaver, groupId };
}

describe.skipIf(!isIntegrationTestReady)("POST /api/account/delete", () => {
  beforeAll(() => {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("service role key missing");
    }
    vi.stubEnv("APPLE_TEAM_ID", "TEAM123456");
    vi.stubEnv("APPLE_SIGN_IN_KEY_ID", "KEYID99");
    vi.stubEnv("APPLE_SIGN_IN_PRIVATE_KEY", applePrivateKeyPem);
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("requires a session and explicit confirmation and ignores no caller identity override", async () => {
    clearSession();
    const unauthenticated = await POST(deleteRequest({ confirmation: "EXCLUIR" }));
    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toEqual({ ok: false, code: "unauthenticated" });

    const [leaver] = await createTestUsers(1);
    actAs(leaver);

    const missing = await POST(deleteRequest({}));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ ok: false, code: "invalid_argument" });

    const wrongWord = await POST(deleteRequest({ confirmation: "APAGAR" }));
    expect(wrongWord.status).toBe(400);

    const override = await POST(
      deleteRequest({ confirmation: "EXCLUIR", userId: "11111111-1111-1111-1111-111111111111" }),
    );
    expect(override.status).toBe(400);

    const notJson = await POST(deleteRequest("não sou json"));
    expect(notJson.status).toBe(400);
  });

  it("returns structured 409 without calling auth deletion", async () => {
    const [debtor, creditor] = await createTestUsers(2);
    const groupId = await createGroupWithMembers(debtor, [creditor], "Grupo devendo");
    await createExpense(debtor, {
      groupId,
      title: "Jantar",
      occurredOn: "2026-09-27",
      totalCents: 5000,
      payload: {
        items: [],
        participants: [
          { kind: "user", userId: debtor.id },
          { kind: "user", userId: creditor.id },
        ],
        shares: [4000, 1000],
        payers: [{ participantIndex: 1, amountCents: 5000 }],
        itemAssignments: null,
      },
    });

    actAs(debtor);
    const response = await POST(deleteRequest({ confirmation: "EXCLUIR" }));
    expect(response.status).toBe(409);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("outstanding_balance");
    expect(body.groups).toEqual([{ id: groupId, name: "Grupo devendo" }]);

    const profile = await withPg(async (pg) => {
      const result = await pg.query<{ deleted_at: string | null }>(
        "select deleted_at from users where id = $1",
        [debtor.id],
      );
      return result.rows[0]?.deleted_at;
    });
    expect(profile).toBeNull();

    // Refusal details that fail validation are a 500, never a success.
    decodeState.forceNullGroups = true;
    try {
      const malformed = await POST(deleteRequest({ confirmation: "EXCLUIR" }));
      expect(malformed.status).toBe(500);
      expect(await malformed.json()).toEqual({
        ok: false,
        code: "deletion_failed",
        retryable: true,
      });
    } finally {
      decodeState.forceNullGroups = false;
    }
  });

  it("scrubs first, reports auth failure, and completes a retried request", async () => {
    const { leaver } = await settledAccount();
    actAs(leaver);

    authDeleteState.failNext = true;
    const failed = await POST(deleteRequest({ confirmation: "EXCLUIR" }));
    expect(failed.status).toBe(503);
    const failedBody = await failed.json();
    expect(failedBody).toEqual({
      ok: false,
      code: "auth_delete_failed",
      retryable: true,
      userId: leaver.id,
    });

    const scrubbed = await withPg(async (pg) => {
      const result = await pg.query<{ deleted_at: string | null; name: string }>(
        "select deleted_at, name from users where id = $1",
        [leaver.id],
      );
      const authUser = await pg.query("select 1 from auth.users where id = $1", [leaver.id]);
      return {
        deletedAt: result.rows[0]?.deleted_at,
        name: result.rows[0]?.name,
        authRow: authUser.rowCount,
      };
    });
    expect(scrubbed.deletedAt).not.toBeNull();
    expect(scrubbed.name).toBe("Conta excluída");
    expect(scrubbed.authRow).toBe(1);

    const retried = await POST(deleteRequest({ confirmation: "EXCLUIR" }));
    expect(retried.status).toBe(200);
    expect(await retried.json()).toEqual({ ok: true, userId: leaver.id });
  });

  it("never returns success when the RPC fails or refusal details are malformed", async () => {
    const [leaver] = await createTestUsers(1);
    actAs(leaver);

    // The public profile row is gone while the Auth session still resolves:
    // the RPC fails with user_not_found and the route must not report success.
    await withPg(async (pg) => {
      await pg.query("delete from users where id = $1", [leaver.id]);
    });

    const response = await POST(deleteRequest({ confirmation: "EXCLUIR" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      code: "deletion_failed",
      retryable: true,
    });

    const authUser = await withPg(async (pg) => {
      const result = await pg.query("select 1 from auth.users where id = $1", [leaver.id]);
      return result.rowCount;
    });
    expect(authUser).toBe(1);
  });
  it("revokes the Apple authorization, drops the row, then closes access", async () => {
    const { leaver } = await settledAccount();
    await insertAppleCredential(leaver.id, "rt-revoke-main");
    actAs(leaver);
    revokeRequests.length = 0;
    vi.stubGlobal("fetch", appleAwareFetch);
    try {
      const response = await POST(deleteRequest({ confirmation: "EXCLUIR" }));
      expect(response.status).toBe(200);
      expect(await appleCredentialRowCount(leaver.id)).toBe(0);

      expect(revokeRequests).toHaveLength(1);
      const form = revokeRequests[0];
      expect(form.get("token")).toBe("rt-revoke-main");
      expect(form.get("token_type_hint")).toBe("refresh_token");
      expect(form.get("client_id")).toBe("ai.dividimos.app");
      const verifiedSecret = await jwtVerify(form.get("client_secret") ?? "", appleKeys.publicKey);
      expect(verifiedSecret.payload).toMatchObject({
        iss: "TEAM123456",
        sub: "ai.dividimos.app",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("treats an Apple invalid_grant as already revoked and finishes", async () => {
    const { leaver } = await settledAccount();
    await insertAppleCredential(leaver.id, "rt-already-gone");
    actAs(leaver);
    appleRevokePlan = { status: 400, body: JSON.stringify({ error: "invalid_grant" }) };
    vi.stubGlobal("fetch", appleAwareFetch);
    try {
      const response = await POST(deleteRequest({ confirmation: "EXCLUIR" }));
      expect(response.status).toBe(200);
      expect(await appleCredentialRowCount(leaver.id)).toBe(0);
    } finally {
      appleRevokePlan = null;
      vi.unstubAllGlobals();
    }
  });

  it("stops retryably when Apple is unreachable and a retry completes the revocation", async () => {
    const { leaver } = await settledAccount();
    await insertAppleCredential(leaver.id, "rt-retryable");
    actAs(leaver);
    appleRevokePlan = { throw: true };
    vi.stubGlobal("fetch", appleAwareFetch);
    try {
      const failed = await POST(deleteRequest({ confirmation: "EXCLUIR" }));
      expect(failed.status).toBe(503);
      const failedBody = await failed.json();
      expect(decodeAccountDeletionResponse(failedBody)).toEqual({
        ok: false,
        code: "apple_revoke_failed",
        retryable: true,
        userId: leaver.id,
      });

      // The refresh token stays stored and the Auth account was NOT deleted:
      // the retry has to reach the revocation again, not fail on the tombstone.
      expect(await appleCredentialRowCount(leaver.id)).toBe(1);
      const authRows = await withPg(async (pg) => {
        const result = await pg.query<{ count: number }>(
          "select count(*)::int as count from auth.users where id = $1",
          [leaver.id],
        );
        return result.rows[0]?.count ?? 0;
      });
      expect(authRows).toBe(1);

      appleRevokePlan = null;
      const retried = await POST(deleteRequest({ confirmation: "EXCLUIR" }));
      expect(retried.status).toBe(200);
      expect(await appleCredentialRowCount(leaver.id)).toBe(0);
    } finally {
      appleRevokePlan = null;
      vi.unstubAllGlobals();
    }
  });

  it("stops retryably when the Apple server env is missing", async () => {
    const { leaver } = await settledAccount();
    await insertAppleCredential(leaver.id, "rt-no-env");
    actAs(leaver);
    vi.stubEnv("APPLE_TEAM_ID", "");
    vi.stubGlobal("fetch", appleAwareFetch);
    try {
      const response = await POST(deleteRequest({ confirmation: "EXCLUIR" }));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        ok: false,
        code: "apple_revoke_failed",
        retryable: true,
        userId: leaver.id,
      });
      expect(await appleCredentialRowCount(leaver.id)).toBe(1);
    } finally {
      vi.stubEnv("APPLE_TEAM_ID", "TEAM123456");
      vi.unstubAllGlobals();
    }
  });

  it("refuses before deleting anything when a linked Apple ID has no revocable token", async () => {
    const { leaver } = await settledAccount();
    await linkAppleIdentity(leaver.id);
    actAs(leaver);

    const response = await POST(deleteRequest({ confirmation: "EXCLUIR" }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, code: "apple_reauthorization_required" });
    const state = await withPg(async (pg) => {
      const profile = await pg.query<{ deleted_at: string | null }>(
        "select deleted_at from public.users where id = $1",
        [leaver.id],
      );
      const auth = await pg.query<{ deleted_at: string | null }>(
        "select deleted_at from auth.users where id = $1",
        [leaver.id],
      );
      return { profile: profile.rows[0]?.deleted_at, auth: auth.rows[0]?.deleted_at };
    });
    expect(state).toEqual({ profile: null, auth: null });
  });

  it("keeps the token and stops retryably when the signing key is unusable", async () => {
    const { leaver } = await settledAccount();
    await insertAppleCredential(leaver.id, "rt-bad-key");
    actAs(leaver);
    revokeRequests.length = 0;
    vi.stubEnv("APPLE_SIGN_IN_PRIVATE_KEY", "-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----");
    vi.stubGlobal("fetch", appleAwareFetch);
    try {
      const response = await POST(deleteRequest({ confirmation: "EXCLUIR" }));

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        ok: false,
        code: "apple_revoke_failed",
        retryable: true,
        userId: leaver.id,
      });
      expect(await appleCredentialRowCount(leaver.id)).toBe(1);
      expect(revokeRequests).toHaveLength(0);
    } finally {
      vi.stubEnv("APPLE_SIGN_IN_PRIVATE_KEY", applePrivateKeyPem);
      vi.unstubAllGlobals();
    }
  });
});
