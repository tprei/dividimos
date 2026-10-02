import { describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import type { ExpensePayload } from "@/types/ledger";
import { buildAssignmentExpense } from "@/lib/assignment-room-money";
import type { AssignmentRoomView } from "@/types/assignment-room";
import {
  decodeAnnounceAssignmentRoomResult,
  decodeAssignmentRoomView,
  decodeFinalizeAssignmentRoomResult,
  decodeHostedAssignmentRooms,
  decodeOpenAssignmentRooms,
  type FinalizeAssignmentRoomResult,
} from "@/lib/ledger/decode-assignment-room";
import { decodeMutationAck } from "@/lib/ledger/decode";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  acceptInvitation,
  authenticateAs,
  createGroupWithMembers,
  createTestUsers,
  decodeRpcData,
  expectRpcError,
  getBalances,
  rpcDecoded,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";
import { assertLedgerInvariantsAfterEach } from "@/test/ledger-invariants";

assertLedgerInvariantsAfterEach();

type Client = SupabaseClient<Database>;
type CreateRoomArgs =
  Database["public"]["Functions"]["create_assignment_room"]["Args"];
type RoomView = AssignmentRoomView;

const header = {
  title: "Conta da dupla",
  occurredOn: "2026-09-19",
  serviceFeeBasisPoints: 1_000,
  fixedFeeCents: 100,
};

const items = [
  {
    description: "Prato",
    quantityMilliunits: 1_000,
    unitPriceCents: 2_500,
    totalPriceCents: 2_500,
  },
];

function joinToken(fill = "A"): string {
  return `armj1_${fill.repeat(43)}`;
}

function memberToken(): string {
  const random = crypto.randomUUID().replaceAll("-", "") + "AAAAAAAAAAA";
  return `armm1_${random}`;
}

function participants(host: TestUser, extra: Json[] = []): Json[] {
  return [
    { id: crypto.randomUUID(), displayName: host.name, userId: host.id },
    ...extra,
  ];
}

function roomArgs(
  host: TestUser,
  overrides: Partial<CreateRoomArgs> = {}
): CreateRoomArgs {
  return {
    p_room_id: crypto.randomUUID(),
    p_group_target: { kind: "new", name: "Viagem" },
    p_header: header,
    p_items: items,
    p_participants: participants(host),
    p_join_token: joinToken(),
    ...overrides,
  };
}

async function createRoom(
  client: Client,
  args: CreateRoomArgs
): Promise<RoomView> {
  return rpcDecoded(
    client,
    "create_assignment_room",
    args,
    decodeAssignmentRoomView
  );
}

async function joinRoom(
  client: Client,
  roomId: string,
  roomJoinToken: string,
  roomMemberToken: string,
  displayName: string
): Promise<RoomView> {
  return rpcDecoded(
    client,
    "join_assignment_room",
    {
      p_room_id: roomId,
      p_join_token: roomJoinToken,
      p_member_token: roomMemberToken,
      p_display_name: displayName,
    },
    decodeAssignmentRoomView
  );
}

async function claim(
  client: Client,
  roomId: string,
  roomMemberToken: string | null,
  itemId: string,
  participantId: string,
  expectedItemRevision: number,
  ticks: number
): Promise<RoomView> {
  return rpcDecoded(
    client,
    "set_assignment_room_claim",
    {
      p_room_id: roomId,
      p_member_token: roomMemberToken,
      p_item_id: itemId,
      p_participant_id: participantId,
      p_expected_item_revision: expectedItemRevision,
      p_ticks: ticks,
    } as never,
    decodeAssignmentRoomView
  );
}

async function closeRoom(
  client: Client,
  roomId: string,
  expectedRevision: number
): Promise<RoomView> {
  return rpcDecoded(
    client,
    "close_assignment_room",
    { p_room_id: roomId, p_expected_revision: expectedRevision },
    decodeAssignmentRoomView
  );
}

function expensePayload(view: RoomView, payerIndex = 0): ExpensePayload {
  if (view.role !== "host") {
    throw new Error("expected a host view to build the expense payload");
  }
  const built = buildAssignmentExpense(view, [
    { participantIndex: payerIndex, amountCents: view.room.totalCents },
  ]);
  if (!built.ok) throw new Error(JSON.stringify(built.issue));
  return built.value;
}

async function finalize(
  client: Client,
  roomId: string,
  revision: number,
  payload: ExpensePayload
): Promise<FinalizeAssignmentRoomResult> {
  return rpcDecoded(
    client,
    "finalize_assignment_room",
    {
      p_room_id: roomId,
      p_expected_revision: revision,
      p_payload: payload,
    },
    decodeFinalizeAssignmentRoomResult
  );
}

async function createDm(client: Client, otherUserId: string): Promise<string> {
  const { data, error } = await client.rpc("get_or_create_dm", {
    p_user_id: otherUserId,
  });
  if (error) throw new Error(error.message);
  const { groupId } = decodeRpcData("get_or_create_dm", data, decodeMutationAck);
  if (!groupId) throw new Error("get_or_create_dm returned no groupId");
  return groupId;
}

async function dmPair(): Promise<{
  host: TestUser;
  partner: TestUser;
  hostClient: Client;
  partnerClient: Client;
  dmId: string;
}> {
  const [host, partner] = await createTestUsers(2);
  const hostClient = authenticateAs(host);
  const partnerClient = authenticateAs(partner);
  const dmId = await createDm(hostClient, partner.id);
  return { host, partner, hostClient, partnerClient, dmId };
}

function dmRoomArgs(
  host: TestUser,
  dmId: string,
  overrides: Partial<CreateRoomArgs> = {}
): CreateRoomArgs {
  return roomArgs(host, {
    p_group_target: { kind: "existing", groupId: dmId },
    ...overrides,
  });
}

describe.skipIf(!isIntegrationTestReady)("assignment rooms on DMs", () => {
  it("opens a room against the DM and normalizes the stored group target", async () => {
    const { host, hostClient, dmId } = await dmPair();
    const args = dmRoomArgs(host, dmId);
    const view = await createRoom(hostClient, args);
    if (view.role !== "host") {
      throw new Error("expected the creator to receive a host view");
    }
    expect(view.groupTarget).toEqual({ kind: "existing", groupId: dmId });

    const stored = await withPg(async (db) => {
      const result = await db.query<{ group_target: Json }>(
        "select group_target from public.assignment_rooms where id = $1",
        [args.p_room_id]
      );
      return result.rows[0].group_target;
    });
    expect(stored).toEqual({ kind: "existing", groupId: dmId });
  });

  it("rejects a DM room with a second participant, guest or partner alike", async () => {
    const { host, partner, hostClient, dmId } = await dmPair();
    const withGuest = dmRoomArgs(host, dmId, {
      p_participants: participants(host, [
        { id: crypto.randomUUID(), displayName: "Convidada", userId: null },
      ]),
    });
    expect(
      await expectRpcError(hostClient.rpc("create_assignment_room", withGuest))
    ).toContain("invalid_argument");

    const withPartner = dmRoomArgs(host, dmId, {
      p_participants: participants(host, [
        {
          id: crypto.randomUUID(),
          displayName: partner.name,
          userId: partner.id,
        },
      ]),
    });
    expect(
      await expectRpcError(hostClient.rpc("create_assignment_room", withPartner))
    ).toContain("invalid_argument");
  });

  it("rejects a room against the DM from an account outside the pair", async () => {
    const [host, partner] = await createTestUsers(2);
    const dmId = await createDm(authenticateAs(host), partner.id);
    const [outsider] = await createTestUsers(1);
    const outsiderClient = authenticateAs(outsider);
    const args = dmRoomArgs(outsider, dmId);
    expect(
      await expectRpcError(outsiderClient.rpc("create_assignment_room", args))
    ).toContain("not_a_member");
  });

  it("admits the partner through the join link and records the partner's account", async () => {
    const { host, partner, hostClient, partnerClient, dmId } = await dmPair();
    const args = dmRoomArgs(host, dmId);
    const created = await createRoom(hostClient, args);
    const joined = await joinRoom(
      partnerClient,
      args.p_room_id,
      args.p_join_token,
      memberToken(),
      ""
    );
    expect(joined.role).toBe("participant");
    expect(joined.room.revision).toBe(created.room.revision + 1);

    const rows = await withPg(async (db) => {
      const result = await db.query<{
        user_id: string | null;
        display_name: string;
      }>(
        "select user_id, display_name from public.assignment_room_participants " +
          "where room_id = $1 order by ordinal",
        [args.p_room_id]
      );
      return result.rows;
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ user_id: host.id });
    expect(rows[1]).toMatchObject({ user_id: partner.id, display_name: partner.name });
  });

  it("refuses an anonymous visitor with dm_room_pair_only", async () => {
    const { host, hostClient, dmId } = await dmPair();
    const args = dmRoomArgs(host, dmId);
    await createRoom(hostClient, args);
    const anonymous = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    expect(
      await expectRpcError(
        anonymous.rpc("join_assignment_room", {
          p_room_id: args.p_room_id,
          p_join_token: args.p_join_token,
          p_member_token: memberToken(),
          p_display_name: "Bia",
        })
      )
    ).toContain("dm_room_pair_only");
  });

  it("refuses a third onboarded account with dm_room_pair_only", async () => {
    const { host, hostClient, dmId } = await dmPair();
    const args = dmRoomArgs(host, dmId);
    await createRoom(hostClient, args);
    const [outsider] = await createTestUsers(1);
    expect(
      await expectRpcError(
        authenticateAs(outsider).rpc("join_assignment_room", {
          p_room_id: args.p_room_id,
          p_join_token: args.p_join_token,
          p_member_token: memberToken(),
          p_display_name: "",
        })
      )
    ).toContain("dm_room_pair_only");
  });

  it("refuses a pair member blocked with the host with dm_room_pair_only", async () => {
    const { host, hostClient, partnerClient, dmId } = await dmPair();
    const args = dmRoomArgs(host, dmId);
    await createRoom(hostClient, args);
    const blocked = await partnerClient.rpc("block_user", {
      p_user_id: host.id,
    });
    if (blocked.error) throw new Error(blocked.error.message);

    expect(
      await expectRpcError(
        partnerClient.rpc("join_assignment_room", {
          p_room_id: args.p_room_id,
          p_join_token: args.p_join_token,
          p_member_token: memberToken(),
          p_display_name: "",
        })
      )
    ).toContain("dm_room_pair_only");
  });

  it("lets the accepted partner enter fresh from the DM and denies a third account", async () => {
    const { host, hostClient, partner, partnerClient, dmId } = await dmPair();
    const args = dmRoomArgs(host, dmId);
    await createRoom(hostClient, args);
    await acceptInvitation(partner, dmId);

    const entered = await rpcDecoded(
      partnerClient,
      "enter_group_assignment_room",
      { p_room_id: args.p_room_id, p_member_token: memberToken() },
      decodeAssignmentRoomView
    );
    expect(entered.role).toBe("participant");

    const rows = await withPg(async (db) => {
      const result = await db.query<{ user_id: string | null }>(
        "select user_id from public.assignment_room_participants " +
          "where room_id = $1 order by ordinal",
        [args.p_room_id]
      );
      return result.rows;
    });
    expect(rows).toEqual([{ user_id: host.id }, { user_id: partner.id }]);

    const [outsider] = await createTestUsers(1);
    expect(
      await expectRpcError(
        authenticateAs(outsider).rpc("enter_group_assignment_room", {
          p_room_id: args.p_room_id,
          p_member_token: memberToken(),
        })
      )
    ).toContain("not_a_member");
  });

  it("lists the open room in the DM for both pair members", async () => {
    const { host, hostClient, partner, partnerClient, dmId } = await dmPair();
    const args = dmRoomArgs(host, dmId);
    await createRoom(hostClient, args);
    await joinRoom(
      partnerClient,
      args.p_room_id,
      args.p_join_token,
      memberToken(),
      ""
    );
    await acceptInvitation(partner, dmId);

    const hostRooms = await rpcDecoded(
      hostClient,
      "list_open_assignment_rooms",
      { p_group_id: dmId },
      decodeOpenAssignmentRooms
    );
    const partnerRooms = await rpcDecoded(
      partnerClient,
      "list_open_assignment_rooms",
      { p_group_id: dmId },
      decodeOpenAssignmentRooms
    );
    expect(hostRooms.map((room) => room.id)).toContain(args.p_room_id);
    expect(partnerRooms.map((room) => room.id)).toContain(args.p_room_id);
    expect(partnerRooms.find((room) => room.id === args.p_room_id)?.joined).toBe(
      true
    );
  });

  it("announces a DM room once and replays the same event", async () => {
    const { host, hostClient, dmId } = await dmPair();
    const args = dmRoomArgs(host, dmId);
    await createRoom(hostClient, args);

    const first = await rpcDecoded(
      hostClient,
      "announce_assignment_room",
      { p_room_id: args.p_room_id },
      decodeAnnounceAssignmentRoomResult
    );
    const replay = await rpcDecoded(
      hostClient,
      "announce_assignment_room",
      { p_room_id: args.p_room_id },
      decodeAnnounceAssignmentRoomResult
    );
    expect(replay.eventId).toBe(first.eventId);

    const events = await withPg(async (db) => {
      const result = await db.query<{ kind: string }>(
        "select kind from public.group_events where payload->>'roomId' = $1",
        [args.p_room_id]
      );
      return result.rows;
    });
    expect(events).toEqual([{ kind: "assignment_room_opened" }]);
  });

  it("finalizes into the DM with exactly the two users and recomputed balances", async () => {
    const { host, hostClient, partner, partnerClient, dmId } = await dmPair();
    const args = dmRoomArgs(host, dmId);
    const created = await createRoom(hostClient, args);
    await acceptInvitation(partner, dmId);
    const token = memberToken();
    const joined = await joinRoom(
      partnerClient,
      args.p_room_id,
      args.p_join_token,
      token,
      ""
    );
    let current = await claim(
      hostClient,
      args.p_room_id,
      null,
      created.room.items[0].id,
      created.room.selfParticipantId,
      created.room.items[0].revision,
      60_000
    );
    current = await claim(
      partnerClient,
      args.p_room_id,
      token,
      current.room.items[0].id,
      joined.room.selfParticipantId,
      current.room.items[0].revision,
      60_000
    );
    const closed = await closeRoom(hostClient, args.p_room_id, current.room.revision);
    const result = await finalize(
      hostClient,
      args.p_room_id,
      closed.room.revision,
      expensePayload(closed)
    );

    expect(result.room.room.status).toBe("finalized");
    expect(result.ack.groupId).toBe(dmId);

    const ledger = await withPg(async (db) => {
      const rows = await db.query<{
        expense_group: string;
        guests: number;
        user_balances: number;
        guest_balances: number;
        balance_sum: number;
      }>(
        "select " +
          "(select group_id::text from public.expenses where id = $2) as expense_group, " +
          "(select count(*) from public.guests where expense_id = $2)::int as guests, " +
          "(select count(*) from public.group_balances where group_id = $1 and kind = 'user')::int as user_balances, " +
          "(select count(*) from public.group_balances where group_id = $1 and kind = 'guest')::int as guest_balances, " +
          "(select coalesce(sum(net_cents), 0)::int from public.group_balances where group_id = $1) as balance_sum",
        [dmId, result.ack.expenseId]
      );
      return rows.rows[0];
    });
    expect(ledger).toEqual({
      expense_group: dmId,
      guests: 0,
      user_balances: 2,
      guest_balances: 0,
      balance_sum: 0,
    });

    const nets = (await getBalances(dmId))
      .map((balance) => balance.net_cents)
      .sort((a, b) => a - b);
    expect(nets[0]).toBeLessThan(0);
    expect(nets[1]).toBeGreaterThan(0);
  });

  it("finalizes while the partner is still only invited on the DM", async () => {
    const { host, hostClient, partner, partnerClient, dmId } = await dmPair();
    const args = dmRoomArgs(host, dmId);
    const created = await createRoom(hostClient, args);
    const token = memberToken();
    const joined = await joinRoom(
      partnerClient,
      args.p_room_id,
      args.p_join_token,
      token,
      ""
    );
    let current = await claim(
      hostClient,
      args.p_room_id,
      null,
      created.room.items[0].id,
      created.room.selfParticipantId,
      created.room.items[0].revision,
      60_000
    );
    current = await claim(
      partnerClient,
      args.p_room_id,
      token,
      current.room.items[0].id,
      joined.room.selfParticipantId,
      current.room.items[0].revision,
      60_000
    );
    const closed = await closeRoom(hostClient, args.p_room_id, current.room.revision);
    const result = await finalize(
      hostClient,
      args.p_room_id,
      closed.room.revision,
      expensePayload(closed)
    );

    expect(result.ack.groupId).toBe(dmId);
    const memberships = await withPg(async (db) => {
      const membershipRows = await db.query<{ user_id: string; status: string }>(
        "select user_id, status from public.group_members where group_id = $1 order by user_id",
        [dmId]
      );
      return membershipRows.rows;
    });
    expect(memberships).toHaveLength(2);
    expect(memberships).toEqual(
      expect.arrayContaining([
        { user_id: host.id, status: "accepted" },
        { user_id: partner.id, status: "invited" },
      ])
    );
  });

  it("names hosted DM rooms after the partner and group rooms after the group", async () => {
    const [host, partner, other] = await createTestUsers(3);
    const hostClient = authenticateAs(host);
    const dmId = await createDm(hostClient, partner.id);
    const dmRoom = await createRoom(hostClient, dmRoomArgs(host, dmId));
    const groupId = await createGroupWithMembers(host, [other], "Sala normal");
    const groupRoom = await createRoom(
      hostClient,
      roomArgs(host, { p_group_target: { kind: "existing", groupId } })
    );

    const rooms = await rpcDecoded(
      hostClient,
      "list_hosted_assignment_rooms",
      {} as never,
      decodeHostedAssignmentRooms
    );
    expect(rooms.find((room) => room.id === dmRoom.room.id)).toMatchObject({
      groupId: dmId,
      groupName: partner.name,
    });
    expect(rooms.find((room) => room.id === groupRoom.room.id)).toMatchObject({
      groupId,
      groupName: "Sala normal",
    });
  });
});
