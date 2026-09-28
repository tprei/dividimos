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
import { decodeMutationAck } from "@/lib/ledger/decode";
import type { Database } from "@/types/database";
import {
  authenticateAs,
  createGroupWithMembers,
  createTestUsers,
  rpcDecoded,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";
import { isIntegrationTestReady } from "@/test/integration-setup";
import { assertLedgerInvariantsAfterEach } from "@/test/ledger-invariants";

assertLedgerInvariantsAfterEach();

type Client = SupabaseClient<Database>;
type RoomView = AssignmentRoomView;

const HEADER = {
  title: "Conta em tempo real",
  occurredOn: "2026-09-19",
  serviceFeeBasisPoints: 0,
  fixedFeeCents: 0,
};
const ITEMS = [
  {
    description: "Pizza",
    quantityMilliunits: 1_000,
    unitPriceCents: 4_000,
    totalPriceCents: 4_000,
  },
];

function capability(prefix: "armj1" | "armm1", fill: string): string {
  return `${prefix}_${fill.repeat(43)}`;
}

async function rpcRoom(
  client: Client,
  name: keyof Database["public"]["Functions"],
  args: Record<string, unknown>,
): Promise<RoomView> {
  return rpcDecoded(client, name, args, decodeAssignmentRoomView);
}

function roomTopic(view: RoomView): string {
  if (view.room.topic === null) {
    throw new Error("expected the room view to carry a realtime topic");
  }
  return view.room.topic;
}

function joinOutcome(
  channel: RealtimeChannel,
  timeoutMs = 6_000
): Promise<"subscribed" | "denied"> {
  const { promise, resolve } = Promise.withResolvers<"subscribed" | "denied">();
  // Realtime policy denial is transport-level and has no deterministic clock hook.
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
  throw new Error("private room channel did not subscribe");
}

function nextBroadcast(
  channel: RealtimeChannel,
  event: "assignment" | "access_changed" | "assignment_room",
  timeoutMs = 8_000
): Promise<{ payload: Record<string, unknown>; receivedAt: number }> {
  const { promise, resolve, reject } = Promise.withResolvers<{
    payload: Record<string, unknown>;
    receivedAt: number;
  }>();
  // This exercises a real Realtime socket, so only a wall-clock deadline can
  // distinguish a missing platform delivery from an indefinitely pending test.
  const timer = setTimeout(
    () => reject(new Error(`missing ${event} broadcast`)),
    timeoutMs
  );
  channel.on("broadcast", { event }, ({ payload }) => {
    clearTimeout(timer);
    resolve({ payload, receivedAt: performance.now() });
  });
  return promise;
}

function nextRevisionBroadcast(
  channel: RealtimeChannel,
  revision: number,
  timeoutMs = 8_000
): Promise<{ payload: Record<string, unknown>; receivedAt: number }> {
  const { promise, resolve, reject } = Promise.withResolvers<{
    payload: Record<string, unknown>;
    receivedAt: number;
  }>();
  const timer = setTimeout(
    () => reject(new Error(`missing assignment revision ${revision}`)),
    timeoutMs
  );
  channel.on("broadcast", { event: "assignment" }, ({ payload }) => {
    if (payload.revision !== revision) return;
    clearTimeout(timer);
    resolve({ payload, receivedAt: performance.now() });
  });
  return promise;
}

function expectNoBroadcast(
  channel: RealtimeChannel,
  event: "assignment" | "access_changed" | "assignment_room",
  timeoutMs = 1_000
): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  // Absence of delivery is the contract, and Realtime exposes no negative ack.
  const timer = setTimeout(resolve, timeoutMs);
  channel.on("broadcast", { event }, () => {
    clearTimeout(timer);
    reject(new Error(`unexpected ${event} broadcast`));
  });
  return promise;
}

function expectRevisionPayload(
  payload: Record<string, unknown>,
  revision: number
): void {
  expect(payload.revision).toBe(revision);
  // The local Realtime server injects a transport id. The application payload
  // has no room, participant, credential, or financial fields.
  expect(Object.keys(payload).sort()).toEqual(["id", "revision"]);
}

function channelObserver(channel: RealtimeChannel, event: string) {
  const seen: Array<Record<string, unknown>> = [];
  const waiters: Array<(payload: Record<string, unknown>) => void> = [];
  channel.on("broadcast", { event }, ({ payload }) => {
    seen.push(payload);
    for (const wake of waiters.splice(0)) wake(payload);
  });
  return {
    next(timeoutMs = 8_000): Promise<Record<string, unknown>> {
      const { promise, resolve, reject } = Promise.withResolvers<Record<string, unknown>>();
      if (seen.length > 0) {
        resolve(seen[0]!);
        return promise;
      }
      const timer = setTimeout(() => reject(new Error(`missing ${event} broadcast`)), timeoutMs);
      waiters.push((payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
      return promise;
    },
    expectNone(): Promise<void> {
      if (seen.length > 0) {
        return Promise.reject(new Error(`unexpected ${event} broadcast`));
      }
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const timer = setTimeout(resolve, 1_500);
      waiters.push(() => {
        clearTimeout(timer);
        reject(new Error(`unexpected ${event} broadcast`));
      });
      return promise;
    },
  };
}

describe.skipIf(!isIntegrationTestReady)(
  "assignment room private realtime",
  () => {
    let host: TestUser;
    let hostClient: Client;
    let anonClient: Client;

    beforeAll(async () => {
      [host] = await createTestUsers(1);
      hostClient = authenticateAs(host);
      anonClient = createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } }
      );
      const postgresVersion = await withPg(
        async (db) =>
          (
            await db.query<{ version: string }>("select version()")
          ).rows[0].version
      );
      console.info("room realtime platform", { postgresVersion });
    });

    async function roomWithGuest(fill: string) {
      const roomId = crypto.randomUUID();
      const joinToken = capability("armj1", fill);
      const created = await rpcRoom(hostClient, "create_assignment_room", {
          p_room_id: roomId,
          p_group_target: { kind: "new", name: "Conta compartilhada" },
          p_header: HEADER,
          p_items: ITEMS,
          p_participants: [
            {
              id: crypto.randomUUID(),
              displayName: host.name,
              userId: host.id,
            },
          ],
          p_join_token: joinToken,
        }
      );
      const memberToken = capability("armm1", fill.toLowerCase());
      const guest = await rpcRoom(anonClient, "join_assignment_room", {
        p_room_id: roomId,
        p_join_token: joinToken,
        p_member_token: memberToken,
        p_display_name: "Convidada",
      });
      return { roomId, joinToken, memberToken, created, guest, topic: roomTopic(guest) };
    }

    it("delivers revision-only invalidations to an anonymous capability holder", async () => {
      const setup = await roomWithGuest("R");
      expect(setup.topic).toMatch(
        new RegExp(`^assignment:${setup.roomId}:[A-Za-z0-9_-]{43}$`)
      );
      const channel = await joinSubscribed(() =>
        anonClient.channel(setup.topic, {
          config: { private: true },
        })
      );
      let item = setup.created.room.items[0];
      let ticks = 120_000;
      const claimedRevisions: number[] = [];
      // A freshly authorized Realtime socket can drop its first message, so the
      // claim repeats until one invalidation lands; every claim bumps the room
      // revision, and the payload must match one of them.
      for (let attempt = 1; ; attempt += 1) {
        const message = nextBroadcast(channel, "assignment", 4_000);
        const startedAt = performance.now();
        const updated = await rpcRoom(hostClient, "set_assignment_room_claim", {
            p_room_id: setup.roomId,
            p_member_token: null,
            p_item_id: item.id,
            p_participant_id: setup.created.room.selfParticipantId,
            p_expected_item_revision: item.revision,
            p_ticks: ticks,
          }
        );
        claimedRevisions.push(updated.room.revision);
        const received = await message.catch(() => null);
        if (received) {
          expect(Object.keys(received.payload).sort()).toEqual([
            "id",
            "revision",
          ]);
          expect(claimedRevisions).toContain(received.payload.revision);
          console.info(
            "room realtime invalidation latency ms",
            received.receivedAt - startedAt,
            { attempt }
          );
          break;
        }
        if (attempt === 3) throw new Error("missing assignment broadcast");
        item = updated.room.items.find(
          (candidate) => candidate.id === item.id
        )!;
        ticks = ticks === 120_000 ? 60_000 : 120_000;
      }
      await channel.unsubscribe();
    }, 180_000);

    it("denies guessed topics, client sends, malformed predicates, and public delivery", async () => {
      const setup = await roomWithGuest("S");
      const wrongTopic = `${setup.topic.slice(0, -1)}X`;
      const unauthorized = anonClient.channel(wrongTopic, {
        config: { private: true },
      });
      await expect(joinOutcome(unauthorized)).resolves.toBe("denied");
      await unauthorized.unsubscribe();

      const allowed = await joinSubscribed(() =>
        anonClient.channel(setup.topic, {
          config: { private: true, broadcast: { ack: true } },
        })
      );
      await expect(
        allowed.send({
          type: "broadcast",
          event: "client_send",
          payload: { revision: 999 },
        })
      ).resolves.not.toBe("ok");

      const publicChannel = anonClient.channel(setup.topic);
      const publicAbsence = expectNoBroadcast(publicChannel, "assignment");
      await joinOutcome(publicChannel, 2_000);
      await rpcRoom(hostClient, "set_assignment_room_claim", {
        p_room_id: setup.roomId,
        p_member_token: null,
        p_item_id: setup.created.room.items[0].id,
        p_participant_id: setup.created.room.selfParticipantId,
        p_expected_item_revision: setup.created.room.items[0].revision,
        p_ticks: 120_000,
      });
      await publicAbsence;

      const { data, error } = await anonClient.rpc(
        "assignment_room_topic_allowed",
        {
          p_topic: "assignment:not-a-uuid:secret",
        }
      );
      expect(error).toBeNull();
      expect(data).toBe(false);
      await Promise.all([allowed.unsubscribe(), publicChannel.unsubscribe()]);
    }, 180_000);

    it("rotates topics on removal and recovers a missed invalidation from a snapshot", async () => {
      const setup = await roomWithGuest("T");
      const oldChannel = await joinSubscribed(() =>
        anonClient.channel(setup.topic, {
          config: { private: true },
        })
      );
      const accessChanged = nextBroadcast(oldChannel, "access_changed");
      const removed = await rpcRoom(
        hostClient,
        "remove_assignment_room_participant",
        {
          p_room_id: setup.roomId,
          p_participant_id: setup.guest.room.selfParticipantId,
          p_expected_revision: setup.guest.room.revision,
          p_join_token: capability("armj1", "U"),
        }
      );
      const rotationMessage = await accessChanged;
      expectRevisionPayload(rotationMessage.payload, removed.room.revision);
      expect(removed.room.topic).not.toBe(setup.topic);

      const oldTopicAbsence = expectNoBroadcast(oldChannel, "assignment");
      await rpcRoom(hostClient, "set_assignment_room_claim", {
        p_room_id: setup.roomId,
        p_member_token: null,
        p_item_id: setup.created.room.items[0].id,
        p_participant_id: setup.created.room.selfParticipantId,
        p_expected_item_revision: setup.created.room.items[0].revision,
        p_ticks: 120_000,
      });
      await oldTopicAbsence;

      const recovered = await rpcRoom(hostClient, "get_assignment_room", {
        p_room_id: setup.roomId,
        p_member_token: null,
      });
      expect(recovered.room.revision).toBeGreaterThan(removed.room.revision);
      await oldChannel.unsubscribe();
    }, 180_000);

    it("invalidates a finalized room for its bill edit but not an unrelated group event", async () => {
      const setup = await roomWithGuest("V");
      const claimed = await rpcRoom(hostClient, "set_assignment_room_claim", {
          p_room_id: setup.roomId,
          p_member_token: null,
          p_item_id: setup.created.room.items[0].id,
          p_participant_id: setup.created.room.selfParticipantId,
          p_expected_item_revision: setup.created.room.items[0].revision,
          p_ticks: 120_000,
        }
      );
      const closed = await rpcRoom(hostClient, "close_assignment_room", {
        p_room_id: setup.roomId,
        p_expected_revision: claimed.room.revision,
      });
      if (closed.role !== "host") {
        throw new Error("expected a host view to build the expense payload");
      }
      const built = buildAssignmentExpense(closed, [
        { participantIndex: 0, amountCents: 4_000 },
      ]);
      if (!built.ok) throw new Error(JSON.stringify(built.issue));
      const channel = await joinSubscribed(() =>
        anonClient.channel(roomTopic(closed), {
          config: { private: true },
        })
      );
      // Consume finalization first so the freshly subscribed socket has
      // delivered a room invalidation before the bill edit under test.
      const finalizationMessage = nextRevisionBroadcast(
        channel,
        closed.room.revision + 1
      );
      const finalized = await rpcDecoded(
        hostClient,
        "finalize_assignment_room",
        {
          p_room_id: setup.roomId,
          p_expected_revision: closed.room.revision,
          p_payload: built.value,
        },
        decodeFinalizeAssignmentRoomResult
      );
      expectRevisionPayload(
        (await finalizationMessage).payload,
        closed.room.revision + 1
      );
      const expenseId = finalized.ack.expenseId;
      if (!expenseId) throw new Error("finalize_assignment_room ack has no expenseId");

      const editMessage = nextRevisionBroadcast(
        channel,
        finalized.room.room.revision + 1
      );
      await rpcDecoded(hostClient, "edit_expense", {
        p_expense_id: expenseId,
        p_expected_version_no: 1,
        p_occurred_on: HEADER.occurredOn,
        p_title: "Conta corrigida",
        p_merchant_name: "",
        p_expense_type: "itemized",
        p_total_cents: 4_000,
        p_service_fee_bps: 0,
        p_fixed_fee_cents: 0,
        p_payload: built.value,
      }, decodeMutationAck);
      const editedMessage = await editMessage;
      expectRevisionPayload(
        editedMessage.payload,
        finalized.room.room.revision + 1
      );
      // The expense trigger is the sole invalidation owner for bill edits,
      // so the room revision advanced exactly once even though
      // broadcast_group also carried the expense_edited group event.
      const editedRoom = await rpcRoom(hostClient, "get_assignment_room", {
        p_room_id: setup.roomId,
        p_member_token: null,
      });
      expect(editedRoom.room.revision).toBe(finalized.room.room.revision + 1);

      // Composing the absence window with the group-event transaction in a
      // single await surfaces an unexpected delivery here instead of leaving
      // a floating rejection while the transaction is still pending.
      await Promise.all([
        expectNoBroadcast(channel, "assignment"),
        withPg(async (db) => {
          await db.query("begin");
          try {
            const event = await db.query<{ id: string }>(
              "insert into public.group_events (group_id, actor_id, kind, payload) values ($1, $2, 'member_joined', '{}'::jsonb) returning id::text",
              [finalized.ack.groupId, host.id]
            );
            await db.query("select public.broadcast_group($1, $2, $3)", [
              finalized.ack.groupId,
              1,
              event.rows[0].id,
            ]);
            await db.query("commit");
          } catch (error) {
            await db.query("rollback");
            throw error;
          }
        }),
      ]);

      await channel.unsubscribe();
    }, 180_000);

    function groupRoomArgs(hostUser: TestUser, groupId: string, roomId: string, fill: string) {
      return {
        p_room_id: roomId,
        p_group_target: { kind: "existing", groupId },
        p_header: HEADER,
        p_items: ITEMS,
        p_participants: [
          { id: crypto.randomUUID(), displayName: hostUser.name, userId: hostUser.id },
        ],
        p_join_token: capability("armj1", fill),
      };
    }

    function expectRoomSummaryPayload(
      payload: Record<string, unknown>,
      roomId: string,
      groupId: string
    ): void {
      expect(Object.keys(payload).filter((key) => key !== "id")).toEqual(["room"]);
      expect(payload.room).toMatchObject({
        id: roomId,
        groupId,
        title: HEADER.title,
        status: "open",
        totalCents: 4_000,
      });
    }

    async function claimHostItem(
      roomId: string,
      participantId: string,
      item: { id: string; revision: number }
    ): Promise<void> {
      await rpcRoom(hostClient, "set_assignment_room_claim", {
        p_room_id: roomId,
        p_member_token: null,
        p_item_id: item.id,
        p_participant_id: participantId,
        p_expected_item_revision: item.revision,
        p_ticks: 120_000,
      });
    }

    it("fans the room summary out to accepted members' user topics and never onto the group topic", async () => {
      const [member] = await createTestUsers(1);
      const memberClient = authenticateAs(member);
      await memberClient.realtime.setAuth(member.accessToken!);
      const groupId = await createGroupWithMembers(host, [member], "Grupo sala em tempo real");
      const roomId = crypto.randomUUID();
      const created = await rpcRoom(
        hostClient,
        "create_assignment_room",
        groupRoomArgs(host, groupId, roomId, "W")
      );

      const memberUserChannel = await joinSubscribed(() =>
        memberClient.channel(`user:${member.id}`, { config: { private: true } })
      );
      const groupChannel = await joinSubscribed(() =>
        memberClient.channel(`group:${groupId}`, { config: { private: true } })
      );
      const memberSummaries = channelObserver(memberUserChannel, "assignment_room");
      const groupSummaries = channelObserver(groupChannel, "assignment_room");

      const channels = [memberUserChannel, groupChannel];
      try {
        await claimHostItem(roomId, created.room.selfParticipantId, created.room.items[0]);
        expectRoomSummaryPayload(await memberSummaries.next(), roomId, groupId);
        await groupSummaries.expectNone();
      } finally {
        await Promise.all(channels.map((channel) => channel.unsubscribe()));
      }
    }, 180_000);

    it("stops the room summary fanout for a member removed from the group", async () => {
      const [member, former] = await createTestUsers(2);
      const memberClient = authenticateAs(member);
      const formerClient = authenticateAs(former);
      await Promise.all([
        memberClient.realtime.setAuth(member.accessToken!),
        formerClient.realtime.setAuth(former.accessToken!),
      ]);
      const groupId = await createGroupWithMembers(host, [member, former], "Grupo sala removida");
      const formerUserChannel = await joinSubscribed(() =>
        formerClient.channel(`user:${former.id}`, { config: { private: true } })
      );
      const { error } = await hostClient.rpc("remove_member", {
        p_group_id: groupId,
        p_user_id: former.id,
      });
      if (error) throw new Error(`remove_member failed: ${error.message}`);

      const roomId = crypto.randomUUID();
      const created = await rpcRoom(
        hostClient,
        "create_assignment_room",
        groupRoomArgs(host, groupId, roomId, "X")
      );

      const memberUserChannel = await joinSubscribed(() =>
        memberClient.channel(`user:${member.id}`, { config: { private: true } })
      );
      const memberSummaries = channelObserver(memberUserChannel, "assignment_room");
      const formerSummaries = channelObserver(formerUserChannel, "assignment_room");

      const channels = [memberUserChannel, formerUserChannel];
      try {
        await claimHostItem(roomId, created.room.selfParticipantId, created.room.items[0]);
        expectRoomSummaryPayload(await memberSummaries.next(), roomId, groupId);
        await formerSummaries.expectNone();
      } finally {
        await Promise.all(channels.map((channel) => channel.unsubscribe()));
      }
    }, 180_000);
  }
);
