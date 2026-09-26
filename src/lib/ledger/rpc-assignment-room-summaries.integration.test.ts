import { beforeAll, describe, expect, it } from "vitest";
import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { buildAssignmentExpense } from "@/lib/assignment-room-money";
import type { AssignmentRoomView } from "@/types/assignment-room";
import {
  decodeAssignmentRoomView,
  decodeFinalizeAssignmentRoomResult,
} from "@/lib/ledger/decode-assignment-room";
import type { Database, Json } from "@/types/database";
import {
  authenticateAs,
  createGroupWithMembers,
  createTestUsers,
  expectRpcError,
  rpcDecoded,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";
import { isIntegrationTestReady } from "@/test/integration-setup";
import { assertLedgerInvariantsAfterEach } from "@/test/ledger-invariants";

assertLedgerInvariantsAfterEach();

type Client = SupabaseClient<Database>;
type CreateArgs =
  Database["public"]["Functions"]["create_assignment_room"]["Args"];
type RoomView = AssignmentRoomView;

interface Claimer {
  participantId: string;
  userId: string | null;
  name: string;
  avatarUrl: string | null;
}

interface RoomSummary {
  id: string;
  groupId: string;
  status: string;
  revision: number;
  title: string;
  occurredOn: string;
  totalCents: number;
  host: { id: string; name: string };
  createdAt: string;
  itemCount: number;
  ownedItemCount: number;
  claimers: Claimer[];
  expenseId: string | null;
}

interface OpenRoom extends RoomSummary {
  joined: boolean;
}

interface RoomsResponse {
  rooms: OpenRoom[];
}

interface ConversationEvent {
  id: number;
  kind: string;
  payload: Record<string, unknown>;
  assignmentRoom?: RoomSummary | null;
  assignmentRoomAccess?: string;
}

interface ConversationResponse {
  messages: unknown[];
  events: ConversationEvent[];
}

const SUMMARY_KEYS = [
  "claimers",
  "createdAt",
  "expenseId",
  "groupId",
  "host",
  "id",
  "itemCount",
  "occurredOn",
  "ownedItemCount",
  "revision",
  "status",
  "title",
  "totalCents",
];

const HEADER = {
  title: "Conta com progresso",
  occurredOn: "2026-09-26",
  serviceFeeBasisPoints: 1_000,
  fixedFeeCents: 100,
};
const ITEMS = [
  {
    description: "Pizza",
    quantityMilliunits: 1_000,
    unitPriceCents: 4_000,
    totalPriceCents: 4_000,
  },
  {
    description: "Refrigerante",
    quantityMilliunits: 1_000,
    unitPriceCents: 2_000,
    totalPriceCents: 2_000,
  },
];
const ROOM_TOTAL_CENTS = 6_700;

function existingTarget(groupId: string): Json {
  return { kind: "existing", groupId };
}

function joinToken(fill: string): string {
  return `armj1_${fill.repeat(43)}`;
}

function memberToken(): string {
  const random = crypto.randomUUID().replaceAll("-", "") + "AAAAAAAAAAA";
  return `armm1_${random}`;
}

function roomArgs(host: TestUser, groupTarget: Json): CreateArgs {
  return {
    p_room_id: crypto.randomUUID(),
    p_group_target: groupTarget,
    p_header: HEADER,
    p_items: ITEMS,
    p_participants: [
      { id: crypto.randomUUID(), displayName: host.name, userId: host.id },
    ],
    p_join_token: joinToken("A"),
  };
}

async function rpc<T>(
  client: Client,
  name: keyof Database["public"]["Functions"],
  args: Record<string, unknown>
): Promise<T> {
  const { data, error } = await client.rpc(name, args as never);
  if (error) throw new Error(error.message);
  return data as T;
}

async function rpcRoom(
  client: Client,
  name: keyof Database["public"]["Functions"],
  args: Record<string, unknown>
): Promise<RoomView> {
  return rpcDecoded(client, name, args as never, decodeAssignmentRoomView);
}

async function createRoom(
  client: Client,
  args: CreateArgs
): Promise<RoomView> {
  return rpcRoom(client, "create_assignment_room", args);
}

async function claimItem(
  client: Client,
  roomId: string,
  itemId: string,
  itemRevision: number,
  participantId: string,
  ticks: number,
  token: string | null = null
): Promise<RoomView> {
  return rpcRoom(client, "set_assignment_room_claim", {
    p_room_id: roomId,
    p_member_token: token,
    p_item_id: itemId,
    p_participant_id: participantId,
    p_expected_item_revision: itemRevision,
    p_ticks: ticks,
  });
}

async function claimEveryItemAsHost(
  hostClient: Client,
  created: RoomView
): Promise<RoomView> {
  let view = created;
  for (const item of created.room.items) {
    view = await claimItem(
      hostClient,
      created.room.id,
      item.id,
      item.revision,
      created.room.selfParticipantId,
      120_000
    );
  }
  return view;
}

function joinOutcome(
  channel: RealtimeChannel,
  timeoutMs = 6_000
): Promise<"subscribed" | "denied"> {
  // Policy denial is transport-level with no deterministic hook, so only a
  // wall-clock deadline can resolve it; fake timers cannot drive the socket.
  const { promise, resolve } = Promise.withResolvers<"subscribed" | "denied">();
  const timer = setTimeout(() => resolve("denied"), timeoutMs);
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      clearTimeout(timer);
      resolve("subscribed");
    } else if (
      status === "CHANNEL_ERROR" ||
      status === "TIMED_OUT" ||
      status === "CLOSED"
    ) {
      clearTimeout(timer);
      resolve("denied");
    }
  });
  return promise;
}

async function joinSubscribed(
  makeChannel: () => RealtimeChannel
): Promise<RealtimeChannel> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const channel = makeChannel();
    if ((await joinOutcome(channel, 4_000)) === "subscribed") return channel;
    await channel.unsubscribe();
  }
  throw new Error("group channel did not subscribe");
}

function nextGroupRoomBroadcast(
  channel: RealtimeChannel,
  timeoutMs = 8_000
): Promise<{ payload: Record<string, unknown>; receivedAt: number }> {
  const { promise, resolve, reject } = Promise.withResolvers<{
    payload: Record<string, unknown>;
    receivedAt: number;
  }>();
  // A real Realtime socket has no deterministic delivery hook, so only a
  // wall-clock deadline separates a missing broadcast from a pending test.
  const timer = setTimeout(
    () => reject(new Error("missing assignment_room broadcast")),
    timeoutMs
  );
  channel.on("broadcast", { event: "assignment_room" }, ({ payload }) => {
    clearTimeout(timer);
    resolve({ payload, receivedAt: performance.now() });
  });
  return promise;
}

function expectNoGroupRoomBroadcast(
  channel: RealtimeChannel,
  timeoutMs = 1_200
): Promise<void> {
  // Absence of delivery is the contract and Realtime has no negative ack,
  // so this window cannot be driven by fake timers.
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const timer = setTimeout(resolve, timeoutMs);
  channel.on("broadcast", { event: "assignment_room" }, () => {
    clearTimeout(timer);
    reject(new Error("unexpected assignment_room broadcast"));
  });
  return promise;
}

describe.skipIf(!isIntegrationTestReady)(
  "assignment room summaries",
  () => {
    let host: TestUser;
    let member: TestUser;
    let outsider: TestUser;
    let hostClient: Client;
    let memberClient: Client;
    let outsiderClient: Client;
    let anonClient: Client;
    let groupId: string;

    beforeAll(async () => {
      [host, member, outsider] = await createTestUsers(3);
      hostClient = authenticateAs(host);
      memberClient = authenticateAs(member);
      outsiderClient = authenticateAs(outsider);
      anonClient = createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } }
      );
      groupId = await createGroupWithMembers(host, [member], "Grupo resumos");
    });

    it("lists entries with exactly the summary keys plus joined and tracks claims", async () => {
      await withPg((client) =>
        client.query(
          "update public.users set avatar_url = $2 where id = $1",
          [member.id, "https://cdn.dividimos.local/avatar.png"]
        )
      );

      const created = await createRoom(hostClient, roomArgs(host, existingTarget(groupId)));
      const guestToken = memberToken();
      const guest = await rpcRoom(anonClient, "join_assignment_room", {
        p_room_id: created.room.id,
        p_join_token: joinToken("A"),
        p_member_token: guestToken,
        p_display_name: "Convidada",
      });
      const memberRoomToken = memberToken();
      const entered = await rpcRoom(memberClient, "enter_group_assignment_room", {
        p_room_id: created.room.id,
        p_member_token: memberRoomToken,
      });

      const before = await rpc<RoomsResponse>(memberClient, "list_open_assignment_rooms", {
        p_group_id: groupId,
      });
      const entry = before.rooms.find((room) => room.id === created.room.id);
      expect(entry).toBeDefined();
      expect(Object.keys(entry!).sort()).toEqual([...SUMMARY_KEYS, "joined"].sort());
      expect(entry!.groupId).toBe(groupId);
      expect(entry!.status).toBe("open");
      expect(entry!.title).toBe(HEADER.title);
      expect(entry!.occurredOn).toBe(HEADER.occurredOn);
      expect(entry!.totalCents).toBe(ROOM_TOTAL_CENTS);
      expect(Number.isInteger(entry!.revision) && entry!.revision >= 1).toBe(true);
      expect(entry!.host.id).toBe(host.id);
      expect(entry!.host.name).toBe(host.name);
      expect(typeof entry!.createdAt).toBe("string");
      expect(entry!.itemCount).toBe(2);
      expect(entry!.ownedItemCount).toBe(0);
      expect(entry!.claimers).toEqual([]);
      expect(entry!.expenseId).toBeNull();
      expect(entry!.joined).toBe(true);

      await claimItem(
        memberClient,
        created.room.id,
        entered.room.items[1].id,
        entered.room.items[1].revision,
        entered.room.selfParticipantId,
        60_000,
        memberRoomToken
      );
      const guestClaimed = await claimItem(
        anonClient,
        created.room.id,
        guest.room.items[0].id,
        guest.room.items[0].revision,
        guest.room.selfParticipantId,
        120_000,
        guestToken
      );

      const after = await rpc<RoomsResponse>(hostClient, "list_open_assignment_rooms", {
        p_group_id: groupId,
      });
      const progress = after.rooms.find((room) => room.id === created.room.id);
      expect(progress).toBeDefined();
      expect(progress!.itemCount).toBe(2);
      expect(progress!.ownedItemCount).toBe(1);
      expect(progress!.claimers.map((claimer) => claimer.name)).toEqual([
        "Convidada",
        member.name,
      ]);
      expect(progress!.claimers[0]).toEqual({
        participantId: guest.room.selfParticipantId,
        userId: null,
        name: "Convidada",
        avatarUrl: null,
      });
      expect(progress!.claimers[1].userId).toBe(member.id);
      expect(progress!.claimers[1].avatarUrl).toBe("https://cdn.dividimos.local/avatar.png");

      await rpcRoom(hostClient, "remove_assignment_room_participant", {
        p_room_id: created.room.id,
        p_participant_id: entered.room.selfParticipantId,
        p_expected_revision: guestClaimed.room.revision,
        p_join_token: joinToken("B"),
      });

      const afterRemoval = await rpc<RoomsResponse>(hostClient, "list_open_assignment_rooms", {
        p_group_id: groupId,
      });
      const remaining = afterRemoval.rooms.find((room) => room.id === created.room.id);
      expect(remaining).toBeDefined();
      expect(remaining!.claimers.map((claimer) => claimer.userId)).toEqual([null]);
      expect(remaining!.ownedItemCount).toBe(1);
    });

    it("broadcasts the live summary on the group topic for existing rooms only", async () => {
      const realtimeMember = createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { accessToken: async () => member.accessToken! }
      );
      await realtimeMember.realtime.setAuth(member.accessToken!);
      const channel = await joinSubscribed(() =>
        realtimeMember.channel(`group:${groupId}`, { config: { private: true } })
      );

      const created = await createRoom(hostClient, roomArgs(host, existingTarget(groupId)));
      const claimedRevisions: number[] = [];
      let item = created.room.items[0];
      let ticks = 120_000;
      let received: { payload: Record<string, unknown>; receivedAt: number } | null = null;
      for (let attempt = 1; ; attempt += 1) {
        const message = nextGroupRoomBroadcast(channel, 4_000);
        const updated = await claimItem(
          hostClient,
          created.room.id,
          item.id,
          item.revision,
          created.room.selfParticipantId,
          ticks
        );
        claimedRevisions.push(updated.room.revision);
        received = await message.catch(() => null);
        if (received) {
          item = updated.room.items.find((candidate) => candidate.id === item.id)!;
          break;
        }
        if (attempt === 3) throw new Error("missing assignment_room broadcast");
        ticks = ticks === 120_000 ? 60_000 : 120_000;
      }

      expect(Object.keys(received!.payload).sort()).toEqual(["id", "room"]);
      const room = received!.payload.room as RoomSummary;
      expect(Object.keys(room).sort()).toEqual(SUMMARY_KEYS);
      expect(room.id).toBe(created.room.id);
      expect(room.groupId).toBe(groupId);
      expect(claimedRevisions).toContain(room.revision);
      const serialized = JSON.stringify(received!.payload);
      expect(serialized).not.toMatch(/arm[jm]1_/);
      expect(serialized).not.toContain("assignment:");

      const newTarget = await createRoom(
        hostClient,
        roomArgs(host, { kind: "new", name: "Sala nova" })
      );
      await Promise.all([
        expectNoGroupRoomBroadcast(channel),
        claimItem(
          hostClient,
          newTarget.room.id,
          newTarget.room.items[0].id,
          newTarget.room.items[0].revision,
          newTarget.room.selfParticipantId,
          120_000
        ),
      ]);

      await channel.unsubscribe();
    }, 120_000);

    it("serves the opened event with its live summary through get_conversation_v2", async () => {
      const created = await createRoom(hostClient, roomArgs(host, existingTarget(groupId)));
      await rpc<{ eventId: number }>(hostClient, "announce_assignment_room", {
        p_room_id: created.room.id,
      });

      const v1 = await rpc<ConversationResponse>(memberClient, "get_conversation", {
        p_group_id: groupId,
      });
      const v2 = await rpc<ConversationResponse>(memberClient, "get_conversation_v2", {
        p_group_id: groupId,
      });

      const opened = v2.events.filter(
        (event) => event.kind === "assignment_room_opened"
      );
      expect(opened).toHaveLength(1);
      expect(opened[0].payload.roomId).toBe(created.room.id);
      expect(Object.keys(opened[0]).sort()).toEqual([
        "actor",
        "actorId",
        "assignmentRoom",
        "assignmentRoomAccess",
        "createdAt",
        "expenseId",
        "expenseTitle",
        "groupId",
        "id",
        "kind",
        "payload",
        "settlementId",
        "subjectUserId",
      ]);
      expect(Object.keys(opened[0].assignmentRoom!).sort()).toEqual(SUMMARY_KEYS);
      expect(opened[0].assignmentRoom!.id).toBe(created.room.id);
      expect(opened[0].assignmentRoom!.groupId).toBe(groupId);
      expect(opened[0].assignmentRoom!.status).toBe("open");
      expect(opened[0].assignmentRoom!.totalCents).toBe(ROOM_TOTAL_CENTS);
      expect(opened[0].assignmentRoom!.itemCount).toBe(2);
      expect(opened[0].assignmentRoom!.ownedItemCount).toBe(0);
      expect(opened[0].assignmentRoom!.claimers).toEqual([]);
      expect(opened[0].assignmentRoom!.expenseId).toBeNull();
      expect(opened[0].assignmentRoomAccess).toBe("none");

      expect(v1.events.some((event) => event.kind === "assignment_room_opened")).toBe(false);
      expect(
        v2.events.filter((event) => event.kind !== "assignment_room_opened")
      ).toEqual(v1.events);
      expect(v2.messages).toEqual(v1.messages);

      const claimed = await claimEveryItemAsHost(hostClient, created);
      const closed = await rpcRoom(hostClient, "close_assignment_room", {
        p_room_id: created.room.id,
        p_expected_revision: claimed.room.revision,
      });
      if (closed.role !== "host") {
        throw new Error("expected a host view to build the expense payload");
      }
      const built = buildAssignmentExpense(closed, [
        { participantIndex: 0, amountCents: closed.room.totalCents },
      ]);
      if (!built.ok) throw new Error(JSON.stringify(built.issue));
      const finalized = await rpcDecoded(
        hostClient,
        "finalize_assignment_room",
        {
          p_room_id: created.room.id,
          p_expected_revision: closed.room.revision,
          p_payload: built.value,
        },
        decodeFinalizeAssignmentRoomResult
      );

      const finalizedRead = await rpc<ConversationResponse>(
        memberClient,
        "get_conversation_v2",
        { p_group_id: groupId }
      );
      const finalizedOpened = finalizedRead.events.find(
        (event) =>
          event.kind === "assignment_room_opened" &&
          event.payload.roomId === created.room.id
      );
      expect(finalizedOpened).toBeDefined();
      expect(finalizedOpened!.assignmentRoom!.status).toBe("finalized");
      expect(finalizedOpened!.assignmentRoom!.expenseId).toBe(finalized.ack.expenseId);

      await expect(
        expectRpcError(
          outsiderClient.rpc("get_conversation_v2", { p_group_id: groupId })
        )
      ).resolves.toContain("not_a_member");
      await expect(
        expectRpcError(
          anonClient.rpc("get_conversation_v2", { p_group_id: groupId })
        )
      ).resolves.toMatch(/permission denied/);
    });

    it("tells each reader whether they joined the room or were removed from it", async () => {
      const created = await createRoom(hostClient, roomArgs(host, existingTarget(groupId)));
      await rpc<{ eventId: number }>(hostClient, "announce_assignment_room", {
        p_room_id: created.room.id,
      });
      const accessFor = async (client: Client): Promise<string | undefined> => {
        const read = await rpc<ConversationResponse>(client, "get_conversation_v2", {
          p_group_id: groupId,
        });
        return read.events.find(
          (event) =>
            event.kind === "assignment_room_opened" && event.payload.roomId === created.room.id
        )?.assignmentRoomAccess;
      };

      expect(await accessFor(hostClient)).toBe("joined");
      expect(await accessFor(memberClient)).toBe("none");

      const entered = await rpcRoom(memberClient, "enter_group_assignment_room", {
        p_room_id: created.room.id,
        p_member_token: memberToken(),
      });
      expect(await accessFor(memberClient)).toBe("joined");

      await rpcRoom(hostClient, "remove_assignment_room_participant", {
        p_room_id: created.room.id,
        p_participant_id: entered.room.selfParticipantId,
        p_expected_revision: entered.room.revision,
        p_join_token: joinToken("B"),
      });
      expect(await accessFor(memberClient)).toBe("removed");
    });

    it("keeps the summary serializer out of client reach", async () => {
      const created = await createRoom(hostClient, roomArgs(host, existingTarget(groupId)));
      await expect(
        expectRpcError(
          memberClient.rpc("assignment_room_summary_json", {
            p_room_id: created.room.id,
          })
        )
      ).resolves.toMatch(/permission denied/);
    });
  }
);
