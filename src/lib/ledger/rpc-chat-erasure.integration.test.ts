import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createGroupWithMembers,
  createTestUsers,
  expectRpcError,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";

interface UserProfile {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string | null;
  isBot: boolean;
}

interface ChatMessage {
  id: string;
  clientId: string;
  groupId: string;
  senderId: string;
  content: string | null;
  erased: boolean;
  createdAt: string;
  sender: UserProfile;
}

interface ConversationEnvelope {
  messages: ChatMessage[];
  messageCursor: { createdAt: string; id: string } | null;
  messagesComplete: boolean;
  readWatermark: { lastReadAt: string; lastReadMessageId: string } | null;
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

describe.skipIf(!isIntegrationTestReady)("chat erasure", () => {
  let alice: TestUser;
  let bob: TestUser;
  let outsider: TestUser;
  let groupId: string;
  let first: ChatMessage;
  let second: ChatMessage;
  let anonClient: SupabaseClient<Database>;
  let service: SupabaseClient;

  beforeAll(async () => {
    if (!adminClient) throw new Error("service role key missing");
    service = adminClient;
    [alice, bob, outsider] = await createTestUsers(3);
    groupId = await createGroupWithMembers(alice, [bob], "Grupo apagados");
    first = await send(alice, groupId, "primeira mensagem");
    second = await send(bob, groupId, "segunda mensagem");
    const { error } = await authenticateAs(bob).rpc("mark_read", {
      p_group_id: groupId,
      p_last_read_message_id: first.id,
    });
    if (error) throw new Error(`mark_read failed: ${error.message}`);
    anonClient = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  });

  it("erases text without changing message identity, order, or read watermark", async () => {
    const before = await rpcOk<ConversationEnvelope>(
      authenticateAs(alice),
      "get_conversation",
      { p_group_id: groupId, p_limit: 1 },
    );
    expect(before.messageCursor).not.toBeNull();

    const erased = await rpcOk<ChatMessage>(service, "erase_chat_message", {
      p_message_id: first.id,
    });

    expect(erased.id).toBe(first.id);
    expect(erased.clientId).toBe(first.clientId);
    expect(erased.createdAt).toBe(first.createdAt);
    expect(erased.content).toBeNull();
    expect(erased.erased).toBe(true);
    expect(erased.senderId).toBe(alice.id);
    expect(erased.sender).toMatchObject({ id: alice.id });

    const after = await rpcOk<ConversationEnvelope>(
      authenticateAs(alice),
      "get_conversation",
      { p_group_id: groupId, p_limit: 1 },
    );

    expect(after.messages).toHaveLength(1);
    expect(after.messages[0]?.id).toBe(second.id);
    expect(after.messageCursor).toEqual(before.messageCursor);
    expect(after.messagesComplete).toBe(before.messagesComplete);
    expect(after.readWatermark).toEqual(before.readWatermark);
  });

  it("keeps the original erased_at when erasing twice", async () => {
    const firstAt = await withPg(async (pg) => {
      const result = await pg.query<{ erased_at: Date }>(
        "select erased_at from chat_messages where id = $1",
        [first.id],
      );
      return result.rows[0]?.erased_at;
    });
    expect(firstAt).not.toBeNull();

    await rpcOk<ChatMessage>(service, "erase_chat_message", { p_message_id: first.id });

    const secondAt = await withPg(async (pg) => {
      const result = await pg.query<{ erased_at: Date }>(
        "select erased_at from chat_messages where id = $1",
        [first.id],
      );
      return result.rows[0]?.erased_at;
    });
    expect(secondAt?.getTime()).toBe(firstAt?.getTime());
  });

  it("broadcasts the erasure on the chat and group topics", async () => {
    const [host, guest] = await createTestUsers(2);
    const room = await createGroupWithMembers(host, [guest], "Grupo broadcast");
    const target = await send(host, room, "para o broadcast");
    await rpcOk<ChatMessage>(service, "erase_chat_message", { p_message_id: target.id });

    const topics = await withPg(async (pg) => {
      const result = await pg.query<{ topic: string; event: string; payload: Record<string, unknown> }>(
        "select topic, event, payload from realtime.messages where topic in ($1, $2) and updated_at > now() - interval '1 minute' order by updated_at desc",
        [`chat:${room}`, `group:${room}`],
      );
      return result.rows;
    });

    const chatBroadcast = topics.find((row) => row.topic === `chat:${room}` && row.event === "message");
    expect(chatBroadcast?.payload).toMatchObject({ id: target.id, erased: true, content: null });
    const activity = topics.find((row) => row.topic === `group:${room}` && row.event === "chat_activity");
    expect(activity?.payload).toMatchObject({ group_id: room });
  });

  it("returns erasure in history, duplicate send acknowledgement, and last preview", async () => {
    await rpcOk<ChatMessage>(service, "erase_chat_message", {
      p_message_id: second.id,
    });

    const snapshot = await rpcOk<{
      lastMessage: {
        content: string | null;
        erased: boolean;
        senderId: string;
        createdAt: string;
      } | null;
    }>(authenticateAs(alice), "get_group", { p_group_id: groupId });
    expect(snapshot.lastMessage?.content).toBeNull();
    expect(snapshot.lastMessage?.erased).toBe(true);
    expect(snapshot.lastMessage?.senderId).toBe(bob.id);

    const retry = await rpcOk<ChatMessage>(authenticateAs(bob), "send_message", {
      p_client_id: second.clientId,
      p_group_id: groupId,
      p_content: "segunda mensagem",
    });
    expect(retry.id).toBe(second.id);
    expect(retry.erased).toBe(true);
    expect(retry.content).toBeNull();

    const history = await rpcOk<ConversationEnvelope>(
      authenticateAs(bob),
      "get_conversation",
      { p_group_id: groupId, p_limit: 50 },
    );
    expect(history.messages.find((m) => m.id === second.id)?.erased).toBe(true);

    const code = await expectRpcError(
      authenticateAs(outsider).rpc("get_conversation", {
        p_group_id: groupId,
        p_limit: 50,
      }),
    );
    expect(code).toBe("not_a_member");
  });

  it("denies browser roles and rejects an unknown message", async () => {
    const anonError = (await anonClient.rpc("erase_chat_message", {
      p_message_id: first.id,
    })) as RpcResult<unknown>;
    expect(anonError.error?.message).toMatch(/permission denied/i);

    const authError = (await authenticateAs(alice).rpc("erase_chat_message", {
      p_message_id: first.id,
    })) as RpcResult<unknown>;
    expect(authError.error?.message).toMatch(/permission denied/i);

    const unknown = await expectRpcError(
      service.rpc("erase_chat_message", {
        p_message_id: crypto.randomUUID(),
      }),
    );
    expect(unknown).toBe("invalid_argument");

    const nullId = await expectRpcError(
      service.rpc("erase_chat_message", { p_message_id: null }),
    );
    expect(nullId).toBe("invalid_argument");
  });

  it("rejects every invalid content and erasure combination", async () => {
    await withPg(async (pg) => {
      await pg.query(
        "update chat_messages set content = 'base', erased_at = null where id = $1",
        [first.id],
      );
    });

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

    const boundary = await send(bob, groupId, "borda");
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
