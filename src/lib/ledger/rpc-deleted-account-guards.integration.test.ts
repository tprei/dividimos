import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import type { Database } from "@/types/database";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createTestUsers,
  expectRpcError,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";

type RpcResult<T> = { data: T | null; error: { message: string } | null };

async function rpcErrorCode(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<string> {
  return expectRpcError(Promise.resolve(client.rpc(fn, args)));
}

async function insertRoom(room: {
  id: string;
  hostId: string;
  participantId: string;
  participantName: string;
  ordinal: number;
}): Promise<void> {
  await withPg(async (pg) => {
    await pg.query(
      "insert into public.assignment_rooms (id, host_user_id, group_target, header) values ($1, $2, $3::jsonb, $4::jsonb)",
      [room.id, room.hostId, JSON.stringify({ kind: "informal" }), JSON.stringify({ title: "Sala" })],
    );
    await pg.query(
      "insert into public.assignment_room_participants (room_id, id, ordinal, display_name, user_id) values ($1, $2, 0, $3, $4)",
      [room.id, room.participantId, room.participantName, room.hostId],
    );
    for (let i = 1; i < room.ordinal; i++) {
      await pg.query(
        "insert into public.assignment_room_participants (room_id, id, ordinal, display_name) values ($1, $2, $3, $4)",
        [room.id, crypto.randomUUID(), i, `Convidado ${i}`],
      );
    }
    await pg.query(
      "insert into public.assignment_room_items (room_id, id, ordinal, description, quantity_milliunits, unit_price_cents, total_price_cents) values ($1, $2, 0, 'Item', 1000, 1500, 1500)",
      [room.id, crypto.randomUUID()],
    );
  });
}

describe.skipIf(!isIntegrationTestReady)("deleted account guards", () => {
  let alice: TestUser;
  let deleted: TestUser;
  let service: SupabaseClient;

  beforeAll(async () => {
    if (!adminClient) throw new Error("service role key missing");
    service = adminClient;
    [alice, deleted] = await createTestUsers(2);
    await withPg(async (pg) => {
      const result = await pg.query(
        "update public.users set deleted_at = now() where id = $1 returning id",
        [deleted.id],
      );
      if (result.rowCount !== 1) throw new Error("failed to mark user deleted");
    });
  });

  it("blocks profile, onboarding, bootstrap, and group creation for a deleted identity", async () => {
    const authed = authenticateAs(deleted);

    await expect(
      rpcErrorCode(authed, "update_profile", { p_name: "Novo nome" }),
    ).resolves.toBe("account_deleted");

    await expect(
      rpcErrorCode(authed, "complete_onboarding", {
        p_handle: "deleted_handle",
        p_name: "Deleted",
        p_pix_key_type: "email",
        p_pix_key_encrypted: "Zm9v",
        p_pix_key_hint: "a@b.com",
      }),
    ).resolves.toBe("account_deleted");

    await expect(
      rpcErrorCode(authed, "bootstrap_overview", {}),
    ).resolves.toBe("account_deleted");

    await expect(
      rpcErrorCode(authed, "create_group", { p_name: "Grupo novo", p_member_ids: [] }),
    ).resolves.toBe("account_deleted");
  });

  it("does not change ordinary unauthenticated and membership denial codes", async () => {
    const anon = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const anonErase = (await anon.rpc("erase_chat_message", {
      p_message_id: crypto.randomUUID(),
    })) as RpcResult<unknown>;
    expect(anonErase.error?.message).toMatch(/permission denied/i);

    const anonGroup = (await anon.rpc("create_group", {
      p_name: "Grupo",
      p_member_ids: [],
    })) as RpcResult<unknown>;
    expect(anonGroup.error?.message).toMatch(/permission denied/i);

    await expect(
      rpcErrorCode(authenticateAs(alice), "get_group", { p_group_id: crypto.randomUUID() }),
    ).resolves.toBe("not_a_member");
  });

  it("rejects push registration after deletion and serializes a competing registration", async () => {
    await expect(
      rpcErrorCode(service, "claim_push_subscription", {
        p_user_id: deleted.id,
        p_channel: "web",
        p_endpoint_digest: Buffer.from(`digest-${crypto.randomUUID()}`),
        p_subscription_encrypted: "enc",
      }),
    ).resolves.toBe("account_deleted");

    const [racer] = await createTestUsers(1);
    const deleter = new Client({ connectionString: process.env.SUPABASE_DB_URL });
    const registrar = new Client({ connectionString: process.env.SUPABASE_DB_URL });
    await deleter.connect();
    await registrar.connect();
    try {
      await deleter.query("begin");
      await deleter.query("update public.users set deleted_at = now() where id = $1", [racer.id]);

      await registrar.query("set lock_timeout = '1s'");
      await expect(
        registrar.query("select public.claim_push_subscription($1, 'web', $2, 'enc')", [
          racer.id,
          Buffer.from(`digest-${crypto.randomUUID()}`),
        ]),
      ).rejects.toThrow(/lock timeout|canceling statement/);

      await deleter.query("commit");
      await expect(
        registrar.query("select public.claim_push_subscription($1, 'web', $2, 'enc')", [
          racer.id,
          Buffer.from(`digest-${crypto.randomUUID()}`),
        ]),
      ).rejects.toThrow(/account_deleted/);
    } finally {
      await registrar.end().catch(() => {});
      await deleter.end().catch(() => {});
    }
  });

  it("permits only the exact room tombstone transition for a deleted user", async () => {
    const activeRoom = crypto.randomUUID();
    const activeParticipant = crypto.randomUUID();
    await insertRoom({
      id: activeRoom,
      hostId: alice.id,
      participantId: activeParticipant,
      participantName: "Alice anfitriã",
      ordinal: 1,
    });

    await withPg(async (pg) => {
      await expect(
        pg.query(
          "update public.assignment_room_participants set display_name = 'Renomeado' where id = $1",
          [activeParticipant],
        ),
      ).rejects.toThrow(/invalid_operation/);
      await expect(
        pg.query(
          "update public.assignment_room_participants set removed_at = now() where id = $1",
          [activeParticipant],
        ),
      ).rejects.toThrow(/invalid_operation/);
      await expect(
        pg.query(
          "update public.assignment_room_participants set display_name = 'Conta excluída', removed_at = now() where id = $1",
          [activeParticipant],
        ),
      ).rejects.toThrow(/invalid_operation/);
    });

    const deletedRoom = crypto.randomUUID();
    const deletedParticipant = crypto.randomUUID();
    await insertRoom({
      id: deletedRoom,
      hostId: deleted.id,
      participantId: deletedParticipant,
      participantName: "Deleted host",
      ordinal: 1,
    });

    await withPg(async (pg) => {
      const result = await pg.query(
        "update public.assignment_room_participants set display_name = 'Conta excluída', removed_at = now() where id = $1 returning removed_at",
        [deletedParticipant],
      );
      expect(result.rowCount).toBe(1);
    });

    await withPg(async (pg) => {
      await expect(
        pg.query(
          "update public.assignment_room_participants set display_name = 'Outro nome' where id = $1",
          [deletedParticipant],
        ),
      ).rejects.toThrow(/invalid_operation/);
      await expect(
        pg.query(
          "update public.assignment_room_participants set user_id = $2 where id = $1",
          [deletedParticipant, alice.id],
        ),
      ).rejects.toThrow(/invalid_operation/);
      await expect(
        pg.query(
          "update public.assignment_room_items set description = 'Mudou' where room_id = $1",
          [deletedRoom],
        ),
      ).rejects.toThrow(/invalid_operation/);
      await expect(
        pg.query(
          "update public.assignment_rooms set header = '{\"title\":\"x\"}'::jsonb where id = $1",
          [deletedRoom],
        ),
      ).rejects.toThrow(/invalid_operation/);
    });
  });
});
