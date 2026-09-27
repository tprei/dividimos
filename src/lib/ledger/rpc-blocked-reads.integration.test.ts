import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createExpense,
  createGroupWithMembers,
  createTestUsers,
  equalSplitPayload,
  expectRpcError,
  getBalances,
  rpcDecoded,
  withPg,
} from "@/test/integration-helpers";
import { decodeConversation } from "@/lib/ledger/decode";
import { decodeGroupOverviewV2 } from "@/lib/ledger/decode-group-overview";
import type { ChatMessage, Conversation, GroupSnapshot } from "@/types/ledger";

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

async function conversation(
  client: SupabaseClient,
  groupId: string,
  before?: { createdAt: string; id: string },
  limit = 50,
  read: "get_conversation" | "get_conversation_v2" = "get_conversation",
): Promise<Conversation> {
  return rpcDecoded(
    client,
    read,
    {
      p_group_id: groupId,
      p_message_before_created_at: before?.createdAt,
      p_message_before_id: before?.id,
      p_event_before_created_at: undefined,
      p_event_before_id: undefined,
      p_limit: limit,
    },
    decodeConversation,
  );
}

async function snapshot(
  client: SupabaseClient,
  groupId: string,
): Promise<GroupSnapshot> {
  return rpcDecoded(
    client,
    "get_group_overview_v2",
    { p_group_id: groupId },
    decodeGroupOverviewV2,
  );
}

async function send(
  client: SupabaseClient,
  groupId: string,
  content: string,
): Promise<ChatMessage> {
  return rpcOk<ChatMessage>(client, "send_message", {
    p_client_id: crypto.randomUUID(),
    p_group_id: groupId,
    p_content: content,
  });
}

interface SeededMessage {
  id: string;
  senderId: string;
  createdAt: Date;
}

/** Direct-seeds a chat message with an exact timestamp and sortable id. */
async function seedMessage(
  groupId: string,
  senderId: string,
  createdAt: Date,
  ordinal: number,
): Promise<SeededMessage> {
  const id = `00000000-0000-0000-0000-${String(ordinal).padStart(12, "0")}`;
  await withPg(async (client) => {
    await client.query(
      "insert into public.chat_messages (id, client_id, group_id, sender_id, content, created_at) values ($1, $2, $3, $4, $5, $6)",
      [id, crypto.randomUUID(), groupId, senderId, `s${ordinal}`, createdAt],
    );
  });
  return { id, senderId, createdAt };
}

describe.skipIf(!isIntegrationTestReady)("blocked chat reads — history", () => {
  it("hides blocked senders from the blocker but not the reverse viewer or a third member", async () => {
    const [ana, bruno, carol] = await createTestUsers(3);
    const anaClient = authenticateAs(ana);
    const brunoClient = authenticateAs(bruno);
    const carolClient = authenticateAs(carol);
    const groupId = await createGroupWithMembers(ana, [bruno, carol], "Grupo leitura");

    await send(anaClient, groupId, "da ana");
    await send(brunoClient, groupId, "do bruno");
    await send(carolClient, groupId, "da carol");

    await rpcOk(anaClient, "block_user", { p_user_id: bruno.id });

    const seenByAna = await conversation(anaClient, groupId);
    expect(seenByAna.messages.map((message) => message.content)).toEqual([
      "da carol",
      "da ana",
    ]);
    const seenByAnaV2 = await conversation(anaClient, groupId, undefined, 50, "get_conversation_v2");
    expect(seenByAnaV2.messages.map((message) => message.content)).toEqual([
      "da carol",
      "da ana",
    ]);

    const seenByBruno = await conversation(brunoClient, groupId);
    expect(seenByBruno.messages.map((message) => message.content)).toEqual([
      "da carol",
      "do bruno",
      "da ana",
    ]);

    const seenByCarol = await conversation(carolClient, groupId);
    expect(seenByCarol.messages.map((message) => message.content)).toEqual([
      "da carol",
      "do bruno",
      "da ana",
    ]);
  });

  it("filters before pagination with equal timestamps and hidden rows across page boundaries", async () => {
    const [ana, bruno] = await createTestUsers(2);
    const anaClient = authenticateAs(ana);
    const groupId = await createGroupWithMembers(ana, [bruno], "Grupo paginado");

    const at = new Date("2026-09-20T12:00:00Z");
    const seeded: SeededMessage[] = [];
    const order = [bruno, ana, bruno, ana, bruno, ana];
    for (let index = 0; index < order.length; index += 1) {
      seeded.push(
        await seedMessage(groupId, order[index].id, at, index + 1),
      );
    }

    await rpcOk(anaClient, "block_user", { p_user_id: bruno.id });

    const visibleIds = seeded
      .filter((message) => message.senderId === ana.id)
      .map((message) => message.id);

    const page1 = await conversation(anaClient, groupId, undefined, 2);
    expect(page1.messages.map((message) => message.id)).toEqual([
      visibleIds[2],
      visibleIds[1],
    ]);
    expect(page1.messagesComplete).toBe(false);
    expect(page1.messageCursor?.id).toBe(visibleIds[1]);
    expect(page1.messageCursor).not.toBeNull();

    const page2 = await conversation(
      anaClient,
      groupId,
      page1.messageCursor!,
      2,
    );
    expect(page2.messages.map((message) => message.id)).toEqual([visibleIds[0]]);
    expect(page2.messagesComplete).toBe(true);
    expect(page2.messageCursor).toBeNull();

    await rpcOk(anaClient, "unblock_user", { p_user_id: bruno.id });

    const restoredPage1 = await conversation(anaClient, groupId, undefined, 2);
    const restoredPage2 = await conversation(
      anaClient,
      groupId,
      restoredPage1.messageCursor!,
      2,
    );
    const restoredPage3 = await conversation(
      anaClient,
      groupId,
      restoredPage2.messageCursor!,
      2,
    );
    const restoredIds = [
      ...restoredPage1.messages.map((message) => message.id),
      ...restoredPage2.messages.map((message) => message.id),
      ...restoredPage3.messages.map((message) => message.id),
    ];
    expect(new Set(restoredIds).size).toBe(6);
    expect(restoredPage3.messagesComplete).toBe(true);
    expect(restoredPage3.messageCursor).toBeNull();
  });

  it("returns empty complete history and null preview when every message is hidden", async () => {
    const [ana, bruno] = await createTestUsers(2);
    const anaClient = authenticateAs(ana);
    const brunoClient = authenticateAs(bruno);
    const groupId = await createGroupWithMembers(ana, [bruno], "Grupo silencioso");

    await send(brunoClient, groupId, "só eu");

    await rpcOk(anaClient, "block_user", { p_user_id: bruno.id });

    const seen = await conversation(anaClient, groupId);
    expect(seen.messages).toEqual([]);
    expect(seen.messagesComplete).toBe(true);
    expect(seen.messageCursor).toBeNull();

    const view = await snapshot(anaClient, groupId);
    expect(view.lastMessage).toBeNull();
    expect(view.unreadCount).toBe(0);
  });

  it("counts only visible unread messages around an existing read watermark", async () => {
    const [ana, bruno, carol] = await createTestUsers(3);
    const anaClient = authenticateAs(ana);
    const carolClient = authenticateAs(carol);
    const groupId = await createGroupWithMembers(ana, [bruno, carol], "Grupo não lidas");

    const first = await send(carolClient, groupId, "primeira");
    await rpcOk(anaClient, "mark_read", {
      p_group_id: groupId,
      p_last_read_message_id: first.id,
    });
    await send(carolClient, groupId, "segunda");

    await rpcOk(anaClient, "block_user", { p_user_id: bruno.id });
    const brunoSender = authenticateAs(bruno);
    await send(brunoSender, groupId, "terceira");

    const view = await snapshot(anaClient, groupId);
    expect(view.unreadCount).toBe(1);
    expect(view.lastMessage?.content).toBe("segunda");

    const seen = await conversation(anaClient, groupId);
    expect(seen.messages.map((message) => message.content)).toEqual([
      "segunda",
      "primeira",
    ]);
  });

  it("chooses the latest visible preview and ignores hidden chat-only activity ordering", async () => {
    const [ana, bruno] = await createTestUsers(2);
    const anaClient = authenticateAs(ana);
    const groupId = await createGroupWithMembers(ana, [bruno], "Grupo atividade");

    await createExpense(ana, {
      groupId,
      totalCents: 4000,
      payload: equalSplitPayload([ana.id, bruno.id], 4000),
    });

    await rpcOk(anaClient, "block_user", { p_user_id: bruno.id });

    const groupAt = new Date("2026-09-21T09:00:00Z");
    const eventAt = new Date("2026-09-21T10:00:00Z");
    const visibleAt = new Date("2026-09-21T10:30:00Z");
    await withPg(async (client) => {
      await client.query("update public.groups set created_at = $2 where id = $1", [
        groupId,
        groupAt,
      ]);
      await client.query(
        "update public.group_events set created_at = $2 where group_id = $1",
        [groupId, eventAt],
      );
    });
    await send(anaClient, groupId, "visível");
    await withPg(async (client) => {
      await client.query(
        "update public.chat_messages set created_at = $2 where group_id = $1 and sender_id = $3",
        [groupId, visibleAt, ana.id],
      );
    });
    const hiddenAt = new Date("2026-09-21T11:00:00Z");
    await seedMessage(groupId, bruno.id, hiddenAt, 900);

    const view = await snapshot(anaClient, groupId);
    expect(view.lastMessage?.content).toBe("visível");
    expect(view.lastMessage?.senderId).toBe(ana.id);
    expect(new Date(view.lastActivityAt!).getTime()).toBe(visibleAt.getTime());

    const seen = await conversation(anaClient, groupId);
    expect(seen.messages.map((message) => message.content)).toEqual(["visível"]);
    expect(seen.messagesComplete).toBe(true);
  });

  it("preserves financial events balances guests settlements and expense summaries", async () => {
    const [ana, bruno] = await createTestUsers(2);
    const anaClient = authenticateAs(ana);
    const groupId = await createGroupWithMembers(ana, [bruno], "Grupo financeiro");

    const created = await createExpense(ana, {
      groupId,
      totalCents: 10000,
      payload: equalSplitPayload([ana.id, bruno.id], 10000),
    });

    const balancesBefore = await getBalances(groupId);
    await rpcOk(anaClient, "block_user", { p_user_id: bruno.id });

    const view = await snapshot(anaClient, groupId);
    expect(view.expenseCount).toBe(1);
    expect(view.balances).toEqual(
      balancesBefore.map((row) => ({
        kind: row.kind,
        participantId: row.participant_id,
        netCents: row.net_cents,
      })),
    );
    expect(view.recentExpenses).toHaveLength(1);
    expect(view.lastEventId).toBeGreaterThan(0);

    const seen = await conversation(anaClient, groupId);
    expect(seen.events.length).toBeGreaterThan(0);

    const detail = await rpcOk<unknown>(anaClient, "get_expense", {
      p_expense_id: created.expenseId,
    });
    expect(detail).toBeTruthy();
  });

  it("keeps invited previews empty and rejects unauthorized conversation history", async () => {
    const [ana, bruno, dave] = await createTestUsers(3);
    const anaClient = authenticateAs(ana);
    const brunoClient = authenticateAs(bruno);
    const groupId = await createGroupWithMembers(ana, [bruno], "Grupo convite");

    await send(brunoClient, groupId, "espiou não");

    const invite = await rpcOk<{ groupId: string }>(anaClient, "create_group", {
      p_name: "Grupo só convite",
      p_member_ids: [dave.id],
    });
    const daveClient = authenticateAs(dave);

    const invited = await snapshot(daveClient, invite.groupId);
    expect(invited.lastMessage).toBeNull();
    expect(invited.unreadCount).toBe(0);
    expect(invited.balances).toEqual([]);

    expect(
      await expectRpcError(
        Promise.resolve(daveClient.rpc("get_conversation", { p_group_id: groupId })),
      ),
    ).toBe("not_a_member");
  });

  it("restores history preview and unread calculation after unblock", async () => {
    const [ana, bruno] = await createTestUsers(2);
    const anaClient = authenticateAs(ana);
    const brunoClient = authenticateAs(bruno);
    const groupId = await createGroupWithMembers(ana, [bruno], "Grupo retorno");

    await send(brunoClient, groupId, "m1");
    await send(brunoClient, groupId, "m2");

    await rpcOk(anaClient, "block_user", { p_user_id: bruno.id });
    const blocked = await snapshot(anaClient, groupId);
    expect(blocked.lastMessage).toBeNull();

    await rpcOk(anaClient, "unblock_user", { p_user_id: bruno.id });

    const restored = await snapshot(anaClient, groupId);
    expect(restored.lastMessage?.content).toBe("m2");
    expect(restored.unreadCount).toBe(2);

    const seen = await conversation(anaClient, groupId);
    expect(seen.messages.map((message) => message.content)).toEqual(["m2", "m1"]);
  });

  it("renders an erased unblocked message as a tombstone and never resurrects erased text", async () => {
    const [ana, bruno] = await createTestUsers(2);
    const anaClient = authenticateAs(ana);
    const brunoClient = authenticateAs(bruno);
    const groupId = await createGroupWithMembers(ana, [bruno], "Grupo apagado");

    const message = await send(brunoClient, groupId, "texto público");

    await rpcOk(anaClient, "block_user", { p_user_id: bruno.id });
    await rpcOk(anaClient, "unblock_user", { p_user_id: bruno.id });
    await adminClient!.rpc("erase_chat_message", { p_message_id: message.id });

    const seen = await conversation(anaClient, groupId);
    const erased = seen.messages.find((entry) => entry.id === message.id);
    expect(erased?.content).toBeNull();
    expect(erased?.erased).toBe(true);
  });
});
