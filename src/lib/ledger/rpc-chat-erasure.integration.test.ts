import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createGroupWithMembers,
  createTestUsers,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";

interface ChatMessage {
  id: string;
  clientId: string;
  groupId: string;
  senderId: string;
  content: string | null;
  erased: boolean;
  createdAt: string;
}

type RpcResult<T> = { data: T | null; error: { message: string } | null };

async function rpcOk<T>(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = (await client.rpc(fn, args)) as RpcResult<T>;
  if (error) {
    throw new Error(`${fn} failed: ${error.message}`);
  }
  return data as T;
}

async function send(
  user: TestUser,
  groupId: string,
  content: string,
): Promise<ChatMessage> {
  return rpcOk<ChatMessage>(authenticateAs(user), "send_message", {
    p_client_id: crypto.randomUUID(),
    p_group_id: groupId,
    p_content: content,
  });
}

describe.skipIf(!isIntegrationTestReady)("chat erasure schema", () => {
  let alice: TestUser;
  let bob: TestUser;
  let groupId: string;
  let first: ChatMessage;
  let boundary: ChatMessage;

  beforeAll(async () => {
    [alice, bob] = await createTestUsers(2);
    groupId = await createGroupWithMembers(alice, [bob], "Grupo apagados");
    first = await send(alice, groupId, "primeira mensagem");
    boundary = await send(bob, groupId, "borda");
  });

  it("rejects every invalid content and erasure combination", async () => {
    const assertRejected = async (sql: string) => {
      await expect(
        withPg(async (pg) => {
          await pg.query(sql, [first.id]);
        }),
      ).rejects.toThrow(/chat_messages_erasure_valid/);
    };

    await assertRejected(
      "update chat_messages set content = null where id = $1",
    );
    await assertRejected(
      "update chat_messages set erased_at = now() where id = $1",
    );
    await assertRejected(
      "update chat_messages set content = '' where id = $1",
    );
    await assertRejected(
      "update chat_messages set content = repeat('a', 2001) where id = $1",
    );

    await withPg(async (pg) => {
      await pg.query("update chat_messages set content = 'válido' where id = $1", [
        first.id,
      ]);
    });

    await withPg(async (pg) => {
      await pg.query(
        "update chat_messages set content = repeat('a', 2000) where id = $1",
        [boundary.id],
      );
      await pg.query(
        "update chat_messages set content = null, erased_at = now() where id = $1",
        [boundary.id],
      );
    });
    const row = await withPg(async (pg) => {
      const result = await pg.query<{ content: string | null; erased_at: string | null }>(
        "select content, erased_at from chat_messages where id = $1",
        [boundary.id],
      );
      return result.rows[0];
    });
    expect(row?.content).toBeNull();
    expect(row?.erased_at).not.toBeNull();
  });
});
