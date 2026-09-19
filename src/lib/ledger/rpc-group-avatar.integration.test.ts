import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";
import {
  acceptInvitation,
  authenticateAs,
  createGroupWithMembers,
  createTestUsers,
  expectRpcError,
  type TestUser,
} from "@/test/integration-helpers";

interface Avatar {
  kind: "initials" | "emoji" | "photo";
  emoji?: string;
  photoId?: string;
}

async function rpc<T>(
  client: SupabaseClient,
  functionName: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = (await client.rpc(functionName as never, args as never)) as {
    data: T | null;
    error: { message: string } | null;
  };
  if (error) throw new Error(`${functionName} failed: ${error.message}`);
  return data as T;
}

describe.skipIf(!isIntegrationTestReady)("group avatar RPCs", () => {
  let owner: TestUser;
  let member: TestUser;
  let pending: TestUser;
  let outsider: TestUser;
  let ownerClient: SupabaseClient;
  let memberClient: SupabaseClient;
  let pendingClient: SupabaseClient;
  let outsiderClient: SupabaseClient;
  let groupId: string;

  beforeAll(async () => {
    [owner, member, pending, outsider] = await createTestUsers(4);
    ownerClient = authenticateAs(owner);
    memberClient = authenticateAs(member);
    pendingClient = authenticateAs(pending);
    outsiderClient = authenticateAs(outsider);
    groupId = await createGroupWithMembers(owner, [member], "Avatares");
    const { error } = await ownerClient.rpc("invite_member" as never, {
      p_group_id: groupId,
      p_user_id: pending.id,
    } as never);
    if (error) throw new Error(`invite_member failed: ${error.message}`);
  });

  it("keeps the setter service-role-only and rechecks accepted membership on reads", async () => {
    if (!adminClient) throw new Error("service client unavailable");
    const ack = await rpc<{ groupId: string; ledgerVersion: number; previousPhotoId: string | null }>(
      adminClient,
      "set_group_avatar",
      {
        p_group_id: groupId,
        p_actor_id: owner.id,
        p_emoji: "🍕",
        p_photo_id: null,
      },
    );
    expect(ack.groupId).toBe(groupId);
    expect(ack.previousPhotoId).toBeNull();

    await expect(
      rpc<Avatar>(memberClient, "get_group_avatar", { p_group_id: groupId }),
    ).resolves.toEqual({ kind: "emoji", emoji: "🍕" });

    const pendingError = await expectRpcError(
      pendingClient.rpc("get_group_avatar" as never, { p_group_id: groupId } as never),
    );
    expect(pendingError).toContain("not_a_member");

    const outsiderError = await expectRpcError(
      outsiderClient.rpc("get_group_avatar" as never, { p_group_id: groupId } as never),
    );
    expect(outsiderError).toContain("not_a_member");

    const authenticatedSetter = await memberClient.rpc("set_group_avatar" as never, {
      p_group_id: groupId,
      p_actor_id: member.id,
      p_emoji: "🏠",
      p_photo_id: null,
    } as never);
    expect(authenticatedSetter.error).not.toBeNull();
    expect(authenticatedSetter.error?.message).toMatch(/permission denied|not exist/i);
  });

  it("rejects ambiguous metadata, DMs, and invalid palette values", async () => {
    if (!adminClient) throw new Error("service client unavailable");
    const bothSet = await adminClient.rpc("set_group_avatar" as never, {
      p_group_id: groupId,
      p_actor_id: owner.id,
      p_emoji: "🏠",
      p_photo_id: crypto.randomUUID(),
    } as never);
    expect(bothSet.error?.message).toContain("invalid_argument");

    const invalidEmoji = await adminClient.rpc("set_group_avatar" as never, {
      p_group_id: groupId,
      p_actor_id: owner.id,
      p_emoji: "😀",
      p_photo_id: null,
    } as never);
    expect(invalidEmoji.error?.message).toContain("invalid_argument");

    const dm = await rpc<{ groupId: string }>(ownerClient, "get_or_create_dm", {
      p_user_id: member.id,
    });
    const dmResult = await adminClient.rpc("set_group_avatar" as never, {
      p_group_id: dm.groupId,
      p_actor_id: owner.id,
      p_emoji: "🏠",
      p_photo_id: null,
    } as never);
    expect(dmResult.error?.message).toContain("invalid_operation");

    await acceptInvitation(member, dm.groupId);
    const dmRead = await memberClient.rpc("get_group_avatar" as never, {
      p_group_id: dm.groupId,
    } as never);
    expect(dmRead.error?.message).toContain("invalid_operation");
  });
});
