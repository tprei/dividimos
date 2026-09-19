import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createTestUsers,
  expectRpcError,
  type TestUser,
  withPg,
} from "@/test/integration-helpers";
import { forceLockContentionRace } from "@/test/db-race-barrier";
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
    items: Array<{
      id: string;
      revision: number;
      quantityMilliunits: number;
    }>;
    participants: Array<{ id: string; displayName: string; removed: boolean }>;
    claims: Array<{ itemId: string; participantId: string; ticks: number }>;
  };
}

const HEADER = {
  title: "Conta compartilhada",
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
  {
    description: "Molho grátis",
    quantityMilliunits: 1_000,
    unitPriceCents: 0,
    totalPriceCents: 0,
  },
];

function joinToken(fill: string): string {
  return `armj1_${fill.repeat(43)}`;
}

function memberToken(fill: string): string {
  return `armm1_${fill.repeat(43)}`;
}

function roomArgs(host: TestUser): CreateArgs {
  return {
    p_room_id: crypto.randomUUID(),
    p_group_target: { kind: "new", name: "Conta compartilhada" },
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

async function joinRoom(
  client: Client,
  roomId: string,
  token: string,
  name: string
): Promise<RoomView> {
  return rpc<RoomView>(client, "join_assignment_room", {
    p_room_id: roomId,
    p_join_token: joinToken("A"),
    p_member_token: token,
    p_display_name: name,
  });
}

async function setClaim(
  client: Client,
  roomId: string,
  member: string | null,
  itemId: string,
  participantId: string,
  itemRevision: number,
  ticks: number
): Promise<RoomView> {
  return rpc<RoomView>(client, "set_assignment_room_claim", {
    p_room_id: roomId,
    p_member_token: member,
    p_item_id: itemId,
    p_participant_id: participantId,
    p_expected_item_revision: itemRevision,
    p_ticks: ticks,
  });
}

describe.skipIf(!isIntegrationTestReady)(
  "assignment room claims and closing",
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
    });

    it("uses absolute ticks, item revisions, and self-only guest writes", async () => {
      const args = roomArgs(host);
      const created = await createRoom(hostClient, args);
      const token = memberToken("B");
      const guest = await joinRoom(anonClient, args.p_room_id, token, "Bia");
      const item = guest.room.items[0];
      const hostId = created.room.selfParticipantId;
      const guestId = guest.room.selfParticipantId;

      const claimed = await setClaim(
        anonClient,
        args.p_room_id,
        token,
        item.id,
        guestId,
        item.revision,
        60_000
      );
      expect(claimed.room.status).toBe("open");
      expect(claimed.room.claims).toContainEqual({
        itemId: item.id,
        participantId: guestId,
        ticks: 60_000,
      });
      const changedRevision = claimed.room.items[0].revision;
      const changedRoomRevision = claimed.room.revision;

      const noOp = await setClaim(
        anonClient,
        args.p_room_id,
        token,
        item.id,
        guestId,
        item.revision,
        60_000
      );
      expect(noOp.room.items[0].revision).toBe(changedRevision);
      expect(noOp.room.revision).toBe(changedRoomRevision);

      expect(
        await expectRpcError(
          anonClient.rpc("set_assignment_room_claim", {
            p_room_id: args.p_room_id,
            p_member_token: token,
            p_item_id: item.id,
            p_participant_id: hostId,
            p_expected_item_revision: changedRevision,
            p_ticks: 1,
          })
        )
      ).toContain("not_a_member");

      const secondItem = noOp.room.items[1];
      const otherItemChange = await setClaim(
        hostClient,
        args.p_room_id,
        null,
        secondItem.id,
        hostId,
        secondItem.revision,
        1
      );
      const corrected = await setClaim(
        hostClient,
        args.p_room_id,
        null,
        item.id,
        guestId,
        changedRevision,
        120_000
      );
      expect(corrected.room.revision).toBeGreaterThan(
        otherItemChange.room.revision
      );
      expect(corrected.room.claims).toContainEqual({
        itemId: item.id,
        participantId: guestId,
        ticks: 120_000,
      });
      expect(
        await expectRpcError(
          hostClient.rpc("set_assignment_room_claim", {
            p_room_id: args.p_room_id,
            p_member_token: null as never,
            p_item_id: item.id,
            p_participant_id: hostId,
            p_expected_item_revision: corrected.room.items[0].revision,
            p_ticks: 1,
          })
        )
      ).toContain("item_unavailable");
    });

    it("requires exact quantity claims and closes only explicitly", async () => {
      const args = roomArgs(host);
      const created = await createRoom(hostClient, args);
      const hostId = created.room.selfParticipantId;
      const first = await setClaim(
        hostClient,
        args.p_room_id,
        null,
        created.room.items[0].id,
        hostId,
        created.room.items[0].revision,
        120_000
      );
      expect(first.room.status).toBe("open");
      expect(
        await expectRpcError(
          hostClient.rpc("close_assignment_room", {
            p_room_id: args.p_room_id,
            p_expected_revision: first.room.revision,
          })
        )
      ).toContain("room_incomplete");

      const complete = await setClaim(
        hostClient,
        args.p_room_id,
        null,
        first.room.items[1].id,
        hostId,
        first.room.items[1].revision,
        120_000
      );
      expect(complete.room.status).toBe("open");
      const closed = await rpc<RoomView>(hostClient, "close_assignment_room", {
        p_room_id: args.p_room_id,
        p_expected_revision: complete.room.revision,
      });
      expect(closed.room.status).toBe("closed");

      const corrected = await setClaim(
        hostClient,
        args.p_room_id,
        null,
        closed.room.items[0].id,
        hostId,
        closed.room.items[0].revision,
        119_999
      );
      expect(corrected.room.status).toBe("closed");
      const retried = await rpc<RoomView>(hostClient, "close_assignment_room", {
        p_room_id: args.p_room_id,
        p_expected_revision: 1,
      });
      expect(retried.room.revision).toBe(corrected.room.revision);
    });

    it("rejects guest edits after close and all edits after cancellation", async () => {
      const args = roomArgs(host);
      const created = await createRoom(hostClient, args);
      const token = memberToken("C");
      const guest = await joinRoom(anonClient, args.p_room_id, token, "Caio");
      let view = await setClaim(
        hostClient,
        args.p_room_id,
        null,
        created.room.items[0].id,
        created.room.selfParticipantId,
        created.room.items[0].revision,
        120_000
      );
      view = await setClaim(
        hostClient,
        args.p_room_id,
        null,
        view.room.items[1].id,
        created.room.selfParticipantId,
        view.room.items[1].revision,
        120_000
      );
      const closed = await rpc<RoomView>(hostClient, "close_assignment_room", {
        p_room_id: args.p_room_id,
        p_expected_revision: view.room.revision,
      });
      expect(
        await expectRpcError(
          anonClient.rpc("set_assignment_room_claim", {
            p_room_id: args.p_room_id,
            p_member_token: token,
            p_item_id: closed.room.items[0].id,
            p_participant_id: guest.room.selfParticipantId,
            p_expected_item_revision: closed.room.items[0].revision,
            p_ticks: 1,
          })
        )
      ).toContain("room_closed");

      const cancelledArgs = roomArgs(host);
      const cancelledRoom = await createRoom(hostClient, cancelledArgs);
      await rpc(hostClient, "cancel_assignment_room", {
        p_room_id: cancelledArgs.p_room_id,
        p_expected_revision: cancelledRoom.room.revision,
      });
      expect(
        await expectRpcError(
          hostClient.rpc("set_assignment_room_claim", {
            p_room_id: cancelledArgs.p_room_id,
            p_member_token: null as never,
            p_item_id: cancelledRoom.room.items[0].id,
            p_participant_id: cancelledRoom.room.selfParticipantId,
            p_expected_item_revision: 1,
            p_ticks: 1,
          })
        )
      ).toContain("room_cancelled");
    });

    it("serializes contested claims on one item", async () => {
      const args = roomArgs(host);
      const created = await createRoom(hostClient, args);
      const firstToken = memberToken("D");
      const secondToken = memberToken("E");
      const first = await joinRoom(anonClient, args.p_room_id, firstToken, "Dani");
      const second = await joinRoom(anonClient, args.p_room_id, secondToken, "Eli");
      const item = created.room.items[0];
      const race = await forceLockContentionRace(
        process.env.SUPABASE_DB_URL!,
        {
          lockSql: "select id from public.assignment_rooms where id = $1 for update",
          lockParams: [args.p_room_id],
          queryContains: ["set_assignment_room_claim", "set_assignment_room_claim"],
          expectedRacers: 2,
        },
        async () =>
          Promise.all([
            anonClient.rpc("set_assignment_room_claim", {
              p_room_id: args.p_room_id,
              p_member_token: firstToken,
              p_item_id: item.id,
              p_participant_id: first.room.selfParticipantId,
              p_expected_item_revision: item.revision,
              p_ticks: 120_000,
            }),
            anonClient.rpc("set_assignment_room_claim", {
              p_room_id: args.p_room_id,
              p_member_token: secondToken,
              p_item_id: item.id,
              p_participant_id: second.room.selfParticipantId,
              p_expected_item_revision: item.revision,
              p_ticks: 120_000,
            }),
          ])
      );
      expect(race.contention.observed).toBe(true);
      expect(race.result.filter((result) => result.error === null)).toHaveLength(1);
      const view = await rpc<RoomView>(hostClient, "get_assignment_room", {
        p_room_id: args.p_room_id,
        p_member_token: null,
      });
      expect(
        view.room.claims
          .filter((claim) => claim.itemId === item.id)
          .reduce((sum, claim) => sum + claim.ticks, 0)
      ).toBe(120_000);
    });

    it("serializes release against claim and claim against closing", async () => {
      const args = roomArgs(host);
      const created = await createRoom(hostClient, args);
      const firstToken = memberToken("F");
      const secondToken = memberToken("G");
      const first = await joinRoom(anonClient, args.p_room_id, firstToken, "Fê");
      const second = await joinRoom(anonClient, args.p_room_id, secondToken, "Gabi");
      const claimed = await setClaim(
        anonClient,
        args.p_room_id,
        firstToken,
        created.room.items[0].id,
        first.room.selfParticipantId,
        created.room.items[0].revision,
        120_000
      );
      const revision = claimed.room.items[0].revision;
      const releaseRace = await forceLockContentionRace(
        process.env.SUPABASE_DB_URL!,
        {
          lockSql: "select id from public.assignment_rooms where id = $1 for update",
          lockParams: [args.p_room_id],
          queryContains: ["set_assignment_room_claim", "set_assignment_room_claim"],
          expectedRacers: 2,
        },
        async () =>
          Promise.all([
            anonClient.rpc("set_assignment_room_claim", {
              p_room_id: args.p_room_id,
              p_member_token: firstToken,
              p_item_id: created.room.items[0].id,
              p_participant_id: first.room.selfParticipantId,
              p_expected_item_revision: revision,
              p_ticks: 0,
            }),
            anonClient.rpc("set_assignment_room_claim", {
              p_room_id: args.p_room_id,
              p_member_token: secondToken,
              p_item_id: created.room.items[0].id,
              p_participant_id: second.room.selfParticipantId,
              p_expected_item_revision: revision,
              p_ticks: 120_000,
            }),
          ])
      );
      expect(releaseRace.contention.observed).toBe(true);
      expect(
        releaseRace.result.filter((result) => result.error === null)
      ).toHaveLength(1);

      const current = await rpc<RoomView>(hostClient, "get_assignment_room", {
        p_room_id: args.p_room_id,
        p_member_token: null,
      });
      const item = current.room.items[1];
      const closeRace = await forceLockContentionRace(
        process.env.SUPABASE_DB_URL!,
        {
          lockSql: "select id from public.assignment_rooms where id = $1 for update",
          lockParams: [args.p_room_id],
          queryContains: ["set_assignment_room_claim", "close_assignment_room"],
          expectedRacers: 2,
        },
        async () =>
          Promise.all([
            hostClient.rpc("set_assignment_room_claim", {
              p_room_id: args.p_room_id,
              p_member_token: null as never,
              p_item_id: item.id,
              p_participant_id: created.room.selfParticipantId,
              p_expected_item_revision: item.revision,
              p_ticks: 120_000,
            }),
            hostClient.rpc("close_assignment_room", {
              p_room_id: args.p_room_id,
              p_expected_revision: current.room.revision,
            }),
          ])
      );
      expect(closeRace.contention.observed).toBe(true);
      expect(closeRace.result[0].error).toBeNull();
      expect(closeRace.result[1].error?.message).toMatch(
        /room_incomplete|stale_version/
      );
      const final = await rpc<RoomView>(hostClient, "get_assignment_room", {
        p_room_id: args.p_room_id,
        p_member_token: null,
      });
      expect(final.room.status).toBe("open");
    });

    it("keeps claim removal races coherent and rejects cross-room ids", async () => {
      const args = roomArgs(host);
      const created = await createRoom(hostClient, args);
      const token = memberToken("H");
      const guest = await joinRoom(anonClient, args.p_room_id, token, "Helô");
      const otherArgs = roomArgs(host);
      const other = await createRoom(hostClient, otherArgs);
      expect(
        await expectRpcError(
          hostClient.rpc("set_assignment_room_claim", {
            p_room_id: args.p_room_id,
            p_member_token: null as never,
            p_item_id: other.room.items[0].id,
            p_participant_id: guest.room.selfParticipantId,
            p_expected_item_revision: 1,
            p_ticks: 1,
          })
        )
      ).toContain("item_unavailable");

      const current = await rpc<RoomView>(hostClient, "get_assignment_room", {
        p_room_id: args.p_room_id,
        p_member_token: null,
      });
      const race = await forceLockContentionRace(
        process.env.SUPABASE_DB_URL!,
        {
          lockSql: "select id from public.assignment_rooms where id = $1 for update",
          lockParams: [args.p_room_id],
          queryContains: [
            "set_assignment_room_claim",
            "remove_assignment_room_participant",
          ],
          expectedRacers: 2,
        },
        async () =>
          Promise.all([
            anonClient.rpc("set_assignment_room_claim", {
              p_room_id: args.p_room_id,
              p_member_token: token,
              p_item_id: created.room.items[0].id,
              p_participant_id: guest.room.selfParticipantId,
              p_expected_item_revision: created.room.items[0].revision,
              p_ticks: 120_000,
            }),
            hostClient.rpc("remove_assignment_room_participant", {
              p_room_id: args.p_room_id,
              p_participant_id: guest.room.selfParticipantId,
              p_expected_revision: current.room.revision,
              p_join_token: joinToken("I"),
            }),
          ])
      );
      expect(race.contention.observed).toBe(true);
      expect(race.result.filter((result) => result.error === null)).toHaveLength(1);
      const view = await rpc<RoomView>(hostClient, "get_assignment_room", {
        p_room_id: args.p_room_id,
        p_member_token: null,
      });
      const removed = view.room.participants.find(
        (participant) => participant.id === guest.room.selfParticipantId
      );
      if (removed?.removed) {
        expect(
          view.room.claims.some(
            (claim) => claim.participantId === guest.room.selfParticipantId
          )
        ).toBe(false);
      }

      await withPg(async (db) => {
        await db.query(
          "update public.assignment_rooms set status = 'finalized', closed_at = clock_timestamp() where id = $1",
          [otherArgs.p_room_id]
        );
      });
      expect(
        await expectRpcError(
          hostClient.rpc("set_assignment_room_claim", {
            p_room_id: otherArgs.p_room_id,
            p_member_token: null as never,
            p_item_id: other.room.items[0].id,
            p_participant_id: other.room.selfParticipantId,
            p_expected_item_revision: 1,
            p_ticks: 1,
          })
        )
      ).toContain("room_closed");
    });
  }
);
