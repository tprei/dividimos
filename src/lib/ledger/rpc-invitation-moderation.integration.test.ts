import { describe, expect, it } from "vitest";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createGroupWithMembers,
  createTestUsers,
  expectRpcError,
  rpcDecoded,
  withPg,
} from "@/test/integration-helpers";
import { assertLedgerInvariantsAfterEach } from "@/test/ledger-invariants";
import { decodeMutationAck } from "@/lib/ledger/decode";

assertLedgerInvariantsAfterEach();

interface MembershipState {
  membership: string[];
  events: string[];
}

async function membershipState(groupId: string, userId: string): Promise<MembershipState> {
  return withPg(async (pg) => {
    const membership = await pg.query<{ status: string }>(
      "SELECT status FROM public.group_members WHERE group_id = $1 AND user_id = $2",
      [groupId, userId],
    );
    const events = await pg.query<{ kind: string }>(
      `SELECT kind FROM public.group_events
        WHERE group_id = $1 AND subject_user_id = $2 ORDER BY id`,
      [groupId, userId],
    );
    return {
      membership: membership.rows.map((row) => row.status),
      events: events.rows.map((row) => row.kind),
    };
  });
}

async function setStoredIdentity(userId: string, name: string, handle: string): Promise<void> {
  await withPg(async (pg) => {
    await pg.query("UPDATE public.users SET name = $2, handle = $3 WHERE id = $1", [
      userId,
      name,
      handle,
    ]);
  });
}

function suffix(id: string): string {
  return id.replace(/-/g, "").slice(0, 16);
}

describe.skipIf(!isIntegrationTestReady)("invitation moderation", () => {
  it("blocks a member with an objectionable stored name from inviting until the name is corrected", async () => {
    const [inviter, earlierInvitee, target] = await createTestUsers(3);
    const inviterClient = authenticateAs(inviter);
    const groupId = await createGroupWithMembers(inviter, [], "Grupo convite moderado");

    const earlier = await rpcDecoded(
      inviterClient,
      "invite_member",
      { p_group_id: groupId, p_user_id: earlierInvitee.id },
      decodeMutationAck,
    );
    expect(earlier.eventId).not.toBeNull();

    await setStoredIdentity(inviter.id, "Mongolóide", inviter.handle);

    expect(
      await expectRpcError(
        inviterClient.rpc("invite_member", { p_group_id: groupId, p_user_id: target.id }),
      ),
    ).toBe("objectionable_content");
    expect(await membershipState(groupId, target.id)).toEqual({ membership: [], events: [] });

    const replay = await rpcDecoded(
      inviterClient,
      "invite_member",
      { p_group_id: groupId, p_user_id: earlierInvitee.id },
      decodeMutationAck,
    );
    expect(replay.eventId).toBeNull();
    expect(await membershipState(groupId, earlierInvitee.id)).toEqual({
      membership: ["invited"],
      events: ["member_invited"],
    });

    const corrected = await inviterClient.rpc("update_profile", { p_name: "Ana Ok" });
    expect(corrected.error).toBeNull();

    const invited = await rpcDecoded(
      inviterClient,
      "invite_member",
      { p_group_id: groupId, p_user_id: target.id },
      decodeMutationAck,
    );
    expect(invited.eventId).not.toBeNull();
    expect(await membershipState(groupId, target.id)).toEqual({
      membership: ["invited"],
      events: ["member_invited"],
    });
  });

  it("blocks an invitee with an objectionable stored handle from accepting until the handle is corrected", async () => {
    const [creator, invitee] = await createTestUsers(2);
    const groupId = await createGroupWithMembers(creator, [], "Grupo aceite moderado");
    await rpcDecoded(
      authenticateAs(creator),
      "invite_member",
      { p_group_id: groupId, p_user_id: invitee.id },
      decodeMutationAck,
    );

    await setStoredIdentity(invitee.id, invitee.name, `mongoloide_${suffix(invitee.id)}`);
    const inviteeClient = authenticateAs(invitee);

    expect(
      await expectRpcError(inviteeClient.rpc("accept_invitation", { p_group_id: groupId })),
    ).toBe("objectionable_content");
    expect(await membershipState(groupId, invitee.id)).toEqual({
      membership: ["invited"],
      events: ["member_invited"],
    });

    const corrected = await inviteeClient.rpc("update_profile", {
      p_handle: `ok_${suffix(invitee.id)}`,
    });
    expect(corrected.error).toBeNull();

    const accepted = await rpcDecoded(
      inviteeClient,
      "accept_invitation",
      { p_group_id: groupId },
      decodeMutationAck,
    );
    expect(accepted.eventId).not.toBeNull();
    expect(await membershipState(groupId, invitee.id)).toEqual({
      membership: ["accepted"],
      events: ["member_invited", "member_joined"],
    });
  });
});
