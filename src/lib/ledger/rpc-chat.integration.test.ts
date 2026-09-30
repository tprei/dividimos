import { beforeAll, describe, expect, it } from "vitest";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createGroupWithMembers,
  createTestUsers,
  expectRpcError,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";

interface ChatMessage {
  id: string;
  clientId: string;
  groupId: string;
  senderId: string;
  content: string;
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

async function rpcErrorCode(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<string> {
  return expectRpcError(Promise.resolve(client.rpc(fn, args)));
}

describe.skipIf(!isIntegrationTestReady)("chat RPC — send_message replay safety", () => {
  let alice: TestUser;
  let bob: TestUser;
  let clientAlice: SupabaseClient;
  let clientBob: SupabaseClient;
  let groupId: string;
  let otherGroupId: string;

  beforeAll(async () => {
    [alice, bob] = await createTestUsers(2);
    clientAlice = authenticateAs(alice);
    clientBob = authenticateAs(bob);
    groupId = await createGroupWithMembers(alice, [bob], "Grupo chat");
    otherGroupId = await createGroupWithMembers(alice, [bob], "Grupo chat 2");
  });

  it("replaying the same client id returns the first message and stores exactly one row", async () => {
    const clientId = crypto.randomUUID();
    const first = await rpcOk<ChatMessage>(clientAlice, "send_message", {
      p_client_id: clientId,
      p_group_id: groupId,
      p_content: "mensagem original",
    });

    // The retry carries a different body: dedupe must still win and the
    // stored row must keep the first content.
    const replay = await rpcOk<ChatMessage>(clientAlice, "send_message", {
      p_client_id: clientId,
      p_group_id: groupId,
      p_content: "conteúdo divergente",
    });

    expect(replay.id).toBe(first.id);
    expect(replay.content).toBe("mensagem original");
    expect(replay.senderId).toBe(alice.id);
    const rows = await withPg((client) =>
      client.query<{ count: number }>(
        "select count(*)::int as count from public.chat_messages where client_id = $1",
        [clientId],
      ),
    );
    expect(rows.rows[0]?.count ?? 0).toBe(1);
  });

  it("rejects a client id already used by another sender with invalid_argument", async () => {
    const clientId = crypto.randomUUID();
    await rpcOk<ChatMessage>(clientAlice, "send_message", {
      p_client_id: clientId,
      p_group_id: groupId,
      p_content: "de alice",
    });

    await expect(
      rpcErrorCode(clientBob, "send_message", {
        p_client_id: clientId,
        p_group_id: groupId,
        p_content: "tentativa de bob",
      }),
    ).resolves.toBe("invalid_argument");

    const rows = await withPg(async (client) =>
      client.query<{ sender_id: string }>(
        "select sender_id from public.chat_messages where client_id = $1",
        [clientId],
      ),
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.sender_id).toBe(alice.id);
  });

  it("rejects a client id already used in another group with invalid_argument", async () => {
    const clientId = crypto.randomUUID();
    await rpcOk<ChatMessage>(clientAlice, "send_message", {
      p_client_id: clientId,
      p_group_id: groupId,
      p_content: "no grupo um",
    });

    await expect(
      rpcErrorCode(clientAlice, "send_message", {
        p_client_id: clientId,
        p_group_id: otherGroupId,
        p_content: "no grupo dois",
      }),
    ).resolves.toBe("invalid_argument");
    const rows = await withPg((client) =>
      client.query<{ count: number }>(
        "select count(*)::int as count from public.chat_messages where client_id = $1",
        [clientId],
      ),
    );
    expect(rows.rows[0]?.count ?? 0).toBe(1);
  });
});

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
    seen.push(payload);
    for (const wake of waiters.splice(0)) wake(payload);
  });
  return {
    next(timeoutMs = 8_000): Promise<Record<string, unknown>> {
      const { promise, resolve, reject } = Promise.withResolvers<Record<string, unknown>>();
      if (seen.length > 0) {
        resolve(seen[0]!);
        return promise;
      }
      const timer = setTimeout(() => reject(new Error(`missing ${event} broadcast`)), timeoutMs);
      waiters.push((payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
      return promise;
    },
    expectNone(): Promise<void> {
      if (seen.length > 0) {
        return Promise.reject(new Error(`unexpected ${event} broadcast`));
      }
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const timer = setTimeout(resolve, 1_500);
      waiters.push(() => {
        clearTimeout(timer);
        reject(new Error(`unexpected ${event} broadcast`));
      });
      return promise;
    },
  };
}

describe.skipIf(!isIntegrationTestReady)(
  "chat RPC — private member broadcasts",
  () => {
    let alice: TestUser;
    let bob: TestUser;
    let carol: TestUser;
    let clientAlice: SupabaseClient;
    let clientBob: SupabaseClient;
    let clientCarol: SupabaseClient;
    let groupId: string;

    beforeAll(async () => {
      [alice, bob, carol] = await createTestUsers(3);
      clientAlice = authenticateAs(alice);
      clientBob = authenticateAs(bob);
      clientCarol = authenticateAs(carol);
      await Promise.all([
        clientAlice.realtime.setAuth(alice.accessToken!),
        clientBob.realtime.setAuth(bob.accessToken!),
        clientCarol.realtime.setAuth(carol.accessToken!),
      ]);
      groupId = await createGroupWithMembers(alice, [bob, carol], "Grupo fanout");
    });

    it("delivers the full message on each accepted member's user topic and never on the shared topics", async () => {
      const userChannelAlice = await joinPrivate(clientAlice, `user:${alice.id}`);
      const userChannelBob = await joinPrivate(clientBob, `user:${bob.id}`);
      const chatChannel = await joinPrivate(clientAlice, `chat:${groupId}`);
      const groupChannel = await joinPrivate(clientAlice, `group:${groupId}`);
      const userMessagesAlice = channelObserver(userChannelAlice, "message");
      const userMessagesBob = channelObserver(userChannelBob, "message");
      const chatMessages = channelObserver(chatChannel, "message");
      const groupMessages = channelObserver(groupChannel, "message");
      const groupActivity = channelObserver(groupChannel, "chat_activity");

      const channels = [userChannelAlice, userChannelBob, chatChannel, groupChannel];
      try {
        const sentMessage = await rpcOk<ChatMessage>(clientAlice, "send_message", {
          p_client_id: crypto.randomUUID(),
          p_group_id: groupId,
          p_content: "conteúdo do grupo",
        });
        const [receivedByAlice, receivedByBob, activity] = await Promise.all([
          userMessagesAlice.next(),
          userMessagesBob.next(),
          groupActivity.next(),
        ]);

        for (const received of [receivedByAlice, receivedByBob]) {
          expect(Object.keys(received).filter((key) => key !== "id").sort()).toEqual(["group_id", "message"]);
          expect(received.group_id).toBe(groupId);
          expect(received.message).toMatchObject({
            id: sentMessage.id,
            senderId: alice.id,
            content: "conteúdo do grupo",
          });
        }
        expect(activity).toMatchObject({ group_id: groupId });

        await Promise.all([chatMessages.expectNone(), groupMessages.expectNone()]);
      } finally {
        await Promise.all(channels.map((channel) => channel.unsubscribe()));
      }
    }, 180_000);

    it("stops delivering to a member removed before the send while accepted members still receive it", async () => {
      const userChannelCarol = await joinPrivate(clientCarol, `user:${carol.id}`);
      const chatChannel = await joinPrivate(clientCarol, `chat:${groupId}`);
      const userChannelBob = await joinPrivate(clientBob, `user:${bob.id}`);
      const userMessagesBob = channelObserver(userChannelBob, "message");
      const userMessagesCarol = channelObserver(userChannelCarol, "message");
      const chatMessages = channelObserver(chatChannel, "message");

      const channels = [userChannelBob, userChannelCarol, chatChannel];
      try {
        await rpcOk(clientAlice, "remove_member", {
          p_group_id: groupId,
          p_user_id: carol.id,
        });
        await rpcOk<ChatMessage>(clientBob, "send_message", {
          p_client_id: crypto.randomUUID(),
          p_group_id: groupId,
          p_content: "depois da saída",
        });
        const received = await userMessagesBob.next();
        expect(received).toMatchObject({
          group_id: groupId,
          message: { content: "depois da saída", senderId: bob.id },
        });

        await Promise.all([userMessagesCarol.expectNone(), chatMessages.expectNone()]);
      } finally {
        await Promise.all(channels.map((channel) => channel.unsubscribe()));
      }
    }, 180_000);
  },
);
