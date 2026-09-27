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

interface Claim {
  participantId: string;
  ticks: number;
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

async function getRoom(client: Client, roomId: string): Promise<RoomView> {
  return rpc<RoomView>(client, "get_assignment_room", {
    p_room_id: roomId,
    p_member_token: null,
  });
}

async function setClaims(
  client: Client,
  roomId: string,
  itemId: string,
  itemRevision: number,
  claims: Claim[]
): Promise<RoomView> {
  return rpc<RoomView>(client, "set_assignment_room_item_claims", {
    p_room_id: roomId,
    p_item_id: itemId,
    p_expected_item_revision: itemRevision,
    p_claims: claims,
  });
}

function claimFor(
  room: RoomView,
  itemId: string,
  participantId: string
): number | undefined {
  return room.room.claims.find(
    (claim) => claim.itemId === itemId && claim.participantId === participantId
  )?.ticks;
}

describe.skipIf(!isIntegrationTestReady)(
  "assignment room item split",
  () => {
    let host: TestUser;
    let other: TestUser;
    let hostClient: Client;
    let otherClient: Client;
    let anonClient: Client;

    beforeAll(async () => {
      [host, other] = await createTestUsers(2);
      hostClient = authenticateAs(host);
      otherClient = authenticateAs(other);
      anonClient = createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } }
      );
    });

    it("splits an unclaimed item evenly and bumps each revision once", async () => {
      const args = roomArgs(host);
      const created = await createRoom(hostClient, args);
      const first = await joinRoom(anonClient, args.p_room_id, memberToken("B"), "Bia");
      const second = await joinRoom(anonClient, args.p_room_id, memberToken("C"), "Caio");
      const before = await getRoom(hostClient, args.p_room_id);
      const item = before.room.items[0];
      const shares: Claim[] = [
        { participantId: created.room.selfParticipantId, ticks: 40_000 },
        { participantId: first.room.selfParticipantId, ticks: 40_000 },
        { participantId: second.room.selfParticipantId, ticks: 40_000 },
      ];

      const view = await setClaims(
        hostClient,
        args.p_room_id,
        item.id,
        item.revision,
        shares
      );

      expect(view.room.status).toBe("open");
      expect(view.room.items[0].revision).toBe(item.revision + 1);
      expect(view.room.revision).toBe(before.room.revision + 1);
      for (const share of shares) {
        expect(claimFor(view, item.id, share.participantId)).toBe(40_000);
      }
    });

    it("rebalances a fully claimed item in one call without tripping capacity", async () => {
      const args = roomArgs(host);
      const created = await createRoom(hostClient, args);
      const guest = await joinRoom(anonClient, args.p_room_id, memberToken("D"), "Dani");
      const item = created.room.items[0];
      const hostId = created.room.selfParticipantId;
      const guestId = guest.room.selfParticipantId;
      const claimed = await setClaims(
        hostClient,
        args.p_room_id,
        item.id,
        item.revision,
        [{ participantId: hostId, ticks: 120_000 }]
      );
      const revision = claimed.room.items[0].revision;

      expect(
        await expectRpcError(
          hostClient.rpc("set_assignment_room_claim", {
            p_room_id: args.p_room_id,
            p_member_token: null as never,
            p_item_id: item.id,
            p_participant_id: guestId,
            p_expected_item_revision: revision,
            p_ticks: 60_000,
          })
        )
      ).toContain("item_unavailable");

      const view = await setClaims(
        hostClient,
        args.p_room_id,
        item.id,
        revision,
        [
          { participantId: hostId, ticks: 60_000 },
          { participantId: guestId, ticks: 60_000 },
        ]
      );

      expect(view.room.items[0].revision).toBe(revision + 1);
      expect(view.room.revision).toBe(claimed.room.revision + 1);
      expect(claimFor(view, item.id, hostId)).toBe(60_000);
      expect(claimFor(view, item.id, guestId)).toBe(60_000);
    });

    it("deletes listed zero claims and leaves unlisted claims untouched", async () => {
      const args = roomArgs(host);
      const created = await createRoom(hostClient, args);
      const first = await joinRoom(anonClient, args.p_room_id, memberToken("E"), "Elô");
      const second = await joinRoom(anonClient, args.p_room_id, memberToken("F"), "Fê");
      const item = created.room.items[0];
      await setClaims(hostClient, args.p_room_id, item.id, item.revision, [
        { participantId: created.room.selfParticipantId, ticks: 30_000 },
        { participantId: first.room.selfParticipantId, ticks: 30_000 },
      ]);
      const other = await rpc<RoomView>(hostClient, "set_assignment_room_claim", {
        p_room_id: args.p_room_id,
        p_member_token: null as never,
        p_item_id: item.id,
        p_participant_id: second.room.selfParticipantId,
        p_expected_item_revision: item.revision + 1,
        p_ticks: 60_000,
      });

      const view = await setClaims(
        hostClient,
        args.p_room_id,
        item.id,
        other.room.items[0].revision,
        [
          { participantId: created.room.selfParticipantId, ticks: 0 },
          { participantId: first.room.selfParticipantId, ticks: 0 },
        ]
      );

      expect(claimFor(view, item.id, created.room.selfParticipantId)).toBeUndefined();
      expect(claimFor(view, item.id, first.room.selfParticipantId)).toBeUndefined();
      expect(claimFor(view, item.id, second.room.selfParticipantId)).toBe(60_000);
      expect(view.room.items[0].revision).toBe(other.room.items[0].revision + 1);
    });

    it("returns the view unchanged for a no-op even with a stale expected revision", async () => {
      const args = roomArgs(host);
      const created = await createRoom(hostClient, args);
      const item = created.room.items[0];
      const hostId = created.room.selfParticipantId;
      const claimed = await setClaims(
        hostClient,
        args.p_room_id,
        item.id,
        item.revision,
        [{ participantId: hostId, ticks: 40_000 }]
      );

      const view = await setClaims(
        hostClient,
        args.p_room_id,
        item.id,
        item.revision + 5,
        [{ participantId: hostId, ticks: 40_000 }]
      );

      expect(view.room.items[0].revision).toBe(claimed.room.items[0].revision);
      expect(view.room.revision).toBe(claimed.room.revision);
      expect(claimFor(view, item.id, hostId)).toBe(40_000);
    });

    it("rejects a changed claim set on a stale revision and writes nothing", async () => {
      const args = roomArgs(host);
      const created = await createRoom(hostClient, args);
      const item = created.room.items[0];
      const hostId = created.room.selfParticipantId;
      const claimed = await setClaims(
        hostClient,
        args.p_room_id,
        item.id,
        item.revision,
        [{ participantId: hostId, ticks: 40_000 }]
      );

      expect(
        await expectRpcError(
          hostClient.rpc("set_assignment_room_item_claims", {
            p_room_id: args.p_room_id,
            p_item_id: item.id,
            p_expected_item_revision: item.revision,
            p_claims: [{ participantId: hostId, ticks: 80_000 }],
          })
        )
      ).toContain("stale_version");

      const view = await getRoom(hostClient, args.p_room_id);
      expect(view.room.items[0].revision).toBe(claimed.room.items[0].revision);
      expect(claimFor(view, item.id, hostId)).toBe(40_000);
    });

    it("rejects over capacity and writes nothing", async () => {
      const args = roomArgs(host);
      const created = await createRoom(hostClient, args);
      const first = await joinRoom(anonClient, args.p_room_id, memberToken("G"), "Gabi");
      const second = await joinRoom(anonClient, args.p_room_id, memberToken("H"), "Helô");
      const item = created.room.items[0];
      const hostId = created.room.selfParticipantId;
      const firstClaim = await rpc<RoomView>(hostClient, "set_assignment_room_claim", {
        p_room_id: args.p_room_id,
        p_member_token: null as never,
        p_item_id: item.id,
        p_participant_id: first.room.selfParticipantId,
        p_expected_item_revision: item.revision,
        p_ticks: 60_000,
      });
      await rpc<RoomView>(hostClient, "set_assignment_room_claim", {
        p_room_id: args.p_room_id,
        p_member_token: null as never,
        p_item_id: item.id,
        p_participant_id: second.room.selfParticipantId,
        p_expected_item_revision: firstClaim.room.items[0].revision,
        p_ticks: 60_000,
      });
      const current = await getRoom(hostClient, args.p_room_id);

      expect(
        await expectRpcError(
          hostClient.rpc("set_assignment_room_item_claims", {
            p_room_id: args.p_room_id,
            p_item_id: item.id,
            p_expected_item_revision: current.room.items[0].revision,
            p_claims: [{ participantId: hostId, ticks: 60_000 }],
          })
        )
      ).toContain("item_unavailable");

      const view = await getRoom(hostClient, args.p_room_id);
      expect(view.room.items[0].revision).toBe(current.room.items[0].revision);
      expect(claimFor(view, item.id, hostId)).toBeUndefined();
      expect(claimFor(view, item.id, first.room.selfParticipantId)).toBe(60_000);
      expect(claimFor(view, item.id, second.room.selfParticipantId)).toBe(60_000);
    });

    it("requires the room host", async () => {
      const args = roomArgs(host);
      const created = await createRoom(hostClient, args);
      expect(
        await expectRpcError(
          otherClient.rpc("set_assignment_room_item_claims", {
            p_room_id: args.p_room_id,
            p_item_id: created.room.items[0].id,
            p_expected_item_revision: created.room.items[0].revision,
            p_claims: [
              { participantId: created.room.selfParticipantId, ticks: 1 },
            ],
          })
        )
      ).toContain("room_host_required");
    });

    it("rejects anonymous callers", async () => {
      const args = roomArgs(host);
      const created = await createRoom(hostClient, args);
      const item = created.room.items[0];
      expect(
        await expectRpcError(
          anonClient.rpc("set_assignment_room_item_claims", {
            p_room_id: args.p_room_id,
            p_item_id: item.id,
            p_expected_item_revision: item.revision,
            p_claims: [
              { participantId: created.room.selfParticipantId, ticks: 1 },
            ],
          })
        )
      ).toContain("permission denied");

      const view = await getRoom(hostClient, args.p_room_id);
      expect(view.room.claims).toHaveLength(0);
      expect(view.room.items[0].revision).toBe(item.revision);
    });

    it("rejects removed and cross-room participants and writes nothing", async () => {
      const args = roomArgs(host);
      const created = await createRoom(hostClient, args);
      const guest = await joinRoom(anonClient, args.p_room_id, memberToken("I"), "Ivo");
      const removedId = guest.room.selfParticipantId;
      await withPg(async (db) => {
        await db.query(
          "update public.assignment_room_participants set removed_at = clock_timestamp() where id = $1",
          [removedId]
        );
      });
      const otherArgs = roomArgs(host);
      const otherRoom = await createRoom(hostClient, otherArgs);
      const item = created.room.items[0];

      expect(
        await expectRpcError(
          hostClient.rpc("set_assignment_room_item_claims", {
            p_room_id: args.p_room_id,
            p_item_id: item.id,
            p_expected_item_revision: item.revision,
            p_claims: [{ participantId: removedId, ticks: 1 }],
          })
        )
      ).toContain("not_a_member");
      expect(
        await expectRpcError(
          hostClient.rpc("set_assignment_room_item_claims", {
            p_room_id: args.p_room_id,
            p_item_id: item.id,
            p_expected_item_revision: item.revision,
            p_claims: [
              {
                participantId: otherRoom.room.selfParticipantId,
                ticks: 1,
              },
            ],
          })
        )
      ).toContain("not_a_member");

      const view = await getRoom(hostClient, args.p_room_id);
      expect(view.room.items[0].revision).toBe(item.revision);
      expect(view.room.claims).toHaveLength(0);
    });

    it("rejects malformed payloads with invalid_argument", async () => {
      const args = roomArgs(host);
      const created = await createRoom(hostClient, args);
      const item = created.room.items[0];
      const hostId = created.room.selfParticipantId;
      const call = (pClaims: unknown) =>
        expectRpcError(
          hostClient.rpc("set_assignment_room_item_claims", {
            p_room_id: args.p_room_id,
            p_item_id: item.id,
            p_expected_item_revision: item.revision,
            p_claims: pClaims as never,
          })
        );

      expect(await call({ participantId: hostId, ticks: 1 })).toContain(
        "invalid_argument"
      );
      expect(await call([])).toContain("invalid_argument");
      expect(await call([{ ticks: 1 }])).toContain("invalid_argument");
      expect(await call([{ participantId: hostId }])).toContain(
        "invalid_argument"
      );
      expect(
        await call([
          { participantId: hostId, ticks: 1 },
          { participantId: hostId, ticks: 2 },
        ])
      ).toContain("invalid_argument");
      expect(await call([{ participantId: hostId, ticks: -1 }])).toContain(
        "invalid_argument"
      );
      expect(await call([{ participantId: hostId, ticks: 40_000.5 }])).toContain(
        "invalid_argument"
      );

      const view = await getRoom(hostClient, args.p_room_id);
      expect(view.room.claims).toHaveLength(0);
    });

    it("keeps accepting the host after the room closes", async () => {
      const args = roomArgs(host);
      const created = await createRoom(hostClient, args);
      const hostId = created.room.selfParticipantId;
      const firstItem = created.room.items[0];
      const secondItem = created.room.items[1];
      const split = await setClaims(
        hostClient,
        args.p_room_id,
        firstItem.id,
        firstItem.revision,
        [{ participantId: hostId, ticks: 120_000 }]
      );
      const single = await rpc<RoomView>(hostClient, "set_assignment_room_claim", {
        p_room_id: args.p_room_id,
        p_member_token: null as never,
        p_item_id: secondItem.id,
        p_participant_id: hostId,
        p_expected_item_revision: secondItem.revision,
        p_ticks: 120_000,
      });
      const closed = await rpc<RoomView>(hostClient, "close_assignment_room", {
        p_room_id: args.p_room_id,
        p_expected_revision: single.room.revision,
      });
      expect(closed.room.status).toBe("closed");

      const view = await setClaims(
        hostClient,
        args.p_room_id,
        firstItem.id,
        split.room.items[0].revision,
        [{ participantId: hostId, ticks: 119_999 }]
      );

      expect(view.room.status).toBe("closed");
      expect(claimFor(view, firstItem.id, hostId)).toBe(119_999);
    });

    it("rejects finalized rooms", async () => {
      const args = roomArgs(host);
      const created = await createRoom(hostClient, args);
      await withPg(async (db) => {
        await db.query(
          "update public.assignment_rooms set status = 'finalized', closed_at = clock_timestamp() where id = $1",
          [args.p_room_id]
        );
      });
      expect(
        await expectRpcError(
          hostClient.rpc("set_assignment_room_item_claims", {
            p_room_id: args.p_room_id,
            p_item_id: created.room.items[0].id,
            p_expected_item_revision: created.room.items[0].revision,
            p_claims: [
              { participantId: created.room.selfParticipantId, ticks: 1 },
            ],
          })
        )
      ).toContain("room_closed");
    });

    it("rejects cancelled rooms", async () => {
      const args = roomArgs(host);
      const created = await createRoom(hostClient, args);
      await rpc<RoomView>(hostClient, "cancel_assignment_room", {
        p_room_id: args.p_room_id,
        p_expected_revision: created.room.revision,
      });
      expect(
        await expectRpcError(
          hostClient.rpc("set_assignment_room_item_claims", {
            p_room_id: args.p_room_id,
            p_item_id: created.room.items[0].id,
            p_expected_item_revision: created.room.items[0].revision,
            p_claims: [
              { participantId: created.room.selfParticipantId, ticks: 1 },
            ],
          })
        )
      ).toContain("room_cancelled");
    });
  }
);
