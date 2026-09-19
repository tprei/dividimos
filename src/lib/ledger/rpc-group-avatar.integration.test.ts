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

type Avatar = { kind: "initials" | "emoji" | "photo"; emoji?: string; photoId?: string };
async function rpc<T>(client: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
  const result = (await client.rpc(name as never, args as never)) as { data: T | null; error: { message: string } | null };
  if (result.error) throw new Error(`${name} failed: ${result.error.message}`);
  if (result.data === null) throw new Error(`${name} returned no data`);
  return result.data;
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
    const { error } = await ownerClient.rpc("invite_member" as never, { p_group_id: groupId, p_user_id: pending.id } as never);
    if (error) throw new Error(`invite_member failed: ${error.message}`);
  });

  it("keeps setter service-only and protects accepted-member reads", async () => {
    if (!adminClient) throw new Error("service client unavailable");
    const ack = await rpc<{ groupId: string; ledgerVersion: number; previousPhotoId: string | null }>(adminClient, "set_group_avatar", { p_group_id: groupId, p_actor_id: owner.id, p_emoji: "🍕", p_photo_id: null });
    expect(ack).toMatchObject({ groupId, previousPhotoId: null });
    await expect(rpc<Avatar>(memberClient, "get_group_avatar", { p_group_id: groupId })).resolves.toEqual({ kind: "emoji", emoji: "🍕" });
    await expect(expectRpcError(pendingClient.rpc("get_group_avatar" as never, { p_group_id: groupId } as never))).resolves.toContain("not_a_member");
    await expect(expectRpcError(outsiderClient.rpc("get_group_avatar" as never, { p_group_id: groupId } as never))).resolves.toContain("not_a_member");
    const denied = await memberClient.rpc("set_group_avatar" as never, { p_group_id: groupId, p_actor_id: member.id, p_emoji: "🏠", p_photo_id: null } as never);
    expect(denied.error?.message).toMatch(/permission denied|not exist/i);
  });

  it("rejects ambiguous values, DMs, and emojis outside the palette", async () => {
    if (!adminClient) throw new Error("service client unavailable");
    const both = await adminClient.rpc("set_group_avatar" as never, { p_group_id: groupId, p_actor_id: owner.id, p_emoji: "🏠", p_photo_id: crypto.randomUUID() } as never);
    expect(both.error?.message).toContain("invalid_argument");
    const invalid = await adminClient.rpc("set_group_avatar" as never, { p_group_id: groupId, p_actor_id: owner.id, p_emoji: "😀", p_photo_id: null } as never);
    expect(invalid.error?.message).toContain("invalid_argument");
    const dm = await rpc<{ groupId: string }>(ownerClient, "get_or_create_dm", { p_user_id: member.id });
    const dmSet = await adminClient.rpc("set_group_avatar" as never, { p_group_id: dm.groupId, p_actor_id: owner.id, p_emoji: "🏠", p_photo_id: null } as never);
    expect(dmSet.error?.message).toContain("invalid_operation");
    await acceptInvitation(member, dm.groupId);
    const dmRead = await memberClient.rpc("get_group_avatar" as never, { p_group_id: dm.groupId } as never);
    expect(dmRead.error?.message).toContain("invalid_operation");
  });
});
