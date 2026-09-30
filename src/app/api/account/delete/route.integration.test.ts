import { beforeAll, describe, expect, it, vi } from "vitest";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createExpense,
  createGroupWithMembers,
  createTestUsers,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";

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
  beforeAll(async () => {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("service role key missing");
    }
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
});
