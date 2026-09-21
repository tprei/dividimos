import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createGroupWithMembers,
  createTestUsers,
  expectRpcError,
  withPg,
  type TestUser,
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
    topic: string;
    participants: Array<{
      id: string;
      ordinal: number;
      displayName: string;
      isGuest: boolean;
      removed: boolean;
    }>;
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
];

function joinToken(fill: string): string {
  return `armj1_${fill.repeat(43)}`;
}

function memberToken(fill: string): string {
  return `armm1_${fill.repeat(43)}`;
}

function createArgs(
  host: TestUser,
  extraParticipants: Json[] = []
): CreateArgs {
  return {
    p_room_id: crypto.randomUUID(),
    p_group_target: { kind: "new", name: "Conta compartilhada" },
    p_header: HEADER,
    p_items: ITEMS,
    p_participants: [
      { id: crypto.randomUUID(), displayName: host.name, userId: host.id },
      ...extraParticipants,
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
  join: string,
  member: string,
  displayName: string
): Promise<RoomView> {
  return rpc<RoomView>(client, "join_assignment_room", {
    p_room_id: roomId,
    p_join_token: join,
    p_member_token: member,
    p_display_name: displayName,
  });
}

describe.skipIf(!isIntegrationTestReady)(
  "assignment room guest capabilities",
  () => {
    let host: TestUser;
    let selected: TestUser;
    let outsider: TestUser;
    let hostClient: Client;
    let selectedClient: Client;
    let outsiderClient: Client;
    let anonClient: Client;

    beforeAll(async () => {
      [host, selected, outsider] = await createTestUsers(3);
      hostClient = authenticateAs(host);
      selectedClient = authenticateAs(selected);
      outsiderClient = authenticateAs(outsider);
      anonClient = createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } }
      );
    });

    it("joins anonymously without creating group membership", async () => {
      const args = createArgs(host);
      await createRoom(hostClient, args);
      const before = await withPg(async (db) => {
        const result = await db.query(
          "select (select count(*) from public.group_members)::int as members, " +
            "(select count(*) from public.groups)::int as groups"
        );
        return result.rows[0];
      });

      const view = await joinRoom(
        anonClient,
        args.p_room_id,
        args.p_join_token,
        memberToken("B"),
        "Convidada"
      );

      expect(view.role).toBe("participant");
      expect(view.room.participants).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: view.room.selfParticipantId,
            ordinal: 1,
            displayName: "Convidada",
            removed: false,
          }),
        ])
      );
      const after = await withPg(async (db) => {
        const result = await db.query(
          "select (select count(*) from public.group_members)::int as members, " +
            "(select count(*) from public.groups)::int as groups"
        );
        return result.rows[0];
      });
      expect(after).toEqual(before);
    });

    it("keeps same-name guests distinct and retries by member capability after rotation", async () => {
      const args = createArgs(host);
      const created = await createRoom(hostClient, args);
      const firstToken = memberToken("C");
      const secondToken = memberToken("D");
      const first = await joinRoom(
        anonClient,
        args.p_room_id,
        args.p_join_token,
        firstToken,
        "Alex"
      );
      const second = await joinRoom(
        anonClient,
        args.p_room_id,
        args.p_join_token,
        secondToken,
        "Alex"
      );
      expect(first.room.selfParticipantId).not.toBe(
        second.room.selfParticipantId
      );
      expect(
        second.room.participants.filter((p) => p.displayName === "Alex")
      ).toHaveLength(2);

      await rpc(hostClient, "rotate_assignment_room_join", {
        p_room_id: args.p_room_id,
        p_join_token: joinToken("E"),
      });
      const retry = await joinRoom(
        anonClient,
        args.p_room_id,
        args.p_join_token,
        firstToken,
        "Changed"
      );
      expect(retry.room.selfParticipantId).toBe(first.room.selfParticipantId);
      expect(
        retry.room.participants.find(
          (p) => p.id === first.room.selfParticipantId
        )?.displayName
      ).toBe("Alex");
      expect(created.room.topic).toBe(retry.room.topic);
    });

    it("keeps a preseeded account on its own row and admits a new account holder", async () => {
      const selectedId = crypto.randomUUID();
      const args = createArgs(host, [
        { id: selectedId, displayName: selected.name, userId: selected.id },
      ]);
      await createRoom(hostClient, args);

      const view = await joinRoom(
        selectedClient,
        args.p_room_id,
        args.p_join_token,
        memberToken("F"),
        "Ignored"
      );
      expect(view.room.selfParticipantId).toBe(selectedId);

      // The invitation is the authorization. A display name in the request
      // cannot impersonate anyone: the profile name wins.
      const joined = await joinRoom(
        outsiderClient,
        args.p_room_id,
        args.p_join_token,
        memberToken("G"),
        selected.name
      );
      expect(joined.role).toBe("participant");
      expect(joined).not.toHaveProperty("groupTarget");
      expect(joined).not.toHaveProperty("participantRefs");
      expect(joined.room.selfParticipantId).not.toBe(selectedId);
      const admitted = joined.room.participants.find(
        (p) => p.id === joined.room.selfParticipantId
      );
      expect(admitted?.displayName).toBe(outsider.name);
      expect(admitted?.isGuest).toBe(false);

      const retry = await joinRoom(
        outsiderClient,
        args.p_room_id,
        args.p_join_token,
        memberToken("G"),
        "Outro nome"
      );
      expect(retry.room.selfParticipantId).toBe(joined.room.selfParticipantId);
      expect(retry.room.participants).toHaveLength(3);

      const hostView = await rpc<RoomView>(hostClient, "get_assignment_room", {
        p_room_id: args.p_room_id,
        p_member_token: null,
      });
      expect(hostView.role).toBe("host");
      expect(
        hostView.room.participants.filter((p) => !p.removed)
      ).toHaveLength(3);
    });

    it("refuses a removed account and an account excluded from the group", async () => {
      const args = createArgs(host);
      const created = await createRoom(hostClient, args);
      const joined = await joinRoom(
        selectedClient,
        args.p_room_id,
        args.p_join_token,
        memberToken("a"),
        ""
      );
      await rpc<RoomView>(hostClient, "remove_assignment_room_participant", {
        p_room_id: args.p_room_id,
        p_participant_id: joined.room.selfParticipantId,
        p_expected_revision: created.room.revision + 1,
        p_join_token: joinToken("N"),
      });

      expect(
        await expectRpcError(
          selectedClient.rpc("join_assignment_room", {
            p_room_id: args.p_room_id,
            p_join_token: joinToken("N"),
            p_member_token: memberToken("b"),
            p_display_name: "",
          })
        )
      ).toContain("invalid_token");

      const groupId = await createGroupWithMembers(
        host,
        [outsider],
        "Grupo com exclusao"
      );
      await rpc<unknown>(hostClient, "remove_member", {
        p_group_id: groupId,
        p_user_id: outsider.id,
      });
      const excludedRoom: CreateArgs = {
        ...createArgs(host),
        p_group_target: { kind: "existing", groupId },
      };
      await createRoom(hostClient, excludedRoom);
      expect(
        await expectRpcError(
          outsiderClient.rpc("join_assignment_room", {
            p_room_id: excludedRoom.p_room_id,
            p_join_token: excludedRoom.p_join_token,
            p_member_token: memberToken("c"),
            p_display_name: "",
          })
        )
      ).toContain("member_excluded");
      const stillAlone = await rpc<RoomView>(
        hostClient,
        "get_assignment_room",
        { p_room_id: excludedRoom.p_room_id, p_member_token: null }
      );
      expect(stillAlone.room.participants).toHaveLength(1);
    });

    it("never reuses the ordinal of a removed participant", async () => {
      const args = createArgs(host);
      const created = await createRoom(hostClient, args);
      const guest = await joinRoom(
        anonClient,
        args.p_room_id,
        args.p_join_token,
        memberToken("d"),
        "Bia"
      );
      expect(
        guest.room.participants.find(
          (p) => p.id === guest.room.selfParticipantId
        )?.ordinal
      ).toBe(1);

      await rpc<RoomView>(hostClient, "remove_assignment_room_participant", {
        p_room_id: args.p_room_id,
        p_participant_id: guest.room.selfParticipantId,
        p_expected_revision: created.room.revision + 1,
        p_join_token: joinToken("R"),
      });

      const replacement = await joinRoom(
        anonClient,
        args.p_room_id,
        joinToken("R"),
        memberToken("e"),
        "Caio"
      );
      const account = await joinRoom(
        selectedClient,
        args.p_room_id,
        joinToken("R"),
        memberToken("f"),
        ""
      );
      const ordinals = account.room.participants.map((p) => p.ordinal);
      expect(new Set(ordinals).size).toBe(ordinals.length);
      expect(
        replacement.room.participants.find(
          (p) => p.id === replacement.room.selfParticipantId
        )?.ordinal
      ).toBe(2);
      expect(
        account.room.participants.find(
          (p) => p.id === account.room.selfParticipantId
        )?.ordinal
      ).toBe(3);
      expect(
        account.room.participants.filter((p) => !p.removed)
      ).toHaveLength(3);
    });

    it("keeps one active row when the same account joins twice at once", async () => {
      const args = createArgs(host);
      await createRoom(hostClient, args);
      const [first, second] = await Promise.all([
        selectedClient.rpc("join_assignment_room", {
          p_room_id: args.p_room_id,
          p_join_token: args.p_join_token,
          p_member_token: memberToken("g"),
          p_display_name: "",
        }),
        selectedClient.rpc("join_assignment_room", {
          p_room_id: args.p_room_id,
          p_join_token: args.p_join_token,
          p_member_token: memberToken("h"),
          p_display_name: "",
        }),
      ]);
      const succeeded = [first, second].filter((result) => !result.error);
      expect(succeeded.length).toBeGreaterThan(0);

      const rows = await withPg(async (db) => {
        const result = await db.query<{ count: number }>(
          "select count(*)::int as count from public.assignment_room_participants where room_id = $1 and user_id = $2 and removed_at is null",
          [args.p_room_id, selected.id]
        );
        return result.rows[0].count;
      });
      expect(rows).toBe(1);
    });

    it("applies the fifty-participant cap to account joins too", async () => {
      const slots = Array.from({ length: 49 }, (_, index) => ({
        id: crypto.randomUUID(),
        displayName: `Convidado ${index}`,
        userId: null,
      }));
      const args = createArgs(host, slots);
      await createRoom(hostClient, args);
      expect(
        await expectRpcError(
          selectedClient.rpc("join_assignment_room", {
            p_room_id: args.p_room_id,
            p_join_token: args.p_join_token,
            p_member_token: memberToken("i"),
            p_display_name: "",
          })
        )
      ).toContain("too_many_participants");
    });

    it("keeps capabilities room-bound and rejects expired access opaquely", async () => {
      const roomA = createArgs(host);
      const roomB = createArgs(host);
      await createRoom(hostClient, roomA);
      await createRoom(hostClient, roomB);
      const token = memberToken("H");
      await joinRoom(
        anonClient,
        roomA.p_room_id,
        roomA.p_join_token,
        token,
        "Bia"
      );

      expect(
        await expectRpcError(
          anonClient.rpc("get_assignment_room", {
            p_room_id: roomB.p_room_id,
            p_member_token: token,
          })
        )
      ).toContain("invalid_token");

      await withPg(async (db) => {
        await db.query(
          "update guest_credentials.assignment_room_members set expires_at = now() - interval '1 second' where room_id = $1",
          [roomA.p_room_id]
        );
      });
      for (const name of [
        "get_assignment_room",
        "refresh_assignment_room_member",
      ] as const) {
        expect(
          await expectRpcError(
            anonClient.rpc(name, {
              p_room_id: roomA.p_room_id,
              p_member_token: token,
            })
          )
        ).toContain("invalid_token");
      }
    });

    it("refreshes valid access and removal revokes it while rotating room credentials", async () => {
      const args = createArgs(host);
      await createRoom(hostClient, args);
      const token = memberToken("I");
      const joined = await joinRoom(
        anonClient,
        args.p_room_id,
        args.p_join_token,
        token,
        "Caio"
      );
      const refreshed = await rpc<RoomView>(
        anonClient,
        "refresh_assignment_room_member",
        { p_room_id: args.p_room_id, p_member_token: token }
      );
      expect(refreshed.room.selfParticipantId).toBe(
        joined.room.selfParticipantId
      );

      const hostView = await rpc<RoomView>(hostClient, "get_assignment_room", {
        p_room_id: args.p_room_id,
        p_member_token: null,
      });
      const removed = await rpc<RoomView>(
        hostClient,
        "remove_assignment_room_participant",
        {
          p_room_id: args.p_room_id,
          p_participant_id: joined.room.selfParticipantId,
          p_expected_revision: hostView.room.revision,
          p_join_token: joinToken("J"),
        }
      );
      expect(removed.room.topic).not.toBe(joined.room.topic);
      expect(
        removed.room.participants.find(
          (p) => p.id === joined.room.selfParticipantId
        )?.removed
      ).toBe(true);

      for (const name of [
        "get_assignment_room",
        "refresh_assignment_room_member",
      ] as const) {
        expect(
          await expectRpcError(
            anonClient.rpc(name, {
              p_room_id: args.p_room_id,
              p_member_token: token,
            })
          )
        ).toContain("invalid_token");
      }
      expect(
        await expectRpcError(
          anonClient.rpc("join_assignment_room", {
            p_room_id: args.p_room_id,
            p_join_token: joinToken("J"),
            p_member_token: token,
            p_display_name: "Caio",
          })
        )
      ).toContain("invalid_token");
    });

    it("enforces the fifty-participant cap with a stable error", async () => {
      const slots = Array.from({ length: 49 }, (_, index) => ({
        id: crypto.randomUUID(),
        displayName: `Convidado ${index}`,
        userId: null,
      }));
      const args = createArgs(host, slots);
      await createRoom(hostClient, args);
      expect(
        await expectRpcError(
          anonClient.rpc("join_assignment_room", {
            p_room_id: args.p_room_id,
            p_join_token: args.p_join_token,
            p_member_token: memberToken("K"),
            p_display_name: "Excedente",
          })
        )
      ).toContain("too_many_participants");
    });

    it("cancels once and invalidates member reads", async () => {
      const args = createArgs(host);
      const created = await createRoom(hostClient, args);
      const token = memberToken("L");
      await joinRoom(
        anonClient,
        args.p_room_id,
        args.p_join_token,
        token,
        "Dani"
      );
      const current = await rpc<RoomView>(hostClient, "get_assignment_room", {
        p_room_id: args.p_room_id,
        p_member_token: null,
      });
      const cancelled = await rpc<RoomView>(
        hostClient,
        "cancel_assignment_room",
        {
          p_room_id: args.p_room_id,
          p_expected_revision: current.room.revision,
        }
      );
      expect(cancelled.room.status).toBe("cancelled");
      expect(cancelled.room.revision).toBeGreaterThan(created.room.revision);
      expect(
        await expectRpcError(
          anonClient.rpc("get_assignment_room", {
            p_room_id: args.p_room_id,
            p_member_token: token,
          })
        )
      ).toContain("invalid_token");
    });

    it("serializes a queued member retry against removal", async () => {
      const args = createArgs(host);
      await createRoom(hostClient, args);
      const token = memberToken("M");
      const joined = await joinRoom(
        anonClient,
        args.p_room_id,
        args.p_join_token,
        token,
        "Eva"
      );
      const current = await rpc<RoomView>(hostClient, "get_assignment_room", {
        p_room_id: args.p_room_id,
        p_member_token: null,
      });

      const race = await forceLockContentionRace(
        process.env.SUPABASE_DB_URL!,
        {
          lockSql:
            "select id from public.assignment_rooms where id = $1 for update",
          lockParams: [args.p_room_id],
          queryContains: [
            "remove_assignment_room_participant",
            "join_assignment_room",
          ],
          expectedRacers: 2,
        },
        async () => {
          const remove = hostClient.rpc("remove_assignment_room_participant", {
            p_room_id: args.p_room_id,
            p_participant_id: joined.room.selfParticipantId,
            p_expected_revision: current.room.revision,
            p_join_token: joinToken("N"),
          });
          const retry = anonClient.rpc("join_assignment_room", {
            p_room_id: args.p_room_id,
            p_join_token: args.p_join_token,
            p_member_token: token,
            p_display_name: "Eva",
          });
          return Promise.all([remove, retry]);
        }
      );

      expect(race.contention.observed).toBe(true);
      expect(race.result[0].error).toBeNull();
      if (race.result[1].error) {
        expect(race.result[1].error.message).toContain("invalid_token");
      }
      expect(
        await expectRpcError(
          anonClient.rpc("get_assignment_room", {
            p_room_id: args.p_room_id,
            p_member_token: token,
          })
        )
      ).toContain("invalid_token");
    });

    it("serializes a queued refresh against removal", async () => {
      const args = createArgs(host);
      await createRoom(hostClient, args);
      const token = memberToken("O");
      const joined = await joinRoom(
        anonClient,
        args.p_room_id,
        args.p_join_token,
        token,
        "Fê"
      );
      const current = await rpc<RoomView>(hostClient, "get_assignment_room", {
        p_room_id: args.p_room_id,
        p_member_token: null,
      });

      const race = await forceLockContentionRace(
        process.env.SUPABASE_DB_URL!,
        {
          lockSql:
            "select id from public.assignment_rooms where id = $1 for update",
          lockParams: [args.p_room_id],
          queryContains: [
            "remove_assignment_room_participant",
            "refresh_assignment_room_member",
          ],
          expectedRacers: 2,
        },
        async () => {
          const remove = hostClient.rpc("remove_assignment_room_participant", {
            p_room_id: args.p_room_id,
            p_participant_id: joined.room.selfParticipantId,
            p_expected_revision: current.room.revision,
            p_join_token: joinToken("P"),
          });
          const refresh = anonClient.rpc("refresh_assignment_room_member", {
            p_room_id: args.p_room_id,
            p_member_token: token,
          });
          return Promise.all([remove, refresh]);
        }
      );

      expect(race.contention.observed).toBe(true);
      expect(race.result[0].error).toBeNull();
      if (race.result[1].error) {
        expect(race.result[1].error.message).toContain("invalid_token");
      }
      expect(
        await expectRpcError(
          anonClient.rpc("get_assignment_room", {
            p_room_id: args.p_room_id,
            p_member_token: token,
          })
        )
      ).toContain("invalid_token");
    });
  }
);
