import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createTestUsers,
  expectRpcError,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";
import { assertLedgerInvariantsAfterEach } from "@/test/ledger-invariants";

assertLedgerInvariantsAfterEach();

type Client = SupabaseClient<Database>;

interface RoomView {
  role: "host" | "participant";
  room: {
    id: string;
    selfParticipantId: string;
    participants: Array<{
      id: string;
      displayName: string;
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

function token(prefix: "armj1" | "armm1" | "armr1"): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

function roomCode(): string {
  const word = () =>
    Array.from(randomBytes(8), (byte) =>
      String.fromCharCode(97 + (byte % 26))
    ).join("");
  return `${word()}-${word()}`;
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

describe.skipIf(!isIntegrationTestReady)("assignment room codes", () => {
  let host: TestUser;
  let outsider: TestUser;
  let hostClient: Client;
  let outsiderClient: Client;
  let anonClient: Client;
  let serviceClient: Client;

  beforeAll(async () => {
    [host, outsider] = await createTestUsers(2);
    hostClient = authenticateAs(host);
    outsiderClient = authenticateAs(outsider);
    anonClient = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    serviceClient = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
  });

  async function createRoom(): Promise<string> {
    const roomId = crypto.randomUUID();
    await rpc(hostClient, "create_assignment_room", {
      p_room_id: roomId,
      p_group_target: { kind: "new", name: "Conta compartilhada" },
      p_header: HEADER,
      p_items: ITEMS,
      p_participants: [
        { id: crypto.randomUUID(), displayName: host.name, userId: host.id },
      ],
      p_join_token: token("armj1"),
    });
    return roomId;
  }

  async function issue(roomId: string, code: string): Promise<{ expiresInSeconds: number }> {
    return rpc(hostClient, "issue_assignment_room_code", {
      p_room_id: roomId,
      p_code: code,
    });
  }

  async function resolve(code: string, grant: string): Promise<{ roomId: string }> {
    return rpc(serviceClient, "resolve_assignment_room_code", {
      p_code: code,
      p_grant_token: grant,
    });
  }

  async function revision(roomId: string): Promise<number> {
    return withPg(async (db) => {
      const result = await db.query<{ revision: number }>(
        "select revision::int from public.assignment_rooms where id = $1",
        [roomId]
      );
      return result.rows[0].revision;
    });
  }

  async function join(
    client: Client,
    roomId: string,
    joinToken: string,
    displayName: string
  ): Promise<RoomView> {
    return rpc(client, "join_assignment_room", {
      p_room_id: roomId,
      p_join_token: joinToken,
      p_member_token: token("armm1"),
      p_display_name: displayName,
    });
  }

  it("issues a code only for the host with a canonical code", async () => {
    const roomId = await createRoom();

    const issued = await issue(roomId, roomCode());

    expect(issued).toEqual({ expiresInSeconds: 900 });
    const storedSeconds = await withPg(async (db) => {
      const result = await db.query<{ seconds: number }>(
        "select extract(epoch from expires_at - now())::int as seconds " +
          "from guest_credentials.assignment_room_codes where room_id = $1",
        [roomId]
      );
      return result.rows[0].seconds;
    });
    expect(storedSeconds).toBeGreaterThan(890);
    expect(storedSeconds).toBeLessThanOrEqual(900);
    await expect(
      rpc(outsiderClient, "issue_assignment_room_code", {
        p_room_id: roomId,
        p_code: roomCode(),
      })
    ).rejects.toThrow("room_host_required");
    await expectRpcError(
      anonClient.rpc("issue_assignment_room_code", {
        p_room_id: roomId,
        p_code: roomCode(),
      })
    );
    await expect(issue(roomId, "Pipoca-moleza")).rejects.toThrow(
      "invalid_argument"
    );
  });

  it("replaces the previous code when the host issues again", async () => {
    const roomId = await createRoom();
    const first = roomCode();
    const second = roomCode();
    await issue(roomId, first);
    await issue(roomId, second);

    await expect(resolve(first, token("armr1"))).rejects.toThrow(
      "invalid_room_code"
    );
    await expect(resolve(second, token("armr1"))).resolves.toEqual({ roomId });
  });

  it("refuses a code active in another room until it expires", async () => {
    const roomA = await createRoom();
    const roomB = await createRoom();
    const code = roomCode();
    await issue(roomA, code);

    await expect(issue(roomB, code)).rejects.toThrow("room_code_taken");

    await withPg((db) =>
      db.query(
        "update guest_credentials.assignment_room_codes " +
          "set expires_at = now() - interval '1 minute' where room_id = $1",
        [roomA]
      )
    );
    await issue(roomB, code);
    await expect(resolve(code, token("armr1"))).resolves.toEqual({
      roomId: roomB,
    });
  });

  it("resolves only live codes and only for the service role", async () => {
    const roomId = await createRoom();
    const code = roomCode();
    await issue(roomId, code);

    await expect(resolve(code, token("armr1"))).resolves.toEqual({ roomId });
    await expect(resolve(roomCode(), token("armr1"))).rejects.toThrow(
      "invalid_room_code"
    );
    const resolveArgs = { p_code: code, p_grant_token: token("armr1") };
    await expectRpcError(
      anonClient.rpc("resolve_assignment_room_code", resolveArgs)
    );
    await expectRpcError(
      hostClient.rpc("resolve_assignment_room_code", resolveArgs)
    );

    await rpc(hostClient, "rotate_assignment_room_join", {
      p_room_id: roomId,
      p_join_token: token("armj1"),
    });
    await expect(resolve(code, token("armr1"))).rejects.toThrow(
      "invalid_room_code"
    );

    const expiring = roomCode();
    await issue(roomId, expiring);
    await withPg((db) =>
      db.query(
        "update guest_credentials.assignment_room_codes " +
          "set expires_at = now() - interval '1 second' where room_id = $1",
        [roomId]
      )
    );
    await expect(resolve(expiring, token("armr1"))).rejects.toThrow(
      "invalid_room_code"
    );
  });

  it("admits an anonymous guest once per grant", async () => {
    const roomId = await createRoom();
    const code = roomCode();
    await issue(roomId, code);
    const grant = token("armr1");
    await resolve(code, grant);

    const view = await join(anonClient, roomId, grant, "Ana");

    expect(view.role).toBe("participant");
    expect(view.room.participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: view.room.selfParticipantId,
          displayName: "Ana",
          removed: false,
        }),
      ])
    );
    await expect(join(anonClient, roomId, grant, "Bia")).rejects.toThrow(
      "invalid_token"
    );
  });

  it("keeps the grant when admission fails", async () => {
    const roomId = await createRoom();
    const code = roomCode();
    await issue(roomId, code);
    const grant = token("armr1");
    await resolve(code, grant);

    await expect(join(anonClient, roomId, grant, "  ")).rejects.toThrow(
      "invalid_argument"
    );
    const view = await join(anonClient, roomId, grant, "Caio");
    expect(view.role).toBe("participant");
  });

  it("rejects grants for another room, after expiry, or after a link rotation", async () => {
    const roomA = await createRoom();
    const roomB = await createRoom();
    const code = roomCode();
    await issue(roomA, code);

    const wrongRoom = token("armr1");
    await resolve(code, wrongRoom);
    await expect(join(anonClient, roomB, wrongRoom, "Duda")).rejects.toThrow(
      "invalid_token"
    );

    const expired = token("armr1");
    await resolve(code, expired);
    await withPg((db) =>
      db.query(
        "update guest_credentials.assignment_room_code_grants " +
          "set expires_at = now() - interval '1 second' " +
          "where grant_digest = extensions.digest(convert_to($1, 'UTF8'), 'sha256')",
        [expired]
      )
    );
    await expect(join(anonClient, roomA, expired, "Edu")).rejects.toThrow(
      "invalid_token"
    );

    const rotated = token("armr1");
    await resolve(code, rotated);
    await rpc(hostClient, "rotate_assignment_room_join", {
      p_room_id: roomA,
      p_join_token: token("armj1"),
    });
    await expect(join(anonClient, roomA, rotated, "Fê")).rejects.toThrow(
      "invalid_token"
    );
  });

  it("kills the code and pending grants when the host removes someone or cancels", async () => {
    const roomId = await createRoom();
    const code = roomCode();
    await issue(roomId, code);
    const admitted = token("armr1");
    await resolve(code, admitted);
    const guest = await join(anonClient, roomId, admitted, "Gabi");
    const pending = token("armr1");
    await resolve(code, pending);

    await rpc(hostClient, "remove_assignment_room_participant", {
      p_room_id: roomId,
      p_participant_id: guest.room.selfParticipantId,
      p_expected_revision: await revision(roomId),
      p_join_token: token("armj1"),
    });

    await expect(resolve(code, token("armr1"))).rejects.toThrow(
      "invalid_room_code"
    );
    await expect(join(anonClient, roomId, pending, "Hugo")).rejects.toThrow(
      "invalid_token"
    );

    const cancelledRoom = await createRoom();
    const cancelledCode = roomCode();
    await issue(cancelledRoom, cancelledCode);
    const beforeCancel = token("armr1");
    await resolve(cancelledCode, beforeCancel);
    await rpc(hostClient, "cancel_assignment_room", {
      p_room_id: cancelledRoom,
      p_expected_revision: await revision(cancelledRoom),
    });

    await expect(resolve(cancelledCode, token("armr1"))).rejects.toThrow(
      "invalid_room_code"
    );
    await expect(
      join(anonClient, cancelledRoom, beforeCancel, "Iara")
    ).rejects.toThrow("invalid_token");
  });
});
