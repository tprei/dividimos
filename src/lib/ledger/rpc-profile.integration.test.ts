import { beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import type { Database } from "@/types/database";
import type { ValidationResult } from "@/lib/expense-money";
import type { WireIssue } from "@/types/ledger";
import { encryptPixKey } from "@/lib/crypto";
import {
  decodeBootstrap,
  decodeConversation,
  decodeMe,
  decodeUserProfile,
} from "@/lib/ledger/decode";
import { maskPixKey } from "@/lib/pix";
import { nameToHandle } from "@/lib/handle";
import {
  adminClient,
  isIntegrationTestReady,
  registerTestUser,
} from "@/test/integration-setup";
import {
  authenticateAs,
  createGroupWithMembers,
  createTestUser,
  expectRpcError,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";

vi.mock("server-only", () => ({}));

type OnboardingResult = { kind: "completed" | "already_completed" };

async function anonymousRpc(
  args: Record<string, string>,
): Promise<{ error: { message: string } | null }> {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/complete_onboarding`,
    {
      method: "POST",
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        "content-type": "application/json",
      },
      body: JSON.stringify(args),
    },
  );
  const body = (await response.json()) as { message?: string };
  return {
    error: response.ok ? null : { message: body.message ?? "anonymous RPC failed" },
  };
}

async function completeOnboarding(
  client: SupabaseClient<Database>,
  handle: string,
  name: string,
  encryptedPixKey: string,
  pixKeyHint: string,
  pixKeyType: Database["public"]["Enums"]["pix_key_type"],
): Promise<OnboardingResult> {
  const { data, error } = await client.rpc("complete_onboarding", {
    p_handle: handle,
    p_name: name,
    p_pix_key_encrypted: encryptedPixKey,
    p_pix_key_hint: pixKeyHint,
    p_pix_key_type: pixKeyType,
  });
  if (error) throw new Error(error.message);
  return data as OnboardingResult;
}

function must<T>(result: ValidationResult<T, WireIssue>): T {
  if (!result.ok) {
    throw new Error(`wire decode failed at [${result.issue.path.join(".")}]`);
  }
  return result.value;
}

describe.skipIf(!isIntegrationTestReady)("complete_onboarding RPC", () => {
  let pending: TestUser;
  let pendingClient: SupabaseClient<Database>;
  let owner: TestUser;
  let ownerClient: SupabaseClient<Database>;
  let contender: TestUser;
  let contenderClient: SupabaseClient<Database>;
  let invalid: TestUser;
  let invalidClient: SupabaseClient<Database>;

  beforeAll(async () => {
    [pending, owner, contender, invalid] = await Promise.all([
      createTestUser({ onboarded: false }),
      createTestUser({ onboarded: false }),
      createTestUser({ onboarded: false }),
      createTestUser({ onboarded: false }),
    ]);
    pendingClient = authenticateAs(pending);
    ownerClient = authenticateAs(owner);
    contenderClient = authenticateAs(contender);
    invalidClient = authenticateAs(invalid);
  });

  it("completes onboarding once and preserves the first values on replay", async () => {
    await expect(
      completeOnboarding(
        pendingClient,
        `  ${pending.handle}  `,
        "  Primeiro Nome  ",
        encryptPixKey("first@example.com"),
        "first@example.com",
        "email",
      ),
    ).resolves.toEqual({ kind: "completed" });

    await expect(
      completeOnboarding(
        pendingClient,
        "different_handle",
        "Outro Nome",
        encryptPixKey("second@example.com"),
        "second@example.com",
        "cpf",
      ),
    ).resolves.toEqual({ kind: "already_completed" });

    const { data, error } = await pendingClient.rpc("get_my_profile");
    expect(error).toBeNull();
    expect(data).toMatchObject({
      id: pending.id,
      handle: pending.handle,
      name: "Primeiro Nome",
      pixKeyType: "email",
      pixKeyHint: "first@example.com",
      onboarded: true,
    });
  });

  it("maps only the handle unique constraint to handle_taken", async () => {
    await completeOnboarding(
      ownerClient,
      owner.handle,
      "Owner",
      encryptPixKey("owner@example.com"),
      "owner@example.com",
      "email",
    );

    await expect(
      expectRpcError(
        contenderClient.rpc("complete_onboarding", {
          p_handle: owner.handle,
          p_name: "Contender",
          p_pix_key_encrypted: encryptPixKey("contender@example.com"),
          p_pix_key_hint: "contender@example.com",
          p_pix_key_type: "email",
        }),
      ),
    ).resolves.toBe("handle_taken");
  });

  it("rejects malformed onboarding values and anonymous execution", async () => {
    await expect(
      expectRpcError(
        invalidClient.rpc("complete_onboarding", {
          p_handle: "a.b",
          p_name: "Invalid",
          p_pix_key_encrypted: "encrypted",
          p_pix_key_hint: "hint",
          p_pix_key_type: "email",
        }),
      ),
    ).resolves.toBe("invalid_handle");

    await expect(
      expectRpcError(
        invalidClient.rpc("complete_onboarding", {
          p_handle: invalid.handle,
          p_name: " ",
          p_pix_key_encrypted: "encrypted",
          p_pix_key_hint: "hint",
          p_pix_key_type: "email",
        }),
      ),
    ).resolves.toBe("invalid_name");

    await expect(
      expectRpcError(
        invalidClient.rpc("complete_onboarding", {
          p_handle: invalid.handle,
          p_name: "Valid Name",
          p_pix_key_encrypted: "",
          p_pix_key_hint: "hint",
          p_pix_key_type: "email",
        }),
      ),
    ).resolves.toBe("invalid_argument");

    await expect(
      expectRpcError(
        anonymousRpc({
          p_handle: "anonymous_user",
          p_name: "Anonymous",
          p_pix_key_encrypted: "encrypted",
          p_pix_key_hint: "hint",
          p_pix_key_type: "email",
        }),
      ),
    ).resolves.toMatch(/permission denied/);
  });

  it("rejects pix ciphertext outside the iv:tag:ciphertext format and hints over 80", async () => {
    await expect(
      expectRpcError(
        invalidClient.rpc("complete_onboarding", {
          p_handle: invalid.handle,
          p_name: "Invalid",
          p_pix_key_encrypted: "chave-sem-formato",
          p_pix_key_hint: "invalid@example.com",
          p_pix_key_type: "email",
        }),
      ),
    ).resolves.toBe("invalid_argument");

    await expect(
      expectRpcError(
        invalidClient.rpc("complete_onboarding", {
          p_handle: invalid.handle,
          p_name: "Invalid",
          p_pix_key_encrypted: "a:b:c",
          p_pix_key_hint: "invalid@example.com",
          p_pix_key_type: "email",
        }),
      ),
    ).resolves.toBe("invalid_argument");

    await expect(
      expectRpcError(
        invalidClient.rpc("complete_onboarding", {
          p_handle: invalid.handle,
          p_name: "Invalid",
          p_pix_key_encrypted: encryptPixKey("valid@example.com"),
          p_pix_key_hint: "h".repeat(81),
          p_pix_key_type: "email",
        }),
      ),
    ).resolves.toBe("invalid_argument");
  });

  it("accepts hints of exactly 80 characters and ciphertexts of exactly 256 characters, refusing 81 and 257", async () => {
    const hintBoundary = await createTestUser({ onboarded: false });
    await expect(
      completeOnboarding(
        authenticateAs(hintBoundary),
        hintBoundary.handle,
        "Nome",
        encryptPixKey("boundary@example.com"),
        "h".repeat(80),
        "email",
      ),
    ).resolves.toEqual({ kind: "completed" });

    const exactly256 = `${"A".repeat(16)}:${"A".repeat(22)}==:${"B".repeat(212)}==`;
    expect(exactly256.length).toBe(256);
    const ciphertextBoundary = await createTestUser({ onboarded: false });
    await expect(
      completeOnboarding(
        authenticateAs(ciphertextBoundary),
        ciphertextBoundary.handle,
        "Nome",
        exactly256,
        "dica",
        "email",
      ),
    ).resolves.toEqual({ kind: "completed" });

    const exactly257 = `${exactly256}B`;
    expect(exactly257.length).toBe(257);
    const rejected = await createTestUser({ onboarded: false });
    await expect(
      expectRpcError(
        authenticateAs(rejected).rpc("complete_onboarding", {
          p_handle: rejected.handle,
          p_name: "Nome",
          p_pix_key_encrypted: exactly257,
          p_pix_key_hint: "dica",
          p_pix_key_type: "email",
        }),
      ),
    ).resolves.toBe("invalid_argument");
  });

  it("accepts a real ciphertext for the longest valid pix key", async () => {
    const longestEmail = `${"a".repeat(73)}@b.c`;
    const encrypted = encryptPixKey(longestEmail);
    const hint = maskPixKey(longestEmail);
    expect(encrypted.length).toBeLessThanOrEqual(256);
    expect(hint.length).toBeLessThanOrEqual(80);

    const fresh = await createTestUser({ onboarded: false });
    await expect(
      completeOnboarding(
        authenticateAs(fresh),
        fresh.handle,
        "Nome Longo",
        encrypted,
        hint,
        "email",
      ),
    ).resolves.toEqual({ kind: "completed" });
  });
});

describe.skipIf(!isIntegrationTestReady)("reserved handles", () => {
  const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const reservedHandles = [
    "ajuda",
    "admin",
    "dividimos_oficial",
    "admin1",
    "sup0rte",
    "suporte_oficial",
    "pix",
    "pix1",
    "root1",
    "pix_oficial",
    "o_suporte",
    "the_admin",
    "bancocentral_br",
  ];

  let challenger: TestUser;
  let challengerClient: SupabaseClient<Database>;
  let holder: TestUser;
  let holderClient: SupabaseClient<Database>;

  beforeAll(async () => {
    [challenger, holder] = await Promise.all([
      createTestUser({ onboarded: false }),
      createTestUser(),
    ]);
    challengerClient = authenticateAs(challenger);
    holderClient = authenticateAs(holder);

    // Sign-up predates the reservations: the holder got the handle directly.
    const { error } = await adminClient!
      .from("users")
      .update({ handle: `suporte_${runId}` })
      .eq("id", holder.id);
    expect(error).toBeNull();
  });

  it("refuses reserved handles on complete_onboarding", async () => {
    for (const handle of reservedHandles) {
      await expect(
        expectRpcError(
          challengerClient.rpc("complete_onboarding", {
            p_handle: handle,
            p_name: "Desafiante",
            p_pix_key_encrypted: encryptPixKey("challenger@example.com"),
            p_pix_key_hint: "challenger@example.com",
            p_pix_key_type: "email",
          }),
        ),
      ).resolves.toBe("handle_taken");
    }
  });

  it("refuses reserved handles on update_profile", async () => {
    for (const handle of reservedHandles) {
      await expect(
        expectRpcError(
          challengerClient.rpc("update_profile", {
            p_handle: handle,
            p_name: "Desafiante",
          }),
        ),
      ).resolves.toBe("handle_taken");
    }
  });

  it("accepts an ana_oficial variant on onboarding and on a profile update", async () => {
    const claimed = await createTestUser({ onboarded: false });
    const claimedClient = authenticateAs(claimed);
    const official = `ana_oficial_${runId}`;
    await expect(
      completeOnboarding(
        claimedClient,
        official,
        "Ana Oficial",
        encryptPixKey("ana@example.com"),
        "ana@example.com",
        "email",
      ),
    ).resolves.toEqual({ kind: "completed" });

    const { data, error } = await claimedClient.rpc("update_profile", {
      p_handle: official,
      p_name: "Ana Oficial",
    });
    expect(error).toBeNull();
    expect(must(decodeMe(data))).toMatchObject({
      handle: official,
      name: "Ana Oficial",
    });
  });

  it("keeps non-reserved lookalike handles available", async () => {
    for (const handle of ["admilson", "maria_silva", "usuario", `ana_oficial_${runId}`]) {
      const { data, error } = await adminClient!.rpc("is_reserved_handle", {
        p_handle: handle,
      });
      expect(error).toBeNull();
      expect(data).toBe(false);
    }
  });

  it("lets a holder of a reserved handle save their profile keeping it", async () => {
    const held = `suporte_${runId}`;
    const { data, error } = await holderClient.rpc("update_profile", {
      p_name: "Suporte Antigo",
      p_handle: held,
    });
    expect(error).toBeNull();
    expect(must(decodeMe(data))).toMatchObject({
      handle: held,
      name: "Suporte Antigo",
    });

    const upper = await holderClient.rpc("update_profile", {
      p_name: "Suporte Antigo 2",
      p_handle: held.toUpperCase(),
    });
    expect(upper.error).toBeNull();
    expect(must(decodeMe(upper.data))).toMatchObject({
      handle: held,
      name: "Suporte Antigo 2",
    });
  });

  it("answers validation errors before any handle_taken", async () => {
    await expect(
      expectRpcError(
        challengerClient.rpc("update_profile", {
          p_handle: "suporte",
          p_notification_preferences: [],
        }),
      ),
    ).resolves.toBe("invalid_notification_preferences");
  });

  it("lets a legacy user finish onboarding keeping their reserved handle", async () => {
    const legacy = await createTestUser({ onboarded: false });
    const held = `admin_${runId}`;
    const { error: setError } = await adminClient!
      .from("users")
      .update({ handle: held })
      .eq("id", legacy.id);
    expect(setError).toBeNull();

    await expect(
      completeOnboarding(
        authenticateAs(legacy),
        held,
        "Admin de Verdade",
        encryptPixKey("legacy@example.com"),
        "legacy@example.com",
        "email",
      ),
    ).resolves.toEqual({ kind: "completed" });

    const { data, error } = await adminClient!
      .from("users")
      .select("handle")
      .eq("id", legacy.id)
      .single();
    expect(error).toBeNull();
    expect(data!.handle).toBe(held);
  });

  const handleFor = async (email: string, fullName?: string): Promise<string> => {
    const { data: authData, error: authError } = await adminClient!
      .auth.admin.createUser({
        email,
        email_confirm: true,
        ...(fullName === undefined ? {} : { user_metadata: { full_name: fullName } }),
      });
    if (authError || !authData.user) {
      throw new Error(`Failed to create auth user: ${authError?.message}`);
    }
    registerTestUser(authData.user.id);

    const { data, error } = await adminClient!
      .from("users")
      .select("handle")
      .eq("id", authData.user.id)
      .single();
    expect(error).toBeNull();
    return data!.handle;
  };

  it("derives the automatic handle from the display name, not the email", async () => {
    const testId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

    const emailLocal = `x${testId}`;
    const named = await handleFor(
      `${emailLocal}@${testId}.test.dividimos.local`,
      `João Álvaro ${testId}`,
    );
    expect(named).toBe(nameToHandle(`João Álvaro ${testId}`));
    expect(named).not.toContain(emailLocal);

    const reserved = await handleFor(
      `suporte2@${testId}.test.dividimos.local`,
      "Suporte",
    );
    expect(reserved).toMatch(/^usuario\d*$/);

    const dona = `Dona Maria Cipriano ${testId}`;
    const first = await handleFor(
      `dona1@${testId}.test.dividimos.local`,
      dona,
    );
    expect(first).toBe(nameToHandle(dona));
    const second = await handleFor(
      `dona2@${testId}.test.dividimos.local`,
      dona,
    );
    expect(second).not.toBe(first);
    expect(second).toMatch(new RegExp(`^${first.slice(0, 26)}\\d+$`));

    const anonymous = await handleFor(`anon@${testId}.test.dividimos.local`);
    expect(anonymous).toMatch(/^usuario\d*$/);
  });

  it("gives two sequentially signed-up users with the same name distinct handles", async () => {
    const shared = `Gêmea Bem ${runId}`;
    const base = nameToHandle(shared);
    expect(base.length).toBeLessThanOrEqual(26);

    const h1 = await handleFor(`gemea1@${runId}.test.dividimos.local`, shared);
    const h2 = await handleFor(`gemea2@${runId}.test.dividimos.local`, shared);

    expect(h1).toBe(base);
    expect(h2).not.toBe(h1);
    expect(h2.startsWith(base)).toBe(true);
  });

  it("derives the same handle as nameToHandle across scripts, spaces, and lengths", async () => {
    const parityNames = [
      `João Álvaro ${runId}`,
      `Åsa Ýmir ${runId}`,
      `Čedomir Šarš ${runId}`,
      `Ana\u00a0Maria ${runId}`,
      `😀 Festa ${runId}`,
      `Ana   Espaços   Dobros ${runId}`,
      `123 João ${runId}`,
      `Áb ${"a".repeat(6)}çõ ${runId}`,
      `Áb Áb Áb Áb Áb Áb Áb Áb Áb Áb Áb Áb ${runId}`,
    ];
    for (const [i, name] of parityNames.entries()) {
      const handle = await handleFor(
        `parity${i}@${runId}.test.dividimos.local`,
        name,
      );
      expect(handle.startsWith(nameToHandle(name))).toBe(true);
    }

    for (const short of ["ab", "😀😀"]) {
      const handle = await handleFor(
        `short${short.replace(/[^a-z]/g, "")}@${runId}.test.dividimos.local`,
        short,
      );
      expect(handle).toMatch(/^usuario\d*$/);
    }
  });

  it("re-rolls forbidden retry handles when concurrent signups resolve a collision", async () => {
    const databaseUrl = process.env.SUPABASE_DB_URL;
    if (!databaseUrl) {
      throw new Error("SUPABASE_DB_URL is required for signup contention tests");
    }

    const insertSignup =
      "insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) " +
      "values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, " +
      "'{\"full_name\":\"suport\"}'::jsonb, now(), now())";
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    const holder = new Client(databaseUrl);
    const contender = new Client(databaseUrl);
    const monitor = new Client(databaseUrl);
    const describeError = (error: unknown): string =>
      error instanceof Error ? error.message : String(error);
    const cleanupErrors: string[] = [];
    const cleanup = async (label: string, step: () => Promise<unknown>) => {
      try {
        await step();
      } catch (error) {
        cleanupErrors.push(`${label}: ${describeError(error)}`);
      }
    };

    let holderActive = false;
    let contenderActive = false;
    let competing: Promise<unknown> | null = null;
    let competingError: unknown = null;
    let bodyError: unknown = null;
    try {
      await Promise.all([holder.connect(), contender.connect(), monitor.connect()]);

      const free = await monitor.query(
        "select 1 from public.users where handle = 'suport'",
      );
      expect(free.rowCount).toBe(0);

      let seed: number | null = null;
      let forbidden = "";
      for (let n = 1; n < 500 && seed === null; n++) {
        await monitor.query("select setseed($1)", [n / 1000]);
        const candidate = (
          await monitor.query(
            "select 'suport' || (1000 + floor(random() * 9000))::int::text as handle",
          )
        ).rows[0].handle as string;
        const reserved = (
          await monitor.query(
            "select public.is_reserved_handle($1) as reserved",
            [candidate],
          )
        ).rows[0].reserved as boolean;
        if (reserved) {
          seed = n / 1000;
          forbidden = candidate;
        }
      }
      if (seed === null) {
        throw new Error("no seed produces a reserved retry suffix");
      }

      await holder.query("begin");
      holderActive = true;
      await contender.query("begin");
      contenderActive = true;
      await contender.query("select setseed($1)", [seed]);

      const backendPid = (
        await contender.query<{ pid: number }>("select pg_backend_pid() as pid")
      ).rows[0].pid;
      await holder.query(insertSignup, [
        ids[0],
        `${ids[0]}@${runId}.test.dividimos.local`,
      ]);
      competing = contender
        .query(insertSignup, [ids[1], `${ids[1]}@${runId}.test.dividimos.local`])
        .then(
          (result) => result,
          (error) => {
            competingError = error;
            return null;
          },
        );

      const deadline = Date.now() + 5000;
      let contended = false;
      while (Date.now() < deadline) {
        const waiting = await monitor.query(
          "select 1 from pg_stat_activity where pid = $1 and wait_event_type = 'Lock'",
          [backendPid],
        );
        if ((waiting.rowCount ?? 0) > 0) {
          contended = true;
          break;
        }
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 20);
        await promise;
      }
      expect(contended).toBe(true);

      await holder.query("commit");
      holderActive = false;
      await competing;
      expect(competingError).toBeNull();
      await contender.query("commit");
      contenderActive = false;

      const stored = (
        await monitor.query(
          "select handle, public.is_reserved_handle(handle) as reserved " +
            "from public.users where id = any($1::uuid[]) order by handle",
          [ids],
        )
      ).rows as Array<{ handle: string; reserved: boolean }>;
      expect(stored).toHaveLength(2);
      expect(stored.map((row) => row.handle)).not.toContain(forbidden);
      for (const row of stored) {
        expect(row.reserved).toBe(false);
        expect(row.handle).toMatch(/^[a-z0-9_]{3,30}$/);
      }
    } catch (error) {
      bodyError = error;
    }
    if (holderActive) {
      await cleanup("holder rollback", () => holder.query("rollback"));
    }
    if (competing) {
      await competing;
    }
    if (contenderActive) {
      await cleanup("contender rollback", () => contender.query("rollback"));
    }
    await cleanup("user cleanup", () =>
      monitor.query("delete from public.users where id = any($1::uuid[])", [ids]),
    );
    await cleanup("auth cleanup", () =>
      monitor.query("delete from auth.users where id = any($1::uuid[])", [ids]),
    );
    await cleanup("holder end", () => holder.end());
    await cleanup("contender end", () => contender.end());
    await cleanup("monitor end", () => monitor.end());
    if (cleanupErrors.length > 0) {
      const detail = cleanupErrors.join("; ");
      throw new Error(
        bodyError === null
          ? `signup contention cleanup failed: ${detail}`
          : `signup contention cleanup failed: ${detail}; original failure: ${describeError(bodyError)}`,
      );
    }
    if (bodyError !== null) {
      throw bodyError;
    }
  });

  it("falls back to the usuario stem when truncation reserves the retry candidates", async () => {
    const databaseUrl = process.env.SUPABASE_DB_URL;
    if (!databaseUrl) {
      throw new Error("SUPABASE_DB_URL is required for signup contention tests");
    }

    const crafted = "pix00000000000000000000000abcd";
    const insertSignup =
      "insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) " +
      "values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, $3::jsonb, now(), now())";
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    const signup = new Client(databaseUrl);
    const monitor = new Client(databaseUrl);
    const describeError = (error: unknown): string =>
      error instanceof Error ? error.message : String(error);
    const cleanupErrors: string[] = [];
    const cleanup = async (label: string, step: () => Promise<unknown>) => {
      try {
        await step();
      } catch (error) {
        cleanupErrors.push(`${label}: ${describeError(error)}`);
      }
    };

    let bodyError: unknown = null;
    try {
      await Promise.all([signup.connect(), monitor.connect()]);

      const free = await monitor.query(
        "select 1 from public.users where handle = $1",
        [crafted],
      );
      expect(free.rowCount).toBe(0);

      await signup.query(insertSignup, [
        ids[0],
        `${ids[0]}@${runId}.test.dividimos.local`,
        JSON.stringify({ full_name: crafted }),
      ]);
      await signup.query("set statement_timeout = '4s'");
      await signup.query(insertSignup, [
        ids[1],
        `${ids[1]}@${runId}.test.dividimos.local`,
        JSON.stringify({ full_name: crafted }),
      ]);
      await signup.query("set statement_timeout = 0");

      const stored = (
        await monitor.query(
          "select handle, public.is_reserved_handle(handle) as reserved " +
            "from public.users where id = any($1::uuid[]) order by handle",
          [ids],
        )
      ).rows as Array<{ handle: string; reserved: boolean }>;
      expect(stored).toHaveLength(2);
      expect(stored[0].handle).toBe(crafted);
      expect(stored[0].reserved).toBe(false);
      expect(stored[1].handle).toMatch(/^usuario\d+$/);
      expect(stored[1].reserved).toBe(false);
    } catch (error) {
      bodyError = error;
    }
    await cleanup("signup end", () => signup.end());
    await cleanup("user cleanup", () =>
      monitor.query("delete from public.users where id = any($1::uuid[])", [ids]),
    );
    await cleanup("auth cleanup", () =>
      monitor.query("delete from auth.users where id = any($1::uuid[])", [ids]),
    );
    await cleanup("monitor end", () => monitor.end());
    if (cleanupErrors.length > 0) {
      const detail = cleanupErrors.join("; ");
      throw new Error(
        bodyError === null
          ? `truncated stem signup cleanup failed: ${detail}`
          : `truncated stem signup cleanup failed: ${detail}; original failure: ${describeError(bodyError)}`,
      );
    }
    if (bodyError !== null) {
      throw bodyError;
    }
  });

  it("denies direct execution of the signup trigger", async () => {
    await withPg(async (db) => {
      await db.query("begin");
      try {
        await db.query("set local role anon");
        await expect(db.query("select public.handle_new_user()")).rejects.toMatchObject({
          code: "42501",
        });
      } finally {
        await db.query("rollback");
      }
    });
  });
});

describe.skipIf(!isIntegrationTestReady)("users.is_bot", () => {
  let bot: TestUser;
  let botClient: SupabaseClient<Database>;
  let viewer: TestUser;
  let viewerClient: SupabaseClient<Database>;
  let groupId: string;

  beforeAll(async () => {
    [bot, viewer] = await Promise.all([createTestUser(), createTestUser()]);
    const { error } = await adminClient!
      .from("users")
      .update({ is_bot: true })
      .eq("id", bot.id);
    expect(error).toBeNull();
    groupId = await createGroupWithMembers(bot, [viewer], "Grupo bot");
    botClient = authenticateAs(bot);
    viewerClient = authenticateAs(viewer);
  });

  it("surfaces the flag on group members and on me through bootstrap", async () => {
    const { data, error } = await viewerClient.rpc("bootstrap");
    expect(error).toBeNull();
    const bootstrap = must(decodeBootstrap(data));
    const snapshot = bootstrap.groups.find(
      (group) => group.group.id === groupId,
    );
    expect(snapshot).toBeDefined();
    expect(
      snapshot!.members.find((member) => member.userId === bot.id)?.user.isBot,
    ).toBe(true);
    expect(
      snapshot!.members.find((member) => member.userId === viewer.id)?.user
        .isBot,
    ).toBe(false);
    expect(bootstrap.me.isBot).toBe(false);

    const { data: botData, error: botError } = await botClient.rpc("bootstrap");
    expect(botError).toBeNull();
    expect(must(decodeBootstrap(botData)).me.isBot).toBe(true);
  });

  it("keeps the flag when the bot updates its own profile", async () => {
    const { data, error } = await botClient.rpc("update_profile", {
      p_name: "Robo Verificado",
    });
    expect(error).toBeNull();
    const me = must(decodeMe(data));
    expect(me.isBot).toBe(true);
    expect(me.name).toBe("Robo Verificado");

    const { data: row, error: readError } = await adminClient!
      .from("users")
      .select("is_bot")
      .eq("id", bot.id)
      .single();
    expect(readError).toBeNull();
    expect(row!.is_bot).toBe(true);
  });

  it("carries the flag on chat message senders", async () => {
    const { error: sendError } = await botClient.rpc("send_message", {
      p_client_id: crypto.randomUUID(),
      p_group_id: groupId,
      p_content: "oi",
    });
    expect(sendError).toBeNull();

    const { data, error } = await viewerClient.rpc("get_conversation", {
      p_group_id: groupId,
    });
    expect(error).toBeNull();
    const conversation = must(decodeConversation(data));
    const message = conversation.messages.find((m) => m.content === "oi");
    expect(message).toBeDefined();
    expect(message!.sender.isBot).toBe(true);
    expect(message!.senderId).toBe(bot.id);
  });

  it("carries the flag on the handle lookup", async () => {
    const { data, error } = await adminClient!.rpc("lookup_user_by_handle", {
      p_handle: bot.handle,
    });
    expect(error).toBeNull();
    const profile = must(decodeUserProfile(data));
    expect(profile.isBot).toBe(true);
    expect(profile.handle).toBe(bot.handle);
  });
});
