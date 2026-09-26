import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createGroup,
  createTestUsers,
  expectRpcError,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";
import { assertLedgerInvariantsAfterEach } from "@/test/ledger-invariants";

assertLedgerInvariantsAfterEach();

type Client = SupabaseClient<Database>;
type CreateArgs =
  Database["public"]["Functions"]["create_assignment_room"]["Args"];

interface RoomView {
  role: "host" | "participant";
  room: {
    id: string;
    revision: number;
    status: string;
    selfParticipantId: string;
    totalCents: number;
    items: Array<{ id: string; revision: number }>;
  };
}

const HEADER = {
  title: "Conta do grupo",
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
];
const ROOM_TOTAL_CENTS = 4_500;

function existingTarget(groupId: string): Json {
  return { kind: "existing", groupId };
}

function joinToken(fill: string): string {
  return `armj1_${fill.repeat(43)}`;
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

async function createRoom(client: Client, args: CreateArgs): Promise<RoomView> {
  return rpc<RoomView>(client, "create_assignment_room", args);
}

async function claimItem(
  client: Client,
  roomId: string,
  itemId: string,
  itemRevision: number,
  participantId: string,
  ticks: number
): Promise<RoomView> {
  return rpc<RoomView>(client, "set_assignment_room_claim", {
    p_room_id: roomId,
    p_member_token: null,
    p_item_id: itemId,
    p_participant_id: participantId,
    p_expected_item_revision: itemRevision,
    p_ticks: ticks,
  });
}

async function closeRoom(
  client: Client,
  roomId: string,
  expectedRevision: number
): Promise<RoomView> {
  return rpc<RoomView>(client, "close_assignment_room", {
    p_room_id: roomId,
    p_expected_revision: expectedRevision,
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

async function readRoomEvents(
  roomId: string
): Promise<Array<{ kind: string; payload: Record<string, unknown> }>> {
  return withPg((client) =>
    client.query<{ kind: string; payload: Record<string, unknown> }>(
      "select kind, payload from public.group_events where payload->>'roomId' = $1",
      [roomId]
    ).then((result) => result.rows)
  );
}

describe.skipIf(!isIntegrationTestReady)(
  "announce assignment room",
  () => {
    let host: TestUser;
    let member: TestUser;
    let hostClient: Client;
    let memberClient: Client;
    let anonClient: Client;
    let groupId: string;

    beforeAll(async () => {
      [host, member] = await createTestUsers(2);
      hostClient = authenticateAs(host);
      memberClient = authenticateAs(member);
      anonClient = createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } }
      );
      const created = await createGroup(host, "Grupo announce");
      groupId = created.groupId;
    });

    it("announces once with the documented payload and replays the same event id", async () => {
      const created = await createRoom(hostClient, roomArgs(host, existingTarget(groupId)));

      const ack = await rpc<{ eventId: number }>(hostClient, "announce_assignment_room", {
        p_room_id: created.room.id,
      });
      expect(Number.isInteger(ack.eventId)).toBe(true);

      const rows = await readRoomEvents(created.room.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].kind).toBe("assignment_room_opened");
      expect(rows[0].payload).toEqual({
        roomId: created.room.id,
        title: HEADER.title,
        totalCents: ROOM_TOTAL_CENTS,
      });

      const replay = await rpc<{ eventId: number }>(hostClient, "announce_assignment_room", {
        p_room_id: created.room.id,
      });
      expect(replay.eventId).toBe(ack.eventId);
      expect(await readRoomEvents(created.room.id)).toHaveLength(1);
    });

    it("restricts announcing to the host of an existing-group room", async () => {
      const created = await createRoom(hostClient, roomArgs(host, existingTarget(groupId)));
      await expect(
        expectRpcError(
          memberClient.rpc("announce_assignment_room", { p_room_id: created.room.id })
        )
      ).resolves.toContain("room_host_required");

      const newTarget = await createRoom(
        hostClient,
        roomArgs(host, { kind: "new", name: "Sala nova" })
      );
      await expect(
        expectRpcError(
          hostClient.rpc("announce_assignment_room", { p_room_id: newTarget.room.id })
        )
      ).resolves.toContain("invalid_operation");
    });

    it("refuses to announce closed and cancelled rooms", async () => {
      const closed = await createRoom(hostClient, roomArgs(host, existingTarget(groupId)));
      const claimed = await claimEveryItemAsHost(hostClient, closed);
      await closeRoom(hostClient, closed.room.id, claimed.room.revision);
      await expect(
        expectRpcError(
          hostClient.rpc("announce_assignment_room", { p_room_id: closed.room.id })
        )
      ).resolves.toContain("room_closed");

      const cancelled = await createRoom(hostClient, roomArgs(host, existingTarget(groupId)));
      await rpc(hostClient, "cancel_assignment_room", {
        p_room_id: cancelled.room.id,
        p_expected_revision: cancelled.room.revision,
      });
      await expect(
        expectRpcError(
          hostClient.rpc("announce_assignment_room", { p_room_id: cancelled.room.id })
        )
      ).resolves.toContain("room_cancelled");
    });

    it("denies anon execution of announce", async () => {
      const created = await createRoom(hostClient, roomArgs(host, existingTarget(groupId)));
      await expect(
        expectRpcError(
          anonClient.rpc("announce_assignment_room", { p_room_id: created.room.id })
        )
      ).resolves.toMatch(/permission denied/);
    });
  }
);
