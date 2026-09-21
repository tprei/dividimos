import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import type { AssignmentRoomView } from "@/types/assignment-room";
import { buildAssignmentExpense } from "@/lib/assignment-room-money";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createTestUsers,
  expectRpcError,
  type TestUser,
} from "@/test/integration-helpers";


type Client = SupabaseClient<Database>;
type CreateArgs = Database["public"]["Functions"]["create_assignment_room"]["Args"];

type RoomView = AssignmentRoomView;

type Completion = {
  roomId: string;
  selfParticipantIndex: number | null;
  action: { kind: string; expenseId?: string; groupId?: string };
};

const HEADER = {
  title: "Conta de conclusão",
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

function roomArgs(host: TestUser, participants: Json[] = []): CreateArgs {
  return {
    p_room_id: crypto.randomUUID(),
    p_group_target: { kind: "new", name: HEADER.title },
    p_header: HEADER,
    p_items: ITEMS,
    p_participants: [
      { id: crypto.randomUUID(), displayName: host.name, userId: host.id },
      ...participants,
    ],
    p_join_token: joinToken("A"),
  };
}

async function rpc<T>(
  client: Client,
  name: keyof Database["public"]["Functions"],
  args: Record<string, unknown>,
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
  args: CreateArgs,
  token: string,
  displayName: string,
): Promise<RoomView> {
  return rpc<RoomView>(client, "join_assignment_room", {
    p_room_id: args.p_room_id,
    p_join_token: args.p_join_token,
    p_member_token: token,
    p_display_name: displayName,
  });
}

async function claimFullItem(
  client: Client,
  roomId: string,
  member: string | null,
  itemId: string,
  participantId: string,
  revision: number,
): Promise<RoomView> {
  return rpc<RoomView>(client, "set_assignment_room_claim", {
    p_room_id: roomId,
    p_member_token: member,
    p_item_id: itemId,
    p_participant_id: participantId,
    p_expected_item_revision: revision,
    p_ticks: 120_000,
  });
}

async function closeRoom(
  client: Client,
  roomId: string,
  revision: number,
): Promise<RoomView> {
  return rpc<RoomView>(client, "close_assignment_room", {
    p_room_id: roomId,
    p_expected_revision: revision,
  });
}

async function finalizeRoom(client: Client, view: RoomView) {
  const built = buildAssignmentExpense(
    view as unknown as Extract<AssignmentRoomView, { role: "host" }>,
    [{ participantIndex: 0, amountCents: 4_000 }],
  );
  if (!built.ok) throw new Error(JSON.stringify(built.issue));
  return rpc<{ room: RoomView }>(client, "finalize_assignment_room", {
    p_room_id: view.room.id,
    p_expected_revision: view.room.revision,
    p_payload: built.value,
  });
}

async function readCompletion(
  client: Client,
  roomId: string,
  member: string | null,
): Promise<Completion> {
  return rpc<Completion>(client, "get_assignment_room_completion", {
    p_room_id: roomId,
    p_member_token: member as string,
  });
}

describe.skipIf(!isIntegrationTestReady)("assignment room completion RPCs", () => {
  let host: TestUser;
  let guestClaimer: TestUser;
  let invited: TestUser;
  let hostClient: Client;
  let guestClaimerClient: Client;
  let invitedClient: Client;
  let anonClient: Client;

  beforeAll(() => {
    return createTestUsers(3).then(([createdHost, createdClaimer, createdInvited]) => {
      host = createdHost;
      guestClaimer = createdClaimer;
      invited = createdInvited;
      hostClient = authenticateAs(host);
      guestClaimerClient = authenticateAs(guestClaimer);
      invitedClient = authenticateAs(invited);
      anonClient = createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
    });
  });

  it("returns the right action and bridges an anonymous guest claim", async () => {
    const args = roomArgs(host);
    const created = await createRoom(hostClient, args);
    const guestToken = memberToken("B");
    const joined = await joinRoom(anonClient, args, guestToken, "Convidado");
    let current = await claimFullItem(
      hostClient,
      args.p_room_id,
      null,
      created.room.items[0].id,
      created.room.selfParticipantId,
      created.room.items[0].revision,
    );
    current = await closeRoom(hostClient, args.p_room_id, current.room.revision);
    await finalizeRoom(hostClient, current);
    const hostCompletion = await readCompletion(hostClient, args.p_room_id, null);
    expect(hostCompletion).toMatchObject({
      roomId: args.p_room_id,
      selfParticipantIndex: 0,
      action: { kind: "view_expense", expenseId: expect.any(String), groupId: expect.any(String) },
    });

    const anonymousCompletion = await readCompletion(anonClient, args.p_room_id, guestToken);
    expect(anonymousCompletion).toMatchObject({
      selfParticipantIndex: 1,
      action: { kind: "sign_in" },
    });

    const authenticatedGuestCompletion = await readCompletion(
      guestClaimerClient,
      args.p_room_id,
      guestToken,
    );
    expect(authenticatedGuestCompletion).toMatchObject({
      selfParticipantIndex: 1,
      action: { kind: "claim_guest" },
    });

    const ack = await rpc<{ groupId: string }>(guestClaimerClient, "claim_assignment_room_guest", {
      p_room_id: args.p_room_id,
      p_member_token: guestToken,
    });
    expect(ack.groupId).toBe(hostCompletion.action.groupId);

    const afterClaim = await readCompletion(guestClaimerClient, args.p_room_id, guestToken);
    expect(afterClaim.action).toMatchObject({
      kind: "view_expense",
      expenseId: hostCompletion.action.expenseId,
      groupId: hostCompletion.action.groupId,
    });
    expect(joined.room.selfParticipantId).toBeTruthy();
  });

  it("returns accept_invitation for an account participant", async () => {
    const participantId = crypto.randomUUID();
    const args = roomArgs(host, [
      { id: participantId, displayName: invited.name, userId: invited.id },
    ]);
    const created = await createRoom(hostClient, args);
    const invitedToken = memberToken("C");
    const joined = await joinRoom(invitedClient, args, invitedToken, "ignored");
    const claimed = await claimFullItem(
      hostClient,
      args.p_room_id,
      null,
      created.room.items[0].id,
      created.room.selfParticipantId,
      created.room.items[0].revision,
    );
    const closed = await closeRoom(hostClient, args.p_room_id, claimed.room.revision);
    await finalizeRoom(hostClient, closed);

    const completion = await readCompletion(invitedClient, args.p_room_id, invitedToken);
    expect(completion).toMatchObject({
      selfParticipantIndex: 1,
      action: {
        kind: "accept_invitation",
        expenseId: expect.any(String),
        groupId: expect.any(String),
      },
    });
    expect(joined.room.selfParticipantId).toBe(participantId);
  });

  it("denies incomplete rooms and non-guest claim attempts", async () => {
    const args = roomArgs(host);
    const created = await createRoom(hostClient, args);
    expect(
      await expectRpcError(
        hostClient.rpc("get_assignment_room_completion", {
          p_room_id: args.p_room_id,
          p_member_token: null as unknown as string,
        }),
      ),
    ).toContain("room_incomplete");
    expect(
      await expectRpcError(
        hostClient.rpc("claim_assignment_room_guest", {
          p_room_id: args.p_room_id,
          p_member_token: memberToken("D"),
        }),
      ),
    ).toContain("room_incomplete");
    expect(
      await expectRpcError(
        anonClient.rpc("claim_assignment_room_guest", {
          p_room_id: args.p_room_id,
          p_member_token: memberToken("E"),
        }),
      ),
    ).toContain("permission denied");
    expect(created.room.status).toBe("open");
  });
});
