import { beforeAll, describe, expect, it } from "vitest";
import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { buildAssignmentExpense } from "@/lib/assignment-room-money";
import type { AssignmentRoomView } from "@/types/assignment-room";
import type { Database, Json } from "@/types/database";
import {
  authenticateAs,
  createTestUsers,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";
import { isIntegrationTestReady } from "@/test/integration-setup";
import { assertLedgerInvariantsAfterEach } from "@/test/ledger-invariants";

assertLedgerInvariantsAfterEach();

type Client = SupabaseClient<Database>;
interface RoomView {
  role: "host" | "participant";
  room: {
    id: string;
    revision: number;
    status: string;
    selfParticipantId: string;
    topic: string;
    items: Array<{ id: string; revision: number }>;
    participants: Array<{
      id: string;
      ordinal: number;
      displayName: string;
      removed: boolean;
    }>;
    currentBill: Json | null;
  };
  groupTarget?: Json;
  participantRefs?: Json[];
}
interface FinalizeResult {
  room: RoomView;
  ack: { expenseId: string; groupId: string; versionNo: number };
}

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

async function rpc<T>(
  client: Client,
  name: keyof Database["public"]["Functions"],
  args: Record<string, unknown>
): Promise<T> {
  const { data, error } = await client.rpc(name, args as never);
  if (error) throw new Error(error.message);
  return data as T;
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
  event: "assignment" | "access_changed",
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
  event: "assignment" | "access_changed",
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
      const created = await rpc<RoomView>(
        hostClient,
        "create_assignment_room",
        {
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
      const guest = await rpc<RoomView>(anonClient, "join_assignment_room", {
        p_room_id: roomId,
        p_join_token: joinToken,
        p_member_token: memberToken,
        p_display_name: "Convidada",
      });
      return { roomId, joinToken, memberToken, created, guest };
    }

    it("delivers revision-only invalidations to an anonymous capability holder", async () => {
      const setup = await roomWithGuest("R");
      expect(setup.guest.room.topic).toMatch(
        new RegExp(`^assignment:${setup.roomId}:[A-Za-z0-9_-]{43}$`)
      );
      const channel = await joinSubscribed(() =>
        anonClient.channel(setup.guest.room.topic, {
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
        const updated = await rpc<RoomView>(
          hostClient,
          "set_assignment_room_claim",
          {
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
      const wrongTopic = `${setup.guest.room.topic.slice(0, -1)}X`;
      const unauthorized = anonClient.channel(wrongTopic, {
        config: { private: true },
      });
      await expect(joinOutcome(unauthorized)).resolves.toBe("denied");
      await unauthorized.unsubscribe();

      const allowed = await joinSubscribed(() =>
        anonClient.channel(setup.guest.room.topic, {
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

      const publicChannel = anonClient.channel(setup.guest.room.topic);
      const publicAbsence = expectNoBroadcast(publicChannel, "assignment");
      await joinOutcome(publicChannel, 2_000);
      await rpc<RoomView>(hostClient, "set_assignment_room_claim", {
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
        anonClient.channel(setup.guest.room.topic, {
          config: { private: true },
        })
      );
      const accessChanged = nextBroadcast(oldChannel, "access_changed");
      const removed = await rpc<RoomView>(
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
      expect(removed.room.topic).not.toBe(setup.guest.room.topic);

      const oldTopicAbsence = expectNoBroadcast(oldChannel, "assignment");
      await rpc<RoomView>(hostClient, "set_assignment_room_claim", {
        p_room_id: setup.roomId,
        p_member_token: null,
        p_item_id: setup.created.room.items[0].id,
        p_participant_id: setup.created.room.selfParticipantId,
        p_expected_item_revision: setup.created.room.items[0].revision,
        p_ticks: 120_000,
      });
      await oldTopicAbsence;

      const recovered = await rpc<RoomView>(hostClient, "get_assignment_room", {
        p_room_id: setup.roomId,
        p_member_token: null,
      });
      expect(recovered.room.revision).toBeGreaterThan(removed.room.revision);
      await oldChannel.unsubscribe();
    }, 180_000);

    it("invalidates a finalized room for its bill edit but not an unrelated group event", async () => {
      const setup = await roomWithGuest("V");
      const claimed = await rpc<RoomView>(
        hostClient,
        "set_assignment_room_claim",
        {
          p_room_id: setup.roomId,
          p_member_token: null,
          p_item_id: setup.created.room.items[0].id,
          p_participant_id: setup.created.room.selfParticipantId,
          p_expected_item_revision: setup.created.room.items[0].revision,
          p_ticks: 120_000,
        }
      );
      const closed = await rpc<RoomView>(hostClient, "close_assignment_room", {
        p_room_id: setup.roomId,
        p_expected_revision: claimed.room.revision,
      });
      const built = buildAssignmentExpense(
        closed as unknown as Extract<AssignmentRoomView, { role: "host" }>,
        [{ participantIndex: 0, amountCents: 4_000 }]
      );
      if (!built.ok) throw new Error(JSON.stringify(built.issue));
      const channel = await joinSubscribed(() =>
        anonClient.channel(closed.room.topic, {
          config: { private: true },
        })
      );
      // Consume finalization first so the freshly subscribed socket has
      // delivered a room invalidation before the bill edit under test.
      const finalizationMessage = nextRevisionBroadcast(
        channel,
        closed.room.revision + 1
      );
      const finalized = await rpc<FinalizeResult>(
        hostClient,
        "finalize_assignment_room",
        {
          p_room_id: setup.roomId,
          p_expected_revision: closed.room.revision,
          p_payload: built.value,
        }
      );
      expectRevisionPayload(
        (await finalizationMessage).payload,
        closed.room.revision + 1
      );

      const editMessage = nextRevisionBroadcast(
        channel,
        finalized.room.room.revision + 1
      );
      await rpc(hostClient, "edit_expense", {
        p_expense_id: finalized.ack.expenseId,
        p_expected_version_no: 1,
        p_occurred_on: HEADER.occurredOn,
        p_title: "Conta corrigida",
        p_merchant_name: null,
        p_expense_type: "itemized",
        p_total_cents: 4_000,
        p_service_fee_bps: 0,
        p_fixed_fee_cents: 0,
        p_payload: built.value,
      });
      const editedMessage = await editMessage;
      expectRevisionPayload(
        editedMessage.payload,
        finalized.room.room.revision + 1
      );
      // The expense trigger is the sole invalidation owner for bill edits,
      // so the room revision advanced exactly once even though
      // broadcast_group also carried the expense_edited group event.
      const editedRoom = await rpc<RoomView>(
        hostClient,
        "get_assignment_room",
        { p_room_id: setup.roomId, p_member_token: null }
      );
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
  }
);
