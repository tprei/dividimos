import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createExpense,
  createGroupWithMembers,
  createTestUser,
  createTestUsers,
  expectRpcError,
  rpcDecoded,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";
import {
  assertLedgerInvariants,
  assertLedgerInvariantsAfterEach,
} from "@/test/ledger-invariants";
import {
  decodeGroupSnapshot,
  decodeInviteLink,
  decodeMutationAck,
} from "@/lib/ledger/decode";

assertLedgerInvariantsAfterEach();

type Client = SupabaseClient<Database>;

const REJECTED_NAME = "Mongolóide";

async function createGuestExpense(
  member: TestUser,
  memberClient: Client,
  groupId: string,
): Promise<{ expenseId: string; guestId: string; token: string }> {
  const expense = await createExpense(member, {
    groupId,
    totalCents: 10000,
    payload: {
      items: [],
      participants: [
        { kind: "user", userId: member.id },
        { kind: "guest", displayName: "Cobrador" },
      ],
      shares: [5000, 5000],
      payers: [{ participantIndex: 0, amountCents: 10000 }],
      itemAssignments: null,
    },
  });
  const guestId = await withPg(async (pg) => {
    const result = await pg.query<{ id: string }>(
      "SELECT id FROM public.guests WHERE expense_id = $1 ORDER BY id LIMIT 1",
      [expense.expenseId],
    );
    return result.rows[0]?.id ?? "";
  });
  expect(guestId).not.toBe("");
  const issue = await memberClient.rpc("create_guest_claim_token", { p_guest_id: guestId });
  if (issue.error) {
    throw new Error(`create_guest_claim_token failed: ${issue.error.message}`);
  }
  const payload = issue.data;
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("create_guest_claim_token returned invalid wire data");
  }
  if (typeof payload.token !== "string") {
    throw new Error("create_guest_claim_token returned an invalid token");
  }
  return { expenseId: expense.expenseId, guestId, token: payload.token };
}

function uniqueRejectedHandle(id: string, prefix: string): string {
  return `${prefix}_${id.replace(/-/g, "").slice(0, 16)}`;
}

function correctedHandle(id: string): string {
  return `ok_${id.replace(/-/g, "").slice(0, 20)}`;
}

describe.skipIf(!isIntegrationTestReady)("membership publication moderation", () => {
  it("blocks a rejected inherited name from creating a DM until both profile fields are corrected", async () => {
    const [target] = await createTestUsers(1);
    const fresh = await createTestUser({
      name: REJECTED_NAME,
      handle: uniqueRejectedHandle(crypto.randomUUID(), "herdada"),
      onboarded: false,
    });
    const client = authenticateAs(fresh);

    expect(
      await expectRpcError(client.rpc("get_or_create_dm", { p_user_id: crypto.randomUUID() })),
    ).toBe("user_not_found");

    expect(
      await expectRpcError(client.rpc("get_or_create_dm", { p_user_id: target.id })),
    ).toBe("objectionable_content");

    const pairState = async () =>
      withPg(async (pg) => {
        const groups = await pg.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM public.groups
            WHERE dm_user_a = LEAST($1::uuid, $2::uuid) AND dm_user_b = GREATEST($1::uuid, $2::uuid)`,
          [fresh.id, target.id],
        );
        const members = await pg.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM public.group_members gm
            JOIN public.groups g ON g.id = gm.group_id
            WHERE g.kind = 'dm' AND $1::uuid IN (g.dm_user_a, g.dm_user_b)`,
          [fresh.id],
        );
        const invited = await pg.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM public.group_events
            WHERE actor_id = $1::uuid AND kind = 'member_invited'`,
          [fresh.id],
        );
        return {
          groups: groups.rows[0].count,
          members: members.rows[0].count,
          invitedEvents: invited.rows[0].count,
        };
      });
    expect(await pairState()).toEqual({ groups: 0, members: 0, invitedEvents: 0 });

    const handle = correctedHandle(fresh.id);
    const corrected = await client.rpc("update_profile", { p_name: "Ana Ok", p_handle: handle });
    expect(corrected.error).toBeNull();

    const dm = await rpcDecoded(client, "get_or_create_dm", { p_user_id: target.id }, decodeMutationAck);
    expect(dm.created).toBe(true);

    const snapshot = await rpcDecoded(
      authenticateAs(target),
      "get_group",
      { p_group_id: dm.groupId },
      decodeGroupSnapshot,
    );
    const caller = snapshot.members.find((member) => member.userId === fresh.id);
    expect(caller?.status).toBe("accepted");
    expect(caller?.user.name).toBe("Ana Ok");
    expect(caller?.user.handle).toBe(handle);
  });

  it("blocks a rejected stored handle from joining through a valid invite link until both fields are corrected", async () => {
    const [creator] = await createTestUsers(1);
    const joiner = await createTestUser({
      name: "Ana Ok",
      handle: uniqueRejectedHandle(crypto.randomUUID(), "mongoloide"),
      onboarded: false,
    });
    const creatorClient = authenticateAs(creator);
    const joinerClient = authenticateAs(joiner);
    const groupId = await createGroupWithMembers(creator, [], "Grupo link moderado");
    const link = await rpcDecoded(
      creatorClient,
      "create_invite_link",
      { p_group_id: groupId },
      decodeInviteLink,
    );

    expect(
      await expectRpcError(joinerClient.rpc("join_via_link", { p_token: "link-inexistente" })),
    ).toBe("invalid_link");

    expect(
      await expectRpcError(joinerClient.rpc("join_via_link", { p_token: link.token })),
    ).toBe("objectionable_content");

    const joinState = async () =>
      withPg(async (pg) => {
        const linkRow = await pg.query<{ use_count: number }>(
          "SELECT use_count FROM public.group_invite_links WHERE token = $1",
          [link.token],
        );
        const membership = await pg.query<{ status: string }>(
          "SELECT status FROM public.group_members WHERE group_id = $1 AND user_id = $2",
          [groupId, joiner.id],
        );
        const joined = await pg.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM public.group_events
            WHERE group_id = $1 AND kind = 'member_joined' AND subject_user_id = $2`,
          [groupId, joiner.id],
        );
        return {
          useCount: linkRow.rows[0]?.use_count ?? -1,
          membership: membership.rows,
          joinedEvents: joined.rows[0]?.count ?? -1,
        };
      });
    expect(await joinState()).toEqual({ useCount: 0, membership: [], joinedEvents: 0 });

    const handle = correctedHandle(joiner.id);
    const corrected = await joinerClient.rpc("update_profile", { p_name: "Ana Ok", p_handle: handle });
    expect(corrected.error).toBeNull();

    const ack = await rpcDecoded(joinerClient, "join_via_link", { p_token: link.token }, decodeMutationAck);
    expect(ack.groupId).toBe(groupId);
    expect(ack.eventId).not.toBeNull();

    const snapshot = await rpcDecoded(
      creatorClient,
      "get_group",
      { p_group_id: groupId },
      decodeGroupSnapshot,
    );
    const member = snapshot.members.find((row) => row.userId === joiner.id);
    expect(member?.status).toBe("accepted");
    expect(member?.user.name).toBe("Ana Ok");
    expect(member?.user.handle).toBe(handle);
  });

  it("blocks a rejected profile from claiming a guest token through claim_guest until both fields are corrected", async () => {
    const [creator, member] = await createTestUsers(2);
    const claimer = await createTestUser({
      name: REJECTED_NAME,
      handle: uniqueRejectedHandle(crypto.randomUUID(), "herdada"),
      onboarded: false,
    });
    const memberClient = authenticateAs(member);
    const claimerClient = authenticateAs(claimer);
    const groupId = await createGroupWithMembers(creator, [member], "Grupo claim moderado");
    const { expenseId, guestId, token } = await createGuestExpense(member, memberClient, groupId);

    const claimState = async () =>
      withPg(async (pg) => {
        const guest = await pg.query<{ claimed_by: string | null }>(
          "SELECT claimed_by::text FROM public.guests WHERE id = $1",
          [guestId],
        );
        const credential = await pg.query<{
          digest: string;
          generation: number;
          expiresAt: string;
        }>(
          `SELECT encode(token_digest, 'hex') AS digest, generation, expires_at::text AS "expiresAt"
             FROM guest_credentials.claim_tokens WHERE guest_id = $1`,
          [guestId],
        );
        const membership = await pg.query<{ status: string }>(
          "SELECT status FROM public.group_members WHERE group_id = $1 AND user_id = $2",
          [groupId, claimer.id],
        );
        const events = await pg.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM public.group_events WHERE group_id = $1",
          [groupId],
        );
        const versions = await pg.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM public.expense_versions WHERE expense_id = $1",
          [expenseId],
        );
        const balances = await pg.query<{
          kind: string;
          participantId: string;
          netCents: number;
        }>(
          `SELECT kind, participant_id AS "participantId", net_cents AS "netCents"
             FROM public.group_balances WHERE group_id = $1 ORDER BY kind, participant_id`,
          [groupId],
        );
        return {
          claimedBy: guest.rows.length === 1 ? guest.rows[0].claimed_by : "missing",
          credential: credential.rows[0] ?? null,
          membership: membership.rows,
          events: events.rows[0]?.count ?? -1,
          versions: versions.rows[0]?.count ?? -1,
          balances: balances.rows,
        };
      });

    const before = await claimState();
    expect(before.claimedBy).toBeNull();

    expect(
      await expectRpcError(claimerClient.rpc("claim_guest", { p_token: "token-inexistente" })),
    ).toBe("invalid_token");

    expect(
      await expectRpcError(claimerClient.rpc("claim_guest", { p_token: token })),
    ).toBe("objectionable_content");

    expect(await claimState()).toEqual(before);

    const handle = correctedHandle(claimer.id);
    const corrected = await claimerClient.rpc("update_profile", { p_name: "Ana Ok", p_handle: handle });
    expect(corrected.error).toBeNull();

    const claim = await rpcDecoded(claimerClient, "claim_guest", { p_token: token }, decodeMutationAck);
    expect(claim.expenseId).toBe(expenseId);
    expect(claim.groupId).toBe(groupId);

    const after = await claimState();
    expect(after.claimedBy).toBe(claimer.id);
    expect(after.membership).toEqual([{ status: "accepted" }]);
    await assertLedgerInvariants(groupId);
  });

  it("admits a clean unfinished account through DM creation, link join, and guest claim", async () => {
    const clean = await createTestUser({
      name: "Ana Limpa",
      handle: `limpa_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
      onboarded: false,
    });
    const [dmTarget] = await createTestUsers(1);
    const [linkHost] = await createTestUsers(1);
    const [expenseHost] = await createTestUsers(1);
    const cleanClient = authenticateAs(clean);

    const dm = await rpcDecoded(cleanClient, "get_or_create_dm", { p_user_id: dmTarget.id }, decodeMutationAck);
    expect(dm.created).toBe(true);

    const linkGroupId = await createGroupWithMembers(linkHost, [], "Grupo convite limpo");
    const link = await rpcDecoded(
      authenticateAs(linkHost),
      "create_invite_link",
      { p_group_id: linkGroupId },
      decodeInviteLink,
    );
    const joined = await rpcDecoded(cleanClient, "join_via_link", { p_token: link.token }, decodeMutationAck);
    expect(joined.groupId).toBe(linkGroupId);

    const claimGroupId = await createGroupWithMembers(expenseHost, [], "Grupo claim limpo");
    const { guestId, token } = await createGuestExpense(
      expenseHost,
      authenticateAs(expenseHost),
      claimGroupId,
    );
    const claim = await rpcDecoded(cleanClient, "claim_guest", { p_token: token }, decodeMutationAck);
    expect(claim.groupId).toBe(claimGroupId);

    const membership = await withPg(async (pg) =>
      pg.query<{ status: string }>(
        "SELECT status FROM public.group_members WHERE group_id = $1 AND user_id = $2 ORDER BY status",
        [claimGroupId, clean.id],
      ),
    );
    expect(membership.rows).toEqual([{ status: "accepted" }]);
    const guest = await withPg(async (pg) =>
      pg.query<{ claimed_by: string | null }>(
        "SELECT claimed_by::text FROM public.guests WHERE id = $1",
        [guestId],
      ),
    );
    expect(guest.rows[0]?.claimed_by).toBe(clean.id);
    await assertLedgerInvariants(claimGroupId);
  });

  it("keeps legacy rejected identities on replay paths without growing membership, events, or link use", async () => {
    const [dmActor, dmPeer] = await createTestUsers(2);
    const [linkCreator, linkMember] = await createTestUsers(2);

    const dm = await rpcDecoded(
      authenticateAs(dmActor),
      "get_or_create_dm",
      { p_user_id: dmPeer.id },
      decodeMutationAck,
    );
    expect(dm.created).toBe(true);

    const groupId = await createGroupWithMembers(linkCreator, [linkMember], "Grupo replay legado");
    const link = await rpcDecoded(
      authenticateAs(linkCreator),
      "create_invite_link",
      { p_group_id: groupId },
      decodeInviteLink,
    );

    const dmCounts = async () =>
      withPg(async (pg) => {
        const groups = await pg.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM public.groups
            WHERE dm_user_a = LEAST($1::uuid, $2::uuid) AND dm_user_b = GREATEST($1::uuid, $2::uuid)`,
          [dmActor.id, dmPeer.id],
        );
        const members = await pg.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM public.group_members gm
            JOIN public.groups g ON g.id = gm.group_id
            WHERE g.kind = 'dm' AND $1::uuid IN (g.dm_user_a, g.dm_user_b)`,
          [dmActor.id],
        );
        const events = await pg.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM public.group_events ev
            JOIN public.groups g ON g.id = ev.group_id
            WHERE g.kind = 'dm' AND $1::uuid IN (g.dm_user_a, g.dm_user_b)`,
          [dmActor.id],
        );
        return {
          groups: groups.rows[0].count,
          members: members.rows[0].count,
          events: events.rows[0].count,
        };
      });

    const linkCounts = async () =>
      withPg(async (pg) => {
        const linkRow = await pg.query<{ use_count: number }>(
          "SELECT use_count FROM public.group_invite_links WHERE token = $1",
          [link.token],
        );
        const members = await pg.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM public.group_members WHERE group_id = $1",
          [groupId],
        );
        const joined = await pg.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM public.group_events
            WHERE group_id = $1 AND kind = 'member_joined'`,
          [groupId],
        );
        return {
          useCount: linkRow.rows[0]?.use_count ?? -1,
          members: members.rows[0]?.count ?? -1,
          joinedEvents: joined.rows[0]?.count ?? -1,
        };
      });

    const dmBefore = await dmCounts();
    const linkBefore = await linkCounts();

    await withPg(async (pg) => {
      await pg.query(
        `UPDATE public.users
           SET name = $2,
               handle = 'legado_' || left(replace(id::text, '-', ''), 23)
         WHERE id = ANY($1::uuid[])`,
        [[dmActor.id, dmPeer.id, linkCreator.id, linkMember.id], REJECTED_NAME],
      );
    });

    const dmReplay = await rpcDecoded(
      authenticateAs(dmActor),
      "get_or_create_dm",
      { p_user_id: dmPeer.id },
      decodeMutationAck,
    );
    expect(dmReplay.groupId).toBe(dm.groupId);
    expect(dmReplay.created).toBe(false);
    expect(dmReplay.eventId).toBeNull();

    const joinedReplay = await rpcDecoded(
      authenticateAs(linkMember),
      "join_via_link",
      { p_token: link.token },
      decodeMutationAck,
    );
    expect(joinedReplay.groupId).toBe(groupId);
    expect(joinedReplay.eventId).toBeNull();

    expect(await dmCounts()).toEqual(dmBefore);
    expect(await linkCounts()).toEqual(linkBefore);
  });
});
