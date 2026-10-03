import { beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createTestUsers,
  expectRpcError,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";
import { decryptPixKey, encryptPixKey } from "@/lib/crypto";

vi.mock("server-only", () => ({}));

interface StoredCredential {
  appleSubject: string;
  refreshTokenEncrypted: string;
}

function decodeStored(raw: unknown): StoredCredential | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.appleSubject !== "string" || typeof record.refreshTokenEncrypted !== "string") {
    return null;
  }
  return { appleSubject: record.appleSubject, refreshTokenEncrypted: record.refreshTokenEncrypted };
}

function serviceClient(): SupabaseClient<Database> {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

function anonClient(): SupabaseClient<Database> {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
}

async function readCredential(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<StoredCredential | null> {
  const { data, error } = await client.rpc("read_apple_credential_for_revocation", {
    p_user_id: userId,
  });
  if (error) throw new Error(error.message);
  return decodeStored(data);
}

async function store(
  client: SupabaseClient<Database>,
  userId: string,
  subject: string,
): Promise<{ error: { message: string } | null }> {
  return client.rpc("store_apple_credential", {
    p_user_id: userId,
    p_apple_subject: subject,
    p_refresh_token_encrypted: encryptPixKey(`refresh-token-${crypto.randomUUID()}`),
  });
}

describe.skipIf(!isIntegrationTestReady)("apple_sign_in_credentials RPCs", () => {
  let user: TestUser;
  let service: SupabaseClient<Database>;

  beforeAll(async () => {
    [user] = await createTestUsers(1);
    service = serviceClient();
  });

  it("stores, reads back decrypted, updates, and deletes for the service role", async () => {
    const { error } = await store(service, user.id, "apple-sub-1");
    expect(error).toBeNull();

    const stored = await readCredential(service, user.id);
    expect(stored).not.toBeNull();
    expect(stored?.appleSubject).toBe("apple-sub-1");
    expect(decryptPixKey(stored?.refreshTokenEncrypted ?? "")).toMatch(/^refresh-token-/);

    // A re-link overwrites the row instead of failing on the primary key.
    const { error: updateError } = await store(service, user.id, "apple-sub-2");
    expect(updateError).toBeNull();
    const updated = await readCredential(service, user.id);
    expect(updated?.appleSubject).toBe("apple-sub-2");

    const { error: deleteError } = await service.rpc("delete_apple_credential", {
      p_user_id: user.id,
    });
    expect(deleteError).toBeNull();
    expect(await readCredential(service, user.id)).toBeNull();
  });

  it("denies the table and the RPCs to anon and authenticated roles", async () => {
    const { error } = await store(service, user.id, "apple-sub-denied");
    expect(error).toBeNull();

    const anon = anonClient();
    const anonRpc = await expectRpcError(store(anon, user.id, "apple-sub-anon"));
    expect(anonRpc).toMatch(/could not find the function|permission denied/i);
    const authedRpc = await expectRpcError(store(authenticateAs(user), user.id, "apple-sub-authed"));
    expect(authedRpc).toMatch(/could not find the function|permission denied/i);

    for (const client of [anon, authenticateAs(user)]) {
      const { error: readError } = await client
        .from("apple_sign_in_credentials")
        .select("refresh_token_encrypted")
        .eq("user_id", user.id);
      expect(readError).not.toBeNull();
    }

    // The row is only ever reachable through the service role.
    const serviceRow = await service
      .from("apple_sign_in_credentials")
      .select("apple_subject")
      .eq("user_id", user.id);
    expect(serviceRow.error).toBeNull();
    expect(serviceRow.data?.[0]?.apple_subject).toBe("apple-sub-denied");
  });

  it("refuses a tombstoned account a new credential but still reads for revocation", async () => {
    const { error } = await store(service, user.id, "apple-sub-before-delete");
    expect(error).toBeNull();

    // Full RPC deletion: settled accounts have no balances here, so it runs.
    const deleted = await service.rpc("delete_account", { p_user_id: user.id });
    expect(deleted.error).toBeNull();

    const denied = await expectRpcError(store(service, user.id, "apple-sub-after-delete"));
    expect(denied).toBe("account_deleted");

    // The stored token must survive the tombstone: it is what the deletion
    // route uses to revoke Apple right after delete_account.
    const stored = await readCredential(service, user.id);
    expect(stored?.appleSubject).toBe("apple-sub-before-delete");

    const { error: deleteError } = await service.rpc("delete_apple_credential", {
      p_user_id: user.id,
    });
    expect(deleteError).toBeNull();
  });

  it("rejects unknown users, null arguments, and ciphertext that is not in contract", async () => {
    const unknownUser = crypto.randomUUID();
    const notFound = await expectRpcError(store(service, unknownUser, "apple-sub-x"));
    expect(notFound).toBe("user_not_found");

    // The SQL trust boundary itself refuses nulls, regardless of the client.
    await expect(
      withPg(async (pg) => {
        await pg.query(
          "SELECT public.store_apple_credential($1, NULL, NULL)",
          [user.id],
        );
      }),
    ).rejects.toThrow(/invalid_argument/);

    await expect(
      withPg(async (pg) => {
        await pg.query(
          "INSERT INTO public.apple_sign_in_credentials (user_id, apple_subject, refresh_token_encrypted) VALUES ($1, $2, $3)",
          [user.id, "apple-sub-y", "plaintext-not-encrypted"],
        );
      }),
    ).rejects.toThrow(/apple_sign_in_credentials_token_format/);
  });
});
