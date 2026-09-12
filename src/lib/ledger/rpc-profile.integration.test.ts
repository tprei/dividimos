import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createTestUser,
  expectRpcError,
  type TestUser,
} from "@/test/integration-helpers";

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
        "encrypted-first",
        "first@example.com",
        "email",
      ),
    ).resolves.toEqual({ kind: "completed" });

    await expect(
      completeOnboarding(
        pendingClient,
        "different_handle",
        "Outro Nome",
        "encrypted-second",
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
      "owner-encrypted",
      "owner@example.com",
      "email",
    );

    await expect(
      expectRpcError(
        contenderClient.rpc("complete_onboarding", {
          p_handle: owner.handle,
          p_name: "Contender",
          p_pix_key_encrypted: "contender-encrypted",
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
});
