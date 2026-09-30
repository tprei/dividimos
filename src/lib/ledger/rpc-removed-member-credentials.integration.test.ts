import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  acceptInvitation,
  authenticateAs,
  createExpense,
  createGroupWithMembers,
  createTestUsers,
  expectRpcError,
  withPg,
} from "@/test/integration-helpers";

interface MutationAck {
  groupId: string;
  ledgerVersion: number;
  eventId: number | null;
}

interface ClaimAck {
  expenseId: string;
  groupId: string;
  ledgerVersion: number;
  eventId: number | null;
}

interface InviteLinkAck {
  groupId: string;
  token: string;
  expiresAt: string | null;
  maxUses: number | null;
}

interface IssuedToken {
  token: string;
  expiresAt: string;
}

type RpcResult<T> = { data: T | null; error: { message: string } | null };

async function rpcOk<T>(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = (await client.rpc(fn, args)) as RpcResult<T>;
  if (error) {
    throw new Error(`${fn} failed: ${error.message}`);
  }
  return data as T;
}

async function rpcErrorCode(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<string> {
  return expectRpcError(Promise.resolve(client.rpc(fn, args)));
}

async function membershipRows(
  groupId: string,
  userId: string,
): Promise<Array<{ status: string }>> {
  return withPg(async (client) => {
    const result = await client.query<{ status: string }>(
      "select status from public.group_members where group_id = $1 and user_id = $2",
      [groupId, userId],
    );
    return result.rows;
  });
}

async function countRows(query: string, params: unknown[]): Promise<number> {
  return withPg(async (client) => {
    const result = await client.query<{ count: string }>(query, params);
    return Number(result.rows[0].count);
  });
}

async function linkIsActive(groupId: string, token: string): Promise<boolean> {
  return withPg(async (client) => {
    const result = await client.query<{ is_active: boolean }>(
      "select is_active from public.group_invite_links where group_id = $1 and token = $2",
      [groupId, token],
    );
    return result.rows[0]?.is_active ?? false;
  });
}

async function claimTokenCreatedBy(guestId: string): Promise<string | null> {
  return withPg(async (client) => {
    const result = await client.query<{ created_by: string | null }>(
      "select created_by from guest_credentials.claim_tokens where guest_id = $1",
      [guestId],
    );
    return result.rows[0]?.created_by ?? null;
  });
}

async function guestIdByName(expenseId: string, displayName: string): Promise<string> {
  const id = await withPg(async (client) => {
    const result = await client.query<{ id: string }>(
      "select id from public.guests where expense_id = $1 and display_name = $2",
      [expenseId, displayName],
    );
    return result.rows[0]?.id ?? "";
  });
  expect(id).not.toBe("");
  return id;
}

async function exclusionCount(groupId: string, userId: string): Promise<number> {
  return countRows(
    "select count(*)::text as count from public.group_member_exclusions where group_id = $1 and user_id = $2",
    [groupId, userId],
  );
}

describe.skipIf(!isIntegrationTestReady)(
  "removed-member credentials — departures kill the invite links and guest tokens the departing member minted",
  () => {
    it("deactivates a removed member's invite link so a sockpuppet cannot join through it", async () => {
      const [alice, bob, carol, sockpuppet] = await createTestUsers(4);
      const aliceClient = authenticateAs(alice);
      const carolClient = authenticateAs(carol);
      const sockpuppetClient = authenticateAs(sockpuppet);

      const groupId = await createGroupWithMembers(alice, [bob, carol], "Grupo elo removido");

      const link = await rpcOk<InviteLinkAck>(carolClient, "create_invite_link", {
        p_group_id: groupId,
      });

      await rpcOk<MutationAck>(aliceClient, "remove_member", {
        p_group_id: groupId,
        p_user_id: carol.id,
      });

      expect(
        await rpcErrorCode(sockpuppetClient, "join_via_link", { p_token: link.token }),
      ).toBe("invalid_link");
      expect(
        await rpcErrorCode(carolClient, "join_via_link", { p_token: link.token }),
      ).toBe("invalid_link");
      expect(await linkIsActive(groupId, link.token)).toBe(false);
      expect(await membershipRows(groupId, sockpuppet.id)).toEqual([]);
    });

    it("deactivates a leaving member's invite link so a sockpuppet cannot join through it", async () => {
      const [alice, bob, sockpuppet] = await createTestUsers(3);
      const bobClient = authenticateAs(bob);
      const sockpuppetClient = authenticateAs(sockpuppet);

      const groupId = await createGroupWithMembers(alice, [bob], "Grupo elo saída");

      const link = await rpcOk<InviteLinkAck>(bobClient, "create_invite_link", {
        p_group_id: groupId,
      });

      await rpcOk<MutationAck>(bobClient, "leave_group", { p_group_id: groupId });

      expect(
        await rpcErrorCode(sockpuppetClient, "join_via_link", { p_token: link.token }),
      ).toBe("invalid_link");
      expect(await linkIsActive(groupId, link.token)).toBe(false);
      expect(await membershipRows(groupId, sockpuppet.id)).toEqual([]);
    });

    it("deletes a removed member's guest claim token so a sockpuppet cannot claim the guest", async () => {
      const [alice, carol, sockpuppet] = await createTestUsers(3);
      const aliceClient = authenticateAs(alice);
      const carolClient = authenticateAs(carol);
      const sockpuppetClient = authenticateAs(sockpuppet);

      const groupId = await createGroupWithMembers(alice, [carol], "Grupo token removido");
      // Only alice and the guest carry balances, so carol is removable.
      const expense = await createExpense(alice, {
        groupId,
        totalCents: 10000,
        payload: {
          items: [],
          participants: [
            { kind: "user", userId: alice.id },
            { kind: "guest", guestId: null, displayName: "Zé" },
          ],
          shares: [5000, 5000],
          payers: [{ participantIndex: 0, amountCents: 10000 }],
          itemAssignments: null,
        },
      });
      const guestId = await guestIdByName(expense.expenseId, "Zé");

      const token = await rpcOk<IssuedToken>(carolClient, "create_guest_claim_token", {
        p_guest_id: guestId,
      });
      expect(await claimTokenCreatedBy(guestId)).toBe(carol.id);

      await rpcOk<MutationAck>(aliceClient, "remove_member", {
        p_group_id: groupId,
        p_user_id: carol.id,
      });

      expect(
        await rpcErrorCode(sockpuppetClient, "claim_guest", { p_token: token.token }),
      ).toBe("invalid_token");
      expect(
        await countRows(
          "select count(*)::text as count from guest_credentials.claim_tokens where guest_id = $1",
          [guestId],
        ),
      ).toBe(0);
      expect(await membershipRows(groupId, sockpuppet.id)).toEqual([]);
    });

    it("keeps a remaining member's invite link working after another member is removed", async () => {
      const [alice, bob, carol, sockpuppet] = await createTestUsers(4);
      const aliceClient = authenticateAs(alice);
      const bobClient = authenticateAs(bob);
      const carolClient = authenticateAs(carol);
      const sockpuppetClient = authenticateAs(sockpuppet);

      const groupId = await createGroupWithMembers(alice, [bob, carol], "Grupo elo alheio");

      const carolLink = await rpcOk<InviteLinkAck>(carolClient, "create_invite_link", {
        p_group_id: groupId,
      });

      await rpcOk<MutationAck>(aliceClient, "remove_member", {
        p_group_id: groupId,
        p_user_id: carol.id,
      });
      expect(await linkIsActive(groupId, carolLink.token)).toBe(false);

      const bobLink = await rpcOk<InviteLinkAck>(bobClient, "create_invite_link", {
        p_group_id: groupId,
      });
      expect(await linkIsActive(groupId, bobLink.token)).toBe(true);

      const joined = await rpcOk<MutationAck>(sockpuppetClient, "join_via_link", {
        p_token: bobLink.token,
      });
      expect(joined.groupId).toBe(groupId);
      expect(
        (await membershipRows(groupId, sockpuppet.id)).map((row) => row.status),
      ).toEqual(["accepted"]);
    });

    it("keeps another member's guest claim token working after a removal", async () => {
      const [alice, bob, carol, sockpuppetVictim, sockpuppetJoiner] = await createTestUsers(5);
      const aliceClient = authenticateAs(alice);
      const bobClient = authenticateAs(bob);
      const carolClient = authenticateAs(carol);
      const victimClient = authenticateAs(sockpuppetVictim);
      const joinerClient = authenticateAs(sockpuppetJoiner);

      const groupId = await createGroupWithMembers(alice, [bob, carol], "Grupo token alheio");
      // Only alice and the guests carry balances, so carol is removable.
      const expense = await createExpense(alice, {
        groupId,
        totalCents: 10000,
        payload: {
          items: [],
          participants: [
            { kind: "user", userId: alice.id },
            { kind: "guest", guestId: null, displayName: "Zé" },
            { kind: "guest", guestId: null, displayName: "Maria" },
          ],
          shares: [4000, 3000, 3000],
          payers: [{ participantIndex: 0, amountCents: 10000 }],
          itemAssignments: null,
        },
      });
      const carolGuestId = await guestIdByName(expense.expenseId, "Zé");
      const bobGuestId = await guestIdByName(expense.expenseId, "Maria");

      const carolToken = await rpcOk<IssuedToken>(carolClient, "create_guest_claim_token", {
        p_guest_id: carolGuestId,
      });
      const bobToken = await rpcOk<IssuedToken>(bobClient, "create_guest_claim_token", {
        p_guest_id: bobGuestId,
      });
      expect(await claimTokenCreatedBy(carolGuestId)).toBe(carol.id);
      expect(await claimTokenCreatedBy(bobGuestId)).toBe(bob.id);

      await rpcOk<MutationAck>(aliceClient, "remove_member", {
        p_group_id: groupId,
        p_user_id: carol.id,
      });

      expect(
        await rpcErrorCode(victimClient, "claim_guest", { p_token: carolToken.token }),
      ).toBe("invalid_token");
      expect(
        await countRows(
          "select count(*)::text as count from guest_credentials.claim_tokens where guest_id = $1",
          [carolGuestId],
        ),
      ).toBe(0);

      const ack = await rpcOk<ClaimAck>(joinerClient, "claim_guest", {
        p_token: bobToken.token,
      });
      expect(ack.groupId).toBe(groupId);
      expect(
        (await membershipRows(groupId, sockpuppetJoiner.id)).map((row) => row.status),
      ).toEqual(["accepted"]);
      expect(
        await countRows(
          "select count(*)::text as count from guest_credentials.claim_tokens where guest_id = $1 and created_by = $2",
          [bobGuestId, bob.id],
        ),
      ).toBe(1);
    });

    it("keeps the removal happy path and lets the creator re-invite the removed member", async () => {
      const [alice, bob, carol] = await createTestUsers(3);
      const aliceClient = authenticateAs(alice);
      const carolClient = authenticateAs(carol);

      const groupId = await createGroupWithMembers(alice, [bob, carol], "Grupo recondução");

      const link = await rpcOk<InviteLinkAck>(carolClient, "create_invite_link", {
        p_group_id: groupId,
      });

      await rpcOk<MutationAck>(aliceClient, "remove_member", {
        p_group_id: groupId,
        p_user_id: carol.id,
      });
      expect(await membershipRows(groupId, carol.id)).toEqual([]);
      expect(await exclusionCount(groupId, carol.id)).toBe(1);
      expect(
        await countRows(
          "select count(*)::text as count from public.group_member_departures where group_id = $1 and user_id = $2",
          [groupId, carol.id],
        ),
      ).toBe(1);
      expect(await linkIsActive(groupId, link.token)).toBe(false);

      await rpcOk(aliceClient, "invite_member", {
        p_group_id: groupId,
        p_user_id: carol.id,
      });
      expect(await exclusionCount(groupId, carol.id)).toBe(0);
      await acceptInvitation(carol, groupId);
      expect(
        (await membershipRows(groupId, carol.id)).map((row) => row.status),
      ).toEqual(["accepted"]);

      // Carol is a member again and can mint a fresh link despite the
      // revoked predecessor: the one-active-link index still holds.
      const newLink = await rpcOk<InviteLinkAck>(carolClient, "create_invite_link", {
        p_group_id: groupId,
      });
      expect(await linkIsActive(groupId, newLink.token)).toBe(true);
    });

    it("keeps the leave_group happy path markers unchanged", async () => {
      const [alice, bob] = await createTestUsers(2);
      const bobClient = authenticateAs(bob);

      const groupId = await createGroupWithMembers(alice, [bob], "Grupo saída simples");

      await rpcOk<MutationAck>(bobClient, "leave_group", { p_group_id: groupId });
      expect(await membershipRows(groupId, bob.id)).toEqual([]);
      expect(
        await countRows(
          "select count(*)::text as count from public.group_member_departures where group_id = $1 and user_id = $2",
          [groupId, bob.id],
        ),
      ).toBe(1);
      expect(await exclusionCount(groupId, bob.id)).toBe(0);
    });
  },
);
