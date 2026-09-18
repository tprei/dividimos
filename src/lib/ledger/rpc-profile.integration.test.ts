import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ValidationResult } from "@/lib/expense-money";
import type { WireIssue } from "@/types/ledger";
import {
  decodeBootstrap,
  decodeConversation,
  decodeMe,
  decodeUserProfile,
} from "@/lib/ledger/decode";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createGroupWithMembers,
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
