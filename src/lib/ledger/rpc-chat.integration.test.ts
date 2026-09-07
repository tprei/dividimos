import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
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
