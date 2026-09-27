import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ValidationResult } from "@/lib/expense-money";
import type { WireIssue } from "@/types/ledger";
import { CURRENT_AI_CONSENT_VERSION } from "@/lib/ai-consent";
import { decodeBootstrap, decodeMe } from "@/lib/ledger/decode";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createTestUser,
  expectRpcError,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";

function must<T>(result: ValidationResult<T, WireIssue>): T {
  if (!result.ok) {
    throw new Error(`wire decode failed at [${result.issue.path.join(".")}]`);
  }
  return result.value;
}

async function rawRpc(
  fn: string,
  body: Record<string, unknown>,
  accessToken?: string,
): Promise<{ status: number; message: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/${fn}`,
    { method: "POST", headers, body: JSON.stringify(body) },
  );
  const parsed = (await response.json().catch(() => ({}))) as { message?: string };
  return { status: response.status, message: parsed.message ?? "" };
}

async function consentRow(
  userId: string,
): Promise<{ ai_consent_version: number | null; ai_consent_granted_at: string | null }> {
  return withPg(async (client) => {
    const result = await client.query<{
      ai_consent_version: number | null;
      ai_consent_granted_at: string | null;
    }>(
      "select ai_consent_version, ai_consent_granted_at " +
        "from public.users where id = $1",
      [userId],
    );
    return result.rows[0];
  });
}

async function expectPgCode(run: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await run();
  } catch (error) {
    expect((error as { code?: string }).code).toBe(code);
    return;
  }
  throw new Error(`Expected pg error ${code}, but the statement succeeded`);
}

/** Runs one statement as the authenticated role with no JWT subject in the request context. */
async function asRoleWithoutSubject(statement: string): Promise<string> {
  return withPg(async (client) => {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE authenticated");
    try {
      await client.query(statement);
    } catch (error) {
      return (error as { message?: string }).message ?? "";
    } finally {
      await client.query("ROLLBACK").catch(() => {});
    }
    throw new Error(`Expected "${statement}" to fail without a JWT subject`);
  });
}

describe.skipIf(!isIntegrationTestReady)("AI consent RPCs", () => {
  // Each test creates its own accounts: consent is per-account state, so a
  // shared fixture would make outcomes depend on execution order.
  async function freshAccount(): Promise<{
    user: TestUser;
    client: SupabaseClient<Database>;
  }> {
    const user = await createTestUser();
    return { user, client: authenticateAs(user) };
  }

  async function freshAccountPair(): Promise<{
    a: { user: TestUser; client: SupabaseClient<Database> };
    b: { user: TestUser; client: SupabaseClient<Database> };
  }> {
    const [a, b] = await Promise.all([freshAccount(), freshAccount()]);
    return { a, b };
  }

  it("new accounts have no AI consent in bootstrap and get_me", async () => {
    const { client } = await freshAccount();

    const { data, error } = await client.rpc("bootstrap");
    expect(error).toBeNull();
    const me = must(decodeBootstrap(data)).me;
    expect(me.aiConsentVersion).toBeNull();
    expect(me.aiConsentGrantedAt).toBeNull();

    const { data: profileData, error: profileError } = await client.rpc("get_my_profile");
    expect(profileError).toBeNull();
    const profile = must(decodeMe(profileData));
    expect(profile.aiConsentVersion).toBeNull();
    expect(profile.aiConsentGrantedAt).toBeNull();

    await expect(
      expectRpcError(client.rpc("require_ai_consent", { p_version: CURRENT_AI_CONSENT_VERSION })),
    ).resolves.toBe("ai_consent_required");
  });

  it("a grant authorizes only the authenticated account and appears in bootstrap", async () => {
    const { a, b } = await freshAccountPair();

    const { data, error } = await a.client.rpc("set_ai_consent", {
      p_expected_user_id: a.user.id,
      p_version: CURRENT_AI_CONSENT_VERSION,
    });
    expect(error).toBeNull();
    const me = must(decodeMe(data));
    expect(me.id).toBe(a.user.id);
    expect(me.aiConsentVersion).toBe(CURRENT_AI_CONSENT_VERSION);
    expect(typeof me.aiConsentGrantedAt).toBe("string");

    await expect(
      a.client.rpc("require_ai_consent", { p_version: CURRENT_AI_CONSENT_VERSION }),
    ).resolves.toMatchObject({ error: null });

    await expect(
      expectRpcError(
        b.client.rpc("require_ai_consent", { p_version: CURRENT_AI_CONSENT_VERSION }),
      ),
    ).resolves.toBe("ai_consent_required");

    const bootstrap = must(decodeBootstrap((await a.client.rpc("bootstrap")).data));
    expect(bootstrap.me.aiConsentVersion).toBe(CURRENT_AI_CONSENT_VERSION);
  });

  it("granting the same version preserves the original grant timestamp", async () => {
    const { a } = await freshAccountPair();
    await a.client.rpc("set_ai_consent", {
      p_expected_user_id: a.user.id,
      p_version: CURRENT_AI_CONSENT_VERSION,
    });
    const first = must(decodeMe((await a.client.rpc("get_my_profile")).data));

    const second = must(
      decodeMe(
        (
          await a.client.rpc("set_ai_consent", {
            p_expected_user_id: a.user.id,
            p_version: CURRENT_AI_CONSENT_VERSION,
          })
        ).data,
      ),
    );
    expect(second.aiConsentGrantedAt).toBe(first.aiConsentGrantedAt);
  });

  it("revoking consent denies the next check and is idempotent", async () => {
    const { a } = await freshAccountPair();
    await a.client.rpc("set_ai_consent", {
      p_expected_user_id: a.user.id,
      p_version: CURRENT_AI_CONSENT_VERSION,
    });

    await a.client.rpc("revoke_ai_consent", { p_expected_user_id: a.user.id });
    await expect(
      expectRpcError(
        a.client.rpc("require_ai_consent", { p_version: CURRENT_AI_CONSENT_VERSION }),
      ),
    ).resolves.toBe("ai_consent_required");

    const { data, error } = await a.client.rpc("revoke_ai_consent", {
      p_expected_user_id: a.user.id,
    });
    expect(error).toBeNull();
    const me = must(decodeMe(data));
    expect(me.aiConsentVersion).toBeNull();
    expect(me.aiConsentGrantedAt).toBeNull();

    const bootstrap = must(decodeBootstrap((await a.client.rpc("bootstrap")).data));
    expect(bootstrap.me.aiConsentVersion).toBeNull();
    expect(bootstrap.me.aiConsentGrantedAt).toBeNull();
  });

  it("rejects a different expected account for grant and revoke", async () => {
    const { a, b } = await freshAccountPair();
    await expect(
      expectRpcError(
        b.client.rpc("set_ai_consent", {
          p_expected_user_id: a.user.id,
          p_version: CURRENT_AI_CONSENT_VERSION,
        }),
      ),
    ).resolves.toBe("unauthenticated");
    await expect(
      expectRpcError(b.client.rpc("revoke_ai_consent", { p_expected_user_id: a.user.id })),
    ).resolves.toBe("unauthenticated");

    const row = await consentRow(a.user.id);
    expect(row.ai_consent_version).toBeNull();
    expect(row.ai_consent_granted_at).toBeNull();
  });

  it("anonymous callers cannot grant revoke or check consent", async () => {
    const a = await freshAccount();
    const grant = await rawRpc("set_ai_consent", {
      p_expected_user_id: a.user.id,
      p_version: CURRENT_AI_CONSENT_VERSION,
    });
    expect(grant.message).toMatch(/permission denied/);

    const revoke = await rawRpc("revoke_ai_consent", { p_expected_user_id: a.user.id });
    expect(revoke.message).toMatch(/permission denied/);

    const check = await rawRpc("require_ai_consent", { p_version: CURRENT_AI_CONSENT_VERSION });
    expect(check.message).toMatch(/permission denied/);
  });

  it("authenticated role without a subject is unauthenticated", async () => {
    const a = await freshAccount();
    const grant = await asRoleWithoutSubject(
      `select public.set_ai_consent('${a.user.id}'::uuid, ${CURRENT_AI_CONSENT_VERSION})`,
    );
    expect(grant).toBe("unauthenticated");

    const revoke = await asRoleWithoutSubject(
      `select public.revoke_ai_consent('${a.user.id}'::uuid)`,
    );
    expect(revoke).toBe("unauthenticated");

    const check = await asRoleWithoutSubject(
      `select public.require_ai_consent(${CURRENT_AI_CONSENT_VERSION})`,
    );
    expect(check).toBe("unauthenticated");
  });

  it("null zero negative and unsupported grant versions leave consent unchanged", async () => {
    const a = await freshAccount();
    await a.client.rpc("set_ai_consent", {
      p_expected_user_id: a.user.id,
      p_version: CURRENT_AI_CONSENT_VERSION,
    });
    const seeded = await consentRow(a.user.id);

    for (const version of [0, -1, CURRENT_AI_CONSENT_VERSION + 1]) {
      await expect(
        expectRpcError(
          a.client.rpc("set_ai_consent", { p_expected_user_id: a.user.id, p_version: version }),
        ),
      ).resolves.toBe("invalid_argument");
    }

    const nullVersion = await rawRpc(
      "set_ai_consent",
      { p_expected_user_id: a.user.id, p_version: null },
      a.user.accessToken,
    );
    expect(nullVersion.message).toBe("invalid_argument");

    const after = await consentRow(a.user.id);
    expect(after.ai_consent_version).toBe(seeded.ai_consent_version);
    expect(after.ai_consent_granted_at?.toString()).toBe(
      seeded.ai_consent_granted_at?.toString(),
    );

    await expect(
      expectRpcError(a.client.rpc("require_ai_consent", { p_version: 0 })),
    ).resolves.toBe("invalid_argument");
    await expect(
      a.client.rpc("require_ai_consent", { p_version: CURRENT_AI_CONSENT_VERSION }),
    ).resolves.toMatchObject({ error: null });
  });

  it("a stored noncurrent version is not permission for the current disclosure", async () => {
    const { b } = await freshAccountPair();
    const grantedAt = new Date().toISOString();
    await withPg(async (client) => {
      await client.query(
        "update public.users set ai_consent_version = 2, ai_consent_granted_at = $2 where id = $1",
        [b.user.id, grantedAt],
      );
    });

    await expect(
      expectRpcError(
        b.client.rpc("require_ai_consent", { p_version: CURRENT_AI_CONSENT_VERSION }),
      ),
    ).resolves.toBe("ai_consent_required");

    const { data, error } = await b.client.rpc("set_ai_consent", {
      p_expected_user_id: b.user.id,
      p_version: CURRENT_AI_CONSENT_VERSION,
    });
    expect(error).toBeNull();
    expect(must(decodeMe(data)).aiConsentVersion).toBe(CURRENT_AI_CONSENT_VERSION);
    await expect(
      b.client.rpc("require_ai_consent", { p_version: CURRENT_AI_CONSENT_VERSION }),
    ).resolves.toMatchObject({ error: null });
  });

  it("profiles missing from users cannot grant revoke or check consent", async () => {
    const ghost = await createTestUser();
    await withPg(async (client) => {
      await client.query("delete from public.users where id = $1", [ghost.id]);
    });
    const ghostClient = authenticateAs(ghost);

    await expect(
      expectRpcError(
        ghostClient.rpc("set_ai_consent", {
          p_expected_user_id: ghost.id,
          p_version: CURRENT_AI_CONSENT_VERSION,
        }),
      ),
    ).resolves.toBe("user_not_found");
    await expect(
      expectRpcError(ghostClient.rpc("revoke_ai_consent", { p_expected_user_id: ghost.id })),
    ).resolves.toBe("user_not_found");
    await expect(
      expectRpcError(
        ghostClient.rpc("require_ai_consent", { p_version: CURRENT_AI_CONSENT_VERSION }),
      ),
    ).resolves.toBe("user_not_found");
  });

  it("the consent pair constraint rejects partial and nonpositive states", async () => {
    const a = await freshAccount();
    const stamp = new Date().toISOString();
    const setColumns = (version: number | null, grantedAt: string | null) =>
      withPg(async (client) => {
        await client.query(
          "update public.users set ai_consent_version = $2, ai_consent_granted_at = $3 where id = $1",
          [a.user.id, version, grantedAt],
        );
      });

    await expectPgCode(() => setColumns(null, stamp), "23514");
    await expectPgCode(() => setColumns(1, null), "23514");
    await expectPgCode(() => setColumns(0, stamp), "23514");
    await expectPgCode(() => setColumns(-1, stamp), "23514");

    await setColumns(1, stamp);
    const paired = await consentRow(a.user.id);
    expect(paired.ai_consent_version).toBe(1);

    await setColumns(null, null);
    const cleared = await consentRow(a.user.id);
    expect(cleared.ai_consent_version).toBeNull();
    expect(cleared.ai_consent_granted_at).toBeNull();
  });

  it("clients cannot read or update consent columns directly or call the private me serializer", async () => {
    const a = await freshAccount();
    const { error: readError } = await a.client
      .from("users")
      .select("ai_consent_version")
      .limit(1);
    expect(readError?.message).toMatch(/permission denied/);

    const { error: writeError } = await a.client
      .from("users")
      .update({ ai_consent_version: CURRENT_AI_CONSENT_VERSION })
      .eq("id", a.user.id);
    expect(writeError?.message).toMatch(/permission denied/);

    await expect(
      expectRpcError(a.client.rpc("ledger_me_json", { p_user_id: a.user.id })),
    ).resolves.toMatch(/permission denied/);
  });

  it("profile updates do not alter stored consent", async () => {
    const a = await freshAccount();
    await a.client.rpc("set_ai_consent", {
      p_expected_user_id: a.user.id,
      p_version: CURRENT_AI_CONSENT_VERSION,
    });

    const { data, error } = await a.client.rpc("update_profile", { p_name: "Nome Consentido" });
    expect(error).toBeNull();
    expect(data).toMatchObject({ id: a.user.id, name: "Nome Consentido" });
    expect(data as Record<string, unknown>).not.toHaveProperty("aiConsentVersion");
    expect(data as Record<string, unknown>).not.toHaveProperty("aiConsentGrantedAt");

    const row = await consentRow(a.user.id);
    expect(row.ai_consent_version).toBe(CURRENT_AI_CONSENT_VERSION);
    expect(row.ai_consent_granted_at).not.toBeNull();
  });
});
