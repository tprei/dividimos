import { beforeAll, describe, expect, it } from "vitest";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";
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
}

interface EraseResult {
  userId: string;
  deletedAt: string | null;
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

interface FanoutRow {
  topic: string;
  payload: Record<string, unknown>;
}

async function fanoutRows(messageId: string): Promise<FanoutRow[]> {
  return withPg(async (pg) => {
    const result = await pg.query<FanoutRow>(
      `select topic, payload from realtime.messages
       where event = 'message' and payload->'message'->>'id' = $1
       order by topic`,
      [messageId],
    );
    return result.rows;
  });
}

// Both helpers await real channel signals (subscribe status, broadcast payload);
// the setTimeout bounds only the failure case, since Supabase gives no promise
// to await and fake timers cannot advance the server's broadcast clock.
async function joinPrivate(
  client: SupabaseClient,
  topic: string
): Promise<RealtimeChannel> {
  for (let attempt = 1; ; attempt += 1) {
    const channel = client.channel(topic, { config: { private: true } });
    const joined = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 4_000);
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timer);
          resolve(true);
        } else if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          clearTimeout(timer);
          resolve(false);
        }
      });
    });
    if (joined) return channel;
    await channel.unsubscribe();
    if (attempt === 5) throw new Error(`private channel ${topic} did not subscribe`);
  }
}

function channelObserver(channel: RealtimeChannel, event: string) {
  const seen: Array<Record<string, unknown>> = [];
  const waiters: Array<(payload: Record<string, unknown>) => void> = [];
  channel.on("broadcast", { event }, ({ payload }) => {
    const wake = waiters.shift();
    if (wake) {
      wake(payload);
    } else {
      seen.push(payload);
    }
  });
  return {
    next(timeoutMs = 8_000): Promise<Record<string, unknown>> {
      const { promise, resolve, reject } = Promise.withResolvers<Record<string, unknown>>();
      const pending = seen.shift();
      if (pending) {
        resolve(pending);
        return promise;
      }
      const timer = setTimeout(() => reject(new Error(`missing ${event} broadcast`)), timeoutMs);
      waiters.push((payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
      return promise;
    },
  };
}

describe.skipIf(!isIntegrationTestReady)("realtime erasure purge", () => {
  let service: SupabaseClient;

  beforeAll(async () => {
    if (!adminClient) throw new Error("service role key missing");
    service = adminClient;
  });

  it("removes every content-bearing fanout row of an erased message and keeps the erasure broadcast", async () => {
    const [alice, bob] = await createTestUsers(2);
    const groupId = await createGroupWithMembers(alice, [bob], "Grupo purge");
    const sent = await send(alice, groupId, "primeira do purge");

    const before = await fanoutRows(sent.id);
    expect(before.map((row) => row.topic).sort()).toEqual(
      [`user:${alice.id}`, `user:${bob.id}`].sort(),
    );
    for (const row of before) {
      expect(row.payload).toMatchObject({
        group_id: groupId,
        message: { id: sent.id, content: "primeira do purge" },
      });
    }

    const erased = await rpcOk<ChatMessage>(service, "erase_chat_message", {
      p_message_id: sent.id,
    });
    expect(erased).toMatchObject({ id: sent.id, erased: true, content: null });

    const after = await fanoutRows(sent.id);
    expect(after.length).toBeGreaterThanOrEqual(1);
    for (const row of after) {
      const message = row.payload.message as Record<string, unknown>;
      expect(message.id).toBe(sent.id);
      expect(message.content).toBeNull();
      expect(message.erased).toBe(true);
    }
  });

  it("still delivers the erasure live to a subscribed member's user topic", async () => {
    const [alice, bob] = await createTestUsers(2);
    const groupId = await createGroupWithMembers(alice, [bob], "Grupo live");
    const clientBob = authenticateAs(bob);
    await clientBob.realtime.setAuth(bob.accessToken!);
    const channel = await joinPrivate(clientBob, `user:${bob.id}`);
    const messages = channelObserver(channel, "message");

    try {
      const sent = await send(alice, groupId, "antes do erase ao vivo");
      const original = await messages.next(30_000);
      expect(original).toMatchObject({
        group_id: groupId,
        message: { id: sent.id, content: "antes do erase ao vivo" },
      });

      await rpcOk<ChatMessage>(service, "erase_chat_message", {
        p_message_id: sent.id,
      });

      const tombstone = await messages.next(30_000);
      expect(tombstone).toMatchObject({
        group_id: groupId,
        message: { id: sent.id, erased: true, content: null },
      });
    } finally {
      await channel.unsubscribe();
    }
  }, 180_000);

  it("delete_account purges every pre-deletion realtime row naming the user", async () => {
    const [victim, member] = await createTestUsers(2);
    const groupId = await createGroupWithMembers(victim, [member], "Grupo conta");
    const victimMessage = await send(victim, groupId, "segredo da vitima 42");
    await send(member, groupId, "mensagem do membro 7");

    const topics = [`user:${victim.id}`, `user:${member.id}`, `group:${groupId}`, `chat:${groupId}`];
    const { fence, matching } = await withPg(async (pg) => {
      const snapshot = await pg.query<{ fence: string; matching: number }>(
        `select coalesce(max(inserted_at)::text, to_char(now(), 'YYYY-MM-DD HH24:MI:SS.US')) as fence,
                (count(*) filter (where payload::text like '%' || $1::text || '%'
                  or payload::text like '%segredo da vitima 42%'))::int as matching
           from realtime.messages
         where topic = any($2::text[])`,
        [victim.id, topics],
      );
      return { fence: snapshot.rows[0]!.fence, matching: snapshot.rows[0]!.matching };
    });
    expect(matching).toBeGreaterThan(0);
    const contentBefore = await fanoutRows(victimMessage.id);
    expect(contentBefore.length).toBeGreaterThanOrEqual(1);

    const deleted = await rpcOk<EraseResult>(service, "delete_account", {
      p_user_id: victim.id,
    });
    expect(deleted.userId).toBe(victim.id);

    const survivors = await withPg(async (pg) => {
      const result = await pg.query<{ count: number }>(
        `select count(*)::int as count from realtime.messages
         where inserted_at <= $1::timestamp and topic = any($3::text[])
           and (payload::text like '%' || $2::text || '%'
             or payload::text like '%segredo da vitima 42%')`,
        [fence, victim.id, topics],
      );
      return result.rows[0]!.count;
    });
    expect(survivors).toBe(0);
  }, 180_000);

  it("keeps other members' fanout rows in the same group", async () => {
    const [alice, bob] = await createTestUsers(2);
    const groupId = await createGroupWithMembers(alice, [bob], "Grupo vizinhos");
    await send(alice, groupId, "mensagem do vizinho 9");
    const bobMessage = await send(bob, groupId, "resposta do outro 11");

    await rpcOk<EraseResult>(service, "delete_account", { p_user_id: alice.id });

    const kept = await fanoutRows(bobMessage.id);
    expect(kept.map((row) => row.topic).sort()).toEqual(
      [`user:${alice.id}`, `user:${bob.id}`].sort(),
    );
    for (const row of kept) {
      expect(row.payload).toMatchObject({
        group_id: groupId,
        message: { id: bobMessage.id, content: "resposta do outro 11" },
      });
    }
  }, 180_000);
});
