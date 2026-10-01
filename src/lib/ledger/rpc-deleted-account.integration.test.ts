import { afterAll, describe, expect, it } from "vitest";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createGroup,
  createTestUsers,
  expectRpcError,
  withPg,
} from "@/test/integration-helpers";

interface InviteLinkPayload {
  token: string;
  expiresAt: string | null;
  maxUses: number | null;
}

interface CreateGroupPayload {
  groupId: string;
  ledgerVersion: number;
  eventId: number | null;
}

interface UserProfilePayload {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string | null;
}
function sleep(ms: number): Promise<void> {
  // Real delay is needed for concurrent RPCs to reach PostgreSQL and serialize
  // behind the victim's row lock before committing the held deletion transaction.
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}


describe.skipIf(!isIntegrationTestReady)("account deletion race guards", () => {
  const createdGroupIds: string[] = [];

  afterAll(async () => {
    if (createdGroupIds.length === 0) return;
    await withPg(async (pg) => {
      await pg.query("delete from public.groups where id = any($1::uuid[])", [
        createdGroupIds,
      ]);
    });
  });

  it("serializes in-flight mutating RPCs against delete_account and prevents ghost resurrection", async () => {
    const [victim, creator] = await createTestUsers(2);
    const victimClient = authenticateAs(victim);
    const creatorClient = authenticateAs(creator);

    const { groupId } = await createGroup(creator, "Grupo do Link");
    createdGroupIds.push(groupId);

    const linkRes = await creatorClient.rpc("create_invite_link", {
      p_group_id: groupId,
    });
    expect(linkRes.error).toBeNull();
    const linkData = linkRes.data as InviteLinkPayload | null;
    const inviteToken = linkData?.token ?? "";
    expect(inviteToken).toBeTruthy();

    await withPg(async (pg) => {
      await pg.query("BEGIN");
      await pg.query("SELECT public.delete_account($1)", [victim.id]);

      // While held open, invoke mutating RPCs as the victim
      const updatePromise = victimClient.rpc("update_profile", {
        p_name: "Ghost Name",
      });
      const groupPromise = victimClient.rpc("create_group", {
        p_name: "Ghost Group",
        p_member_ids: [],
      });
      const joinPromise = victimClient.rpc("join_via_link", {
        p_token: inviteToken,
      });

      // Small delay ensuring RPC calls have started and blocked behind the victim's row lock
      await sleep(100);

      await pg.query("COMMIT");

      await expect(expectRpcError(updatePromise)).resolves.toBe("account_deleted");
      await expect(expectRpcError(groupPromise)).resolves.toBe("account_deleted");
      await expect(expectRpcError(joinPromise)).resolves.toBe("account_deleted");

      const userRes = await pg.query<{
        name: string;
        handle: string;
        onboarded: boolean;
        deleted_at: string | null;
      }>(
        "select name, handle, onboarded, deleted_at from public.users where id = $1",
        [victim.id],
      );
      expect(userRes.rows).toHaveLength(1);
      const row = userRes.rows[0];
      expect(row.handle).toMatch(/^deleted_[0-9a-f]{22}$/);
      expect(row.name).toBe("Conta excluída");
      expect(row.onboarded).toBe(false);
      expect(row.deleted_at).not.toBeNull();

      const memberRes = await pg.query(
        "select 1 from public.group_members where user_id = $1",
        [victim.id],
      );
      expect(memberRes.rows).toHaveLength(0);
    });
  });

  it("repairs a seeded ghost account when delete_account is retried", async () => {
    const [ghostUser, groupHost] = await createTestUsers(2);
    const { groupId: freshGroupId } = await createGroup(
      groupHost,
      "Grupo de Teste Ghost",
    );
    createdGroupIds.push(freshGroupId);

    await withPg(async (pg) => {
      await pg.query(
        "update public.users set handle = 'ghost_x', name = 'Ghost Real', onboarded = true, deleted_at = now() where id = $1",
        [ghostUser.id],
      );
      await pg.query(
        "insert into public.group_members (group_id, user_id, status, accepted_at) values ($1, $2, 'accepted', now())",
        [freshGroupId, ghostUser.id],
      );
    });

    if (!adminClient) throw new Error("service role key missing");
    const repairRes = await adminClient.rpc("delete_account", {
      p_user_id: ghostUser.id,
    });
    expect(repairRes.error).toBeNull();

    await withPg(async (pg) => {
      const userRes = await pg.query<{
        name: string;
        handle: string;
        onboarded: boolean;
        deleted_at: string | null;
      }>(
        "select name, handle, onboarded, deleted_at from public.users where id = $1",
        [ghostUser.id],
      );
      expect(userRes.rows).toHaveLength(1);
      const row = userRes.rows[0];
      expect(row.handle).toMatch(/^deleted_[0-9a-f]{22}$/);
      expect(row.handle).not.toBe("ghost_x");
      expect(row.name).toBe("Conta excluída");
      expect(row.onboarded).toBe(false);
      expect(row.deleted_at).not.toBeNull();

      const memberRes = await pg.query(
        "select 1 from public.group_members where user_id = $1",
        [ghostUser.id],
      );
      expect(memberRes.rows).toHaveLength(0);
    });
  });

  it("lookup_user_by_handle hides deleted accounts but finds live users", async () => {
    const [liveUser, toDeleteUser] = await createTestUsers(2);

    await withPg(async (pg) => {
      await pg.query("update public.users set deleted_at = now() where id = $1", [
        toDeleteUser.id,
      ]);
    });

    if (!adminClient) throw new Error("service role key missing");

    const deletedLookup = await adminClient.rpc("lookup_user_by_handle", {
      p_handle: toDeleteUser.handle,
    });
    expect(deletedLookup.error).toBeNull();
    expect(deletedLookup.data).toBeNull();

    const liveLookup = await adminClient.rpc("lookup_user_by_handle", {
      p_handle: liveUser.handle,
    });
    expect(liveLookup.error).toBeNull();
    const liveData = liveLookup.data as UserProfilePayload | null;
    expect(liveData).not.toBeNull();
    expect(liveData?.id).toBe(liveUser.id);
    expect(liveData?.handle).toBe(liveUser.handle);
    expect(liveData?.name).toBe(liveUser.name);
  });

  it("keeps normal profile updates and group creation working for live accounts", async () => {
    const [liveUser] = await createTestUsers(1);
    const client = authenticateAs(liveUser);

    const updateRes = await client.rpc("update_profile", {
      p_name: "Usuario Live Atualizado",
    });
    expect(updateRes.error).toBeNull();
    const updated = updateRes.data as UserProfilePayload | null;
    expect(updated?.id).toBe(liveUser.id);
    expect(updated?.name).toBe("Usuario Live Atualizado");

    const groupRes = await client.rpc("create_group", {
      p_name: "Grupo Valido Sem Erro",
      p_member_ids: [],
    });
    expect(groupRes.error).toBeNull();
    const groupData = groupRes.data as CreateGroupPayload | null;
    expect(groupData?.groupId).toBeDefined();
    if (groupData?.groupId) {
      createdGroupIds.push(groupData.groupId);
    }
  });
});
