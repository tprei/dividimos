import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { AssignmentRoomView } from "@/types/assignment-room";
import { decodeAssignmentRoomView } from "@/lib/ledger/decode-assignment-room";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createGroup,
  createGroupWithMembers,
  createTestUser,
  createTestUsers,
  decodeRpcData,
  expectRpcError,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";
import { assertLedgerInvariantsAfterEach } from "@/test/ledger-invariants";

assertLedgerInvariantsAfterEach();

type Client = SupabaseClient<Database>;
type CreateArgs =
  Database["public"]["Functions"]["create_assignment_room"]["Args"];
type JoinArgs = Database["public"]["Functions"]["join_assignment_room"]["Args"];
type EnterArgs =
  Database["public"]["Functions"]["enter_group_assignment_room"]["Args"];

interface RoomRows {
  rooms: number;
  items: number;
  participants: number;
  access: number;
  members: number;
  revision: number;
}

const HEADER = {
  title: "Conta compartilhada",
  occurredOn: "2026-10-05",
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

function memberToken(): string {
  const random = crypto.randomUUID().replaceAll("-", "") + "AAAAAAAAAAA";
  return `armm1_${random}`;
}

function createArgs(
  host: TestUser,
  overrides: Partial<CreateArgs> = {},
): CreateArgs {
  return {
    p_room_id: crypto.randomUUID(),
    p_group_target: { kind: "new", name: "Chope de sexta" },
    p_header: HEADER,
    p_items: ITEMS,
    p_participants: [
      { id: crypto.randomUUID(), displayName: host.name, userId: host.id },
    ],
    p_join_token: joinToken("A"),
    ...overrides,
  };
}

async function createRoom(
  client: Client,
  args: CreateArgs,
): Promise<AssignmentRoomView> {
  const { data, error } = await client.rpc("create_assignment_room", args);
  if (error) throw new Error(error.message);
  return decodeRpcData(
    "create_assignment_room",
    data,
    decodeAssignmentRoomView,
  );
}

async function joinRoom(
  client: Client,
  args: JoinArgs,
): Promise<AssignmentRoomView> {
  const { data, error } = await client.rpc("join_assignment_room", args);
  if (error) throw new Error(error.message);
  return decodeRpcData("join_assignment_room", data, decodeAssignmentRoomView);
}

async function enterRoom(
  client: Client,
  args: EnterArgs,
): Promise<AssignmentRoomView> {
  const { data, error } = await client.rpc("enter_group_assignment_room", args);
  if (error) throw new Error(error.message);
  return decodeRpcData(
    "enter_group_assignment_room",
    data,
    decodeAssignmentRoomView,
  );
}

async function roomRows(roomId: string): Promise<RoomRows> {
  return withPg(async (pg) => {
    const { rows } = await pg.query<RoomRows>(
      `select
         (select count(*) from public.assignment_rooms where id = $1)::int as rooms,
         (select count(*) from public.assignment_room_items where room_id = $1)::int as items,
         (select count(*) from public.assignment_room_participants where room_id = $1)::int as participants,
         (select count(*) from guest_credentials.assignment_room_access where room_id = $1)::int as access,
         (select count(*) from guest_credentials.assignment_room_members where room_id = $1)::int as members,
         coalesce((select revision from public.assignment_rooms where id = $1), 0)::int as revision`,
      [roomId],
    );
    return rows[0];
  });
}

const EMPTY_ROOM: RoomRows = {
  rooms: 0,
  items: 0,
  participants: 0,
  access: 0,
  members: 0,
  revision: 0,
};

describe.skipIf(!isIntegrationTestReady)("assignment room moderation", () => {
  let host: TestUser;
  let hostClient: Client;
  let anonClient: Client;

  beforeAll(async () => {
    [host] = await createTestUsers(1);
    hostClient = authenticateAs(host);
    anonClient = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  });

  it("rejects a decomposed-accent new group name and writes no room rows", async () => {
    const args = createArgs(host, {
      p_group_target: { kind: "new", name: "Turma mongolo\u0301ide" },
      p_join_token: joinToken("B"),
    });
    expect(
      await expectRpcError(hostClient.rpc("create_assignment_room", args)),
    ).toContain("objectionable_content");
    expect(await roomRows(args.p_room_id)).toEqual(EMPTY_ROOM);
  });

  it("persists an allowed Viaduto target, returns it exactly, and keeps guest labels out of scope", async () => {
    const args = createArgs(host, {
      p_group_target: { kind: "new", name: "Viaduto" },
      p_join_token: joinToken("C"),
    });
    const created = await createRoom(hostClient, args);
    expect(created.role).toBe("host");
    if (created.role !== "host") throw new Error("expected a host view");
    expect(created.groupTarget).toEqual({ kind: "new", name: "Viaduto" });
    expect(created.room.id).toBe(args.p_room_id);
    expect(created.room.title).toBe(HEADER.title);
    expect(created.room.items).toHaveLength(ITEMS.length);
    expect(created.room.participants).toEqual([
      expect.objectContaining({
        displayName: host.name,
        isGuest: false,
        removed: false,
        ordinal: 0,
      }),
    ]);

    const guest = await joinRoom(anonClient, {
      p_room_id: args.p_room_id,
      p_join_token: args.p_join_token,
      p_member_token: memberToken(),
      p_display_name: "Convidada",
    });
    expect(guest.room.participants.find(
      (participant) => participant.id === guest.room.selfParticipantId,
    )).toMatchObject({ displayName: "Convidada", isGuest: true, removed: false });

    const labeled = await joinRoom(anonClient, {
      p_room_id: args.p_room_id,
      p_join_token: args.p_join_token,
      p_member_token: memberToken(),
      p_display_name: "VIADÃO",
    });
    expect(labeled.room.participants.find(
      (participant) => participant.id === labeled.room.selfParticipantId,
    )).toMatchObject({ displayName: "VIADÃO", isGuest: true });
  });

  it("refuses an objectionable legacy profile as host or preselected participant of a new room", async () => {
    const slurHost = await createTestUser({ name: "Mongolóide" });
    const slurGuest = await createTestUser({ name: "Baitola" });
    const hostArgs = createArgs(slurHost, { p_join_token: joinToken("D") });
    expect(
      await expectRpcError(
        authenticateAs(slurHost).rpc("create_assignment_room", hostArgs),
      ),
    ).toContain("objectionable_content");
    expect(await roomRows(hostArgs.p_room_id)).toEqual(EMPTY_ROOM);

    const preselectedArgs = createArgs(host, {
      p_join_token: joinToken("E"),
      p_participants: [
        { id: crypto.randomUUID(), displayName: host.name, userId: host.id },
        {
          id: crypto.randomUUID(),
          displayName: slurGuest.name,
          userId: slurGuest.id,
        },
      ],
    });
    expect(
      await expectRpcError(
        hostClient.rpc("create_assignment_room", preselectedArgs),
      ),
    ).toContain("objectionable_content");
    expect(await roomRows(preselectedArgs.p_room_id)).toEqual(EMPTY_ROOM);
  });

  it.each([true, false] as const)(
    "refuses a new account join with an objectionable profile name while onboarded is %p, then admits the corrected identity",
    async (onboarded) => {
      const args = createArgs(host, {
        p_join_token: joinToken(onboarded ? "F" : "G"),
      });
      await createRoom(hostClient, args);
      const joiner = await createTestUser({ name: "Boiola", onboarded });
      const before = await roomRows(args.p_room_id);

      expect(
        await expectRpcError(
          authenticateAs(joiner).rpc("join_assignment_room", {
            p_room_id: args.p_room_id,
            p_join_token: args.p_join_token,
            p_member_token: memberToken(),
            p_display_name: "",
          }),
        ),
      ).toContain("objectionable_content");
      expect(await roomRows(args.p_room_id)).toEqual(before);

      const client = authenticateAs(joiner);
      if (onboarded) {
        const renamed = await client.rpc("update_profile", {
          p_name: "Ana Ok",
        });
        expect(renamed.error).toBeNull();
      } else {
        const p_handle = `ok_${joiner.id.replace(/-/g, "").slice(0, 20)}`;
        const corrected = await client.rpc("update_profile", {
          p_name: "Ana Ok",
          p_handle,
        });
        expect(corrected.error).toBeNull();
      }

      const joined = await joinRoom(client, {
        p_room_id: args.p_room_id,
        p_join_token: args.p_join_token,
        p_member_token: memberToken(),
        p_display_name: "",
      });
      expect(joined.role).toBe("participant");
      expect(joined.room.participants.find(
        (participant) => participant.id === joined.room.selfParticipantId,
      )).toMatchObject({
        displayName: "Ana Ok",
        isGuest: false,
        removed: false,
      });
    },
  );

  it("reports invalid_token before the name filter and not_a_member before participant text", async () => {
    const tokenRoom = createArgs(host, { p_join_token: joinToken("K") });
    await createRoom(hostClient, tokenRoom);
    const slurJoiner = await createTestUser({ name: "Boiola" });
    expect(
      await expectRpcError(
        authenticateAs(slurJoiner).rpc("join_assignment_room", {
          p_room_id: tokenRoom.p_room_id,
          p_join_token: joinToken("Z"),
          p_member_token: memberToken(),
          p_display_name: "",
        }),
      ),
    ).toContain("invalid_token");

    const [intruder] = await createTestUsers(1);
    const namedGuest = await createTestUser({ name: "Traveco" });
    const groupId = (await createGroup(host, "Grupo alheio")).groupId;
    const intruderArgs: CreateArgs = {
      ...createArgs(intruder, {
        p_group_target: { kind: "existing", groupId },
        p_join_token: joinToken("H"),
      }),
      p_participants: [
        {
          id: crypto.randomUUID(),
          displayName: intruder.name,
          userId: intruder.id,
        },
        {
          id: crypto.randomUUID(),
          displayName: namedGuest.name,
          userId: namedGuest.id,
        },
      ],
    };
    expect(
      await expectRpcError(
        authenticateAs(intruder).rpc("create_assignment_room", intruderArgs),
      ),
    ).toContain("not_a_member");
    expect(await roomRows(intruderArgs.p_room_id)).toEqual(EMPTY_ROOM);
  });

  it("refuses a host whose stored handle is objectionable before the room exists", async () => {
    const handleHost = await createTestUser({
      name: "Ana Ok",
      handle: `mongoloide_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
    });
    const args = createArgs(handleHost, { p_join_token: joinToken("L") });
    expect(
      await expectRpcError(
        authenticateAs(handleHost).rpc("create_assignment_room", args),
      ),
    ).toContain("objectionable_content");
    expect(await roomRows(args.p_room_id)).toEqual(EMPTY_ROOM);
  });

  it("refuses a group member entering with an objectionable legacy profile name until update_profile corrects it", async () => {
    const [member] = await createTestUsers(1);
    const stranger = await createTestUser({ name: "Baitola" });
    const groupId = await createGroupWithMembers(host, [member], "Grupo da sala");
    const args = createArgs(host, {
      p_group_target: { kind: "existing", groupId },
      p_join_token: joinToken("J"),
    });
    await createRoom(hostClient, args);
    await withPg(async (pg) => {
      await pg.query("update public.users set name = 'Boiola' where id = $1", [
        member.id,
      ]);
    });
    const before = await roomRows(args.p_room_id);

    expect(
      await expectRpcError(
        authenticateAs(member).rpc("enter_group_assignment_room", {
          p_room_id: args.p_room_id,
          p_member_token: memberToken(),
        }),
      ),
    ).toContain("objectionable_content");
    expect(await roomRows(args.p_room_id)).toEqual(before);

    const client = authenticateAs(member);
    const corrected = await client.rpc("update_profile", { p_name: "Ana Ok" });
    expect(corrected.error).toBeNull();

    const entered = await enterRoom(client, {
      p_room_id: args.p_room_id,
      p_member_token: memberToken(),
    });
    expect(entered.role).toBe("participant");
    expect(entered.room.participants.find(
      (participant) => participant.id === entered.room.selfParticipantId,
    )).toMatchObject({ displayName: "Ana Ok", isGuest: false, removed: false });
    expect(await roomRows(args.p_room_id)).toEqual({
      ...before,
      participants: before.participants + 1,
      members: before.members + 1,
      revision: before.revision + 1,
    });

    expect(
      await expectRpcError(
        authenticateAs(stranger).rpc("enter_group_assignment_room", {
          p_room_id: args.p_room_id,
          p_member_token: memberToken(),
        }),
      ),
    ).toContain("not_a_member");
  });

  it("replays a legacy room with objectionable stored names without recreating anything", async () => {
    const args = createArgs(host, { p_join_token: joinToken("I") });
    const created = await createRoom(hostClient, args);
    const legacyName = "mongoloide antigo";
    await withPg(async (pg) => {
      await pg.query("begin");
      await pg.query("set local session_replication_role = replica");
      await pg.query(
        "update public.assignment_rooms set group_target = jsonb_build_object('kind', 'new', 'name', $2::text) where id = $1",
        [args.p_room_id, legacyName],
      );
      await pg.query("commit");
    });

    const replayed = await createRoom(hostClient, {
      ...args,
      p_group_target: { kind: "new", name: legacyName },
    });
    expect(replayed.room.id).toBe(created.room.id);
    expect(replayed.room.revision).toBe(created.room.revision);
    if (replayed.role !== "host") throw new Error("expected a host view");
    expect(replayed.groupTarget).toEqual({ kind: "new", name: legacyName });
    expect(replayed.room.items).toHaveLength(ITEMS.length);
    expect(replayed.room.participants).toHaveLength(1);
    expect(await roomRows(args.p_room_id)).toEqual({
      rooms: 1,
      items: ITEMS.length,
      participants: 1,
      access: 1,
      members: 0,
      revision: created.room.revision,
    });
  });
});
