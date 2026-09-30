import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import type { Database } from "@/types/database";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createExpense,
  createTestUser,
  createGroupWithMembers,
  createTestUsers,
  expectRpcError,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";

type RpcResult<T> = { data: T | null; error: { message: string; details: string | null } | null };

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

function serviceClient(): SupabaseClient {
  if (!adminClient) throw new Error("service role key missing");
  return adminClient;
}

async function deleteUser(userId: string): Promise<{ userId: string; deletedAt: string }> {
  return rpcOk(serviceClient(), "delete_account", { p_user_id: userId });
}

interface BalanceRow {
  kind: string;
  participant_id: string;
  net_cents: number;
}

async function balances(groupId: string): Promise<BalanceRow[]> {
  return withPg(async (pg) => {
    const result = await pg.query<BalanceRow>(
      "select kind, participant_id, net_cents from group_balances where group_id = $1 order by kind, participant_id",
      [groupId],
    );
    return result.rows;
  });
}

async function profileOf(userId: string) {
  return withPg(async (pg) => {
    const result = await pg.query<Record<string, unknown>>(
      "select * from users where id = $1",
      [userId],
    );
    return result.rows[0] ?? null;
  });
}

function settledExpense(
  actor: TestUser,
  groupId: string,
  participants: TestUser[],
  totalCents: number,
) {
  return createExpense(actor, {
    groupId,
    title: "Conta quitada",
    occurredOn: "2026-09-27",
    totalCents,
    payload: {
      items: [],
      participants: participants.map((p) => ({ kind: "user", userId: p.id })),
      shares: participants.map(() => Math.floor(totalCents / participants.length)),
      payers: [{ participantIndex: 0, amountCents: totalCents }],
      itemAssignments: null,
    },
  });
}

describe.skipIf(!isIntegrationTestReady)("delete_account RPC", () => {
  let service: SupabaseClient;

  beforeAll(async () => {
    service = serviceClient();
  });

  it("refuses all nonzero balances and returns every group name without changing data", async () => {
    const [debtor, creditor, dmPeer] = await createTestUsers(3);
    const group = await createGroupWithMembers(debtor, [creditor], "Grupo com saldo");
    await createExpense(debtor, {
      groupId: group,
      title: "Jantar",
      occurredOn: "2026-09-27",
      totalCents: 5000,
      payload: {
        items: [],
        participants: [
          { kind: "user", userId: debtor.id },
          { kind: "user", userId: creditor.id },
        ],
        shares: [4000, 1000],
        payers: [{ participantIndex: 1, amountCents: 5000 }],
        itemAssignments: null,
      },
    });

    const dm = await rpcOk<{ groupId: string }>(authenticateAs(debtor), "get_or_create_dm", {
      p_user_id: dmPeer.id,
    });
    await withPg(async (pg) => {
      await pg.query(
        "insert into group_balances (group_id, kind, participant_id, net_cents) values ($1, 'user', $2, 2000)",
        [dm.groupId, debtor.id],
      );
    });

    const orphanGroup = await createGroupWithMembers(creditor, [], "Grupo órfão");
    await withPg(async (pg) => {
      await pg.query(
        "insert into group_balances (group_id, kind, participant_id, net_cents) values ($1, 'user', $2, 777)",
        [orphanGroup, debtor.id],
      );
    });

    const beforeProfile = await profileOf(debtor.id);
    const beforeBalances = await Promise.all(
      [group, dm.groupId, orphanGroup].map((id) => balances(id)),
    );

    const { error } = (await service.rpc("delete_account", {
      p_user_id: debtor.id,
    })) as RpcResult<unknown>;
    expect(error?.message).toBe("outstanding_balance");
    const groups = JSON.parse(error?.details ?? "{}").groups as Array<{ id: string; name: string }>;
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.id)).toEqual([group, dm.groupId, orphanGroup].sort());
    expect(groups.find((g) => g.id === dm.groupId)?.name).toContain("Conversa com");

    expect(await profileOf(debtor.id)).toEqual(beforeProfile);
    expect(await balances(group)).toEqual(beforeBalances[0]);
    expect(await balances(dm.groupId)).toEqual(beforeBalances[1]);
    expect(await balances(orphanGroup)).toEqual(beforeBalances[2]);
  });

  it("anonymizes an eligible account while preserving every financial fact and other balance", async () => {
    const [leaver, other] = await createTestUsers(2);
    const groupId = await createGroupWithMembers(leaver, [other], "Grupo quitado");
    const expense = await settledExpense(leaver, groupId, [leaver, other], 3000);
    await rpcOk(authenticateAs(leaver), "record_settlement", {
      p_operation_id: crypto.randomUUID(),
      p_group_id: groupId,
      p_from_user_id: other.id,
      p_to_user_id: leaver.id,
      p_amount_cents: 1500,
    });

    await withPg(async (pg) => {
      const guest = await pg.query<{ id: string }>(
        "insert into guests (expense_id, display_name) values ($1, 'Amigo do leaver') returning id",
        [expense.expenseId],
      );
      await pg.query(
        "update guests set claimed_by = $2, claimed_at = now(), claimed_version_no = 1 where id = $1",
        [guest.rows[0]!.id, leaver.id],
      );
    });

    await rpcOk<ChatMessageLike>(authenticateAs(leaver), "send_message", {
      p_client_id: crypto.randomUUID(),
      p_group_id: groupId,
      p_content: "mensagem do leaver",
    });

    const before = await withPg(async (pg) => {
      const versions = await pg.query("select * from expense_versions order by expense_id, version_no");
      const settlements = await pg.query("select * from settlements order by id");
      const events = await pg.query("select to_jsonb(e) - 'notified_at' as row from group_events e order by id");
      const balances = await pg.query("select * from group_balances order by group_id, kind, participant_id");
      const pending = await pg.query(
        "select 1 from group_events where actor_id = $1 and notified_at is null",
        [leaver.id],
      );
      return {
        versions: versions.rows,
        settlements: settlements.rows,
        events: events.rows,
        balances: balances.rows,
        pending: pending.rowCount,
      };
    });

    const result = await deleteUser(leaver.id);
    expect(result.userId).toBe(leaver.id);
    expect(result.deletedAt).not.toBeNull();

    const after = await withPg(async (pg) => {
      const versions = await pg.query("select * from expense_versions order by expense_id, version_no");
      const settlements = await pg.query("select * from settlements order by id");
      const events = await pg.query("select to_jsonb(e) - 'notified_at' as row from group_events e order by id");
      const balances = await pg.query("select * from group_balances order by group_id, kind, participant_id");
      const profile = await pg.query("select * from users where id = $1", [leaver.id]);
      const members = await pg.query(
        "select * from group_members where user_id = $1",
        [leaver.id],
      );
      const guests = await pg.query(
        "select display_name, claimed_by from guests where claimed_by = $1",
        [leaver.id],
      );
      const messages = await pg.query(
        "select content, erased_at from chat_messages where sender_id = $1",
        [leaver.id],
      );
      const pending = await pg.query(
        "select 1 from group_events where actor_id = $1 and notified_at is null",
        [leaver.id],
      );
      return {
        versions: versions.rows,
        settlements: settlements.rows,
        events: events.rows,
        balances: balances.rows,
        profile: profile.rows[0],
        members: members.rows,
        guests: guests.rows,
        messages: messages.rows,
        pending: pending.rowCount,
      };
    });

    expect(after.versions).toEqual(before.versions);
    expect(after.settlements).toEqual(before.settlements);
    expect(after.events).toEqual(before.events);
    expect(before.pending).toBeGreaterThan(0);
    expect(after.pending).toBe(0);
    expect(after.balances).toEqual(before.balances);
    expect(after.profile.name).toBe("Conta excluída");
    expect(after.profile.email).toBe("");
    expect(after.profile.avatar_url).toBeNull();
    expect(after.profile.pix_key_encrypted).toBeNull();
    expect(after.profile.onboarded).toBe(false);
    expect(after.profile.deleted_at).not.toBeNull();
    expect(String(after.profile.handle)).toMatch(/^deleted_[0-9a-f]{22}$/);
    expect(after.members).toEqual([]);
    expect(after.guests[0]?.display_name).toBe("Conta excluída");
    expect(after.messages[0]?.content).toBeNull();
    expect(after.messages[0]?.erased_at).not.toBeNull();
  });

  it("replaces a claimed guest's typed name in every bill version, including ones before the claim", async () => {
    const [leaver, other] = await createTestUsers(2);
    const groupId = await createGroupWithMembers(other, [leaver], "Grupo do convidado");
    const otherClient = authenticateAs(other);
    const expense = await createExpense(other, {
      groupId,
      totalCents: 1000,
      payload: {
        items: [],
        participants: [
          { kind: "user", userId: other.id },
          { kind: "guest", displayName: "Nome Real do Leaver" },
        ],
        shares: [500, 500],
        payers: [{ participantIndex: 0, amountCents: 1000 }],
        itemAssignments: null,
      },
    });
    const view = await rpcOk<{ participants: Array<{ kind: string; guest: { id: string } | null }> }>(
      otherClient,
      "get_expense",
      { p_expense_id: expense.expenseId },
    );
    const guestId = view.participants.find((entry) => entry.kind === "guest")?.guest?.id;
    await rpcOk(otherClient, "edit_expense", {
      p_expense_id: expense.expenseId,
      p_expected_version_no: 1,
      p_occurred_on: "2026-09-27",
      p_title: "Conta editada",
      p_merchant_name: null,
      p_expense_type: "single_amount",
      p_total_cents: 1000,
      p_service_fee_bps: 0,
      p_fixed_fee_cents: 0,
      p_payload: {
        items: [],
        participants: [
          { kind: "user", userId: other.id },
          { kind: "guest", guestId, displayName: "Nome Real do Leaver" },
        ],
        shares: [500, 500],
        payers: [{ participantIndex: 0, amountCents: 1000 }],
        itemAssignments: null,
      },
    });
    const token = await rpcOk<{ token: string }>(otherClient, "create_guest_claim_token", {
      p_guest_id: guestId,
    });
    await rpcOk(authenticateAs(leaver), "claim_guest", { p_token: token.token });
    await rpcOk(authenticateAs(leaver), "record_settlement", {
      p_operation_id: crypto.randomUUID(),
      p_group_id: groupId,
      p_from_user_id: leaver.id,
      p_to_user_id: other.id,
      p_amount_cents: 500,
    });

    await deleteUser(leaver.id);

    const versions = await withPg(async (pg) => {
      const result = await pg.query<{ version_no: number; payload: { participants: Array<Record<string, unknown>>; shares: number[] } }>(
        "select version_no, payload from expense_versions where expense_id = $1 order by version_no",
        [expense.expenseId],
      );
      return result.rows;
    });
    expect(versions.map((row) => row.version_no)).toEqual([1, 2]);
    for (const row of versions) {
      expect(JSON.stringify(row.payload)).not.toContain("Nome Real do Leaver");
      expect(row.payload.participants[1]).toEqual({ kind: "guest", guestId, displayName: "Conta excluída" });
      expect(row.payload.shares).toEqual([500, 500]);
    }
  });

  it("removes invited and accepted memberships and transfers creator to the earliest accepted survivor", async () => {
    const [creator, survivorA, survivorB, invitedOnly] = await createTestUsers(4);
    const groupId = await createGroupWithMembers(creator, [survivorA, survivorB], "Grupo do creator");
    const second = await createGroupWithMembers(creator, [invitedOnly], "Grupo sem sobrevivente");

    await withPg(async (pg) => {
      const tied = "2026-09-20T10:00:00Z";
      await pg.query("update group_members set accepted_at = $1 where group_id = $2 and user_id in ($3, $4)", [
        tied,
        groupId,
        survivorA.id,
        survivorB.id,
      ]);
      await pg.query(
        "update group_members set status = 'invited', accepted_at = null where group_id = $1 and user_id = $2",
        [second, invitedOnly.id],
      );
    });

    await deleteUser(creator.id);

    const result = await withPg(async (pg) => {
      const g = await pg.query<{ creator_id: string }>("select creator_id from groups where id = $1", [groupId]);
      const g2 = await pg.query<{ creator_id: string }>("select creator_id from groups where id = $1", [second]);
      const members = await pg.query<{ user_id: string; status: string }>(
        "select user_id, status from group_members where group_id = $1 order by user_id",
        [groupId],
      );
      return { creator: g.rows[0]?.creator_id, secondCreator: g2.rows[0]?.creator_id, members: members.rows };
    });

    const expected = [survivorA.id, survivorB.id].sort()[0];
    expect(result.creator).toBe(expected);
    expect(result.members.map((m) => m.user_id)).toEqual([survivorA.id, survivorB.id].sort());
    expect(result.members.every((m) => m.status === "accepted")).toBe(true);
    expect(result.secondCreator).toBe(creator.id);
  });

  it("releases the old handle and hides the replacement from lookup", async () => {
    const [user] = await createTestUsers(1, { handle: "release_me" });
    await deleteUser(user.id);

    const lookup = await rpcOk<{ user: unknown } | null>(service, "lookup_user_by_handle", {
      p_handle: "release_me",
    });
    expect(lookup).toBeNull();

    const replacement = await withPg(async (pg) => {
      const result = await pg.query<{ handle: string; onboarded: boolean }>(
        "select handle, onboarded from users where id = $1",
        [user.id],
      );
      return result.rows[0];
    });
    expect(replacement?.handle).toMatch(/^deleted_[0-9a-f]{22}$/);
    expect(replacement?.onboarded).toBe(false);

    const newcomer = await createTestUser({ handle: "release_me" });
    expect(newcomer.handle).toBe("release_me");
  });

  it("erases all authored messages but no other sender text", async () => {
    const [leaver, other] = await createTestUsers(2);
    const groupId = await createGroupWithMembers(leaver, [other], "Grupo das mensagens");
    const mine = await rpcOk<{ id: string }>(authenticateAs(leaver), "send_message", {
      p_client_id: crypto.randomUUID(),
      p_group_id: groupId,
      p_content: "minha mensagem",
    });
    const theirs = await rpcOk<{ id: string }>(authenticateAs(other), "send_message", {
      p_client_id: crypto.randomUUID(),
      p_group_id: groupId,
      p_content: "mensagem do outro",
    });

    await deleteUser(leaver.id);

    const rows = await withPg(async (pg) => {
      const result = await pg.query<{ id: string; content: string | null; erased_at: string | null }>(
        "select id, content, erased_at from chat_messages where id in ($1, $2) order by id",
        [mine.id, theirs.id],
      );
      return result.rows;
    });
    const mineAfter = rows.find((r) => r.id === mine.id);
    const theirsAfter = rows.find((r) => r.id === theirs.id);
    expect(mineAfter?.content).toBeNull();
    expect(mineAfter?.erased_at).not.toBeNull();
    expect(theirsAfter?.content).toBe("mensagem do outro");
    expect(theirsAfter?.erased_at).toBeNull();
  });

  it("clears personal push, reads, counters, invite links, relationships and claimed guest names", async () => {
    const [leaver, other] = await createTestUsers(2);
    const groupId = await createGroupWithMembers(leaver, [other], "Grupo da limpeza");

    await service.rpc("claim_push_subscription", {
      p_user_id: leaver.id,
      p_channel: "web",
      p_endpoint_digest: Buffer.from(`digest-${crypto.randomUUID()}`),
      p_subscription_encrypted: "enc",
    });
    await rpcOk(authenticateAs(leaver), "send_message", {
      p_client_id: crypto.randomUUID(),
      p_group_id: groupId,
      p_content: "para marcar leitura",
    });
    await rpcOk(authenticateAs(other), "send_message", {
      p_client_id: crypto.randomUUID(),
      p_group_id: groupId,
      p_content: "mensagem lida pelo leaver",
    });
    const conversation = await rpcOk<{ messages: Array<{ id: string }> }>(
      authenticateAs(leaver),
      "get_conversation",
      { p_group_id: groupId, p_limit: 50 },
    );
    await rpcOk(authenticateAs(leaver), "mark_read", {
      p_group_id: groupId,
      p_last_read_message_id: conversation.messages[0]!.id,
    });
    await rpcOk(authenticateAs(leaver), "create_invite_link", {
      p_group_id: groupId,
      p_max_uses: null,
      p_expires_at: null,
    });
    await withPg(async (pg) => {
      await pg.query(
        "insert into rate_limit_counters (bucket, subject, window_start, count) values ('lookup', $1, now(), 1)",
        [leaver.id],
      );
      await pg.query("insert into user_blocks (blocker_id, blocked_id) values ($1, $2), ($2, $1)", [
        leaver.id,
        other.id,
      ]);
      await pg.query("insert into dm_opt_outs (user_id, other_user_id) values ($1, $2)", [other.id, leaver.id]);
      await pg.query(
        "insert into group_events (group_id, kind, actor_id, subject_user_id, payload) values ($1, 'guest_claimed', $2, $2, $3)",
        [groupId, leaver.id, JSON.stringify({ displayName: "Nome Verdadeiro" })],
      );
    });

    await deleteUser(leaver.id);

    const state = await withPg(async (pg) => {
      const subs = await pg.query("select 1 from push_subscriptions where user_id = $1", [leaver.id]);
      const reads = await pg.query("select 1 from conversation_reads where user_id = $1", [leaver.id]);
      const relationships = await pg.query(
        "select 1 from user_blocks where $1 in (blocker_id, blocked_id) union all select 1 from dm_opt_outs where $1 in (user_id, other_user_id)",
        [leaver.id],
      );
      const claimNames = await pg.query<{ name: string }>(
        "select payload->>'displayName' as name from group_events where kind = 'guest_claimed' and subject_user_id = $1",
        [leaver.id],
      );
      const counters = await pg.query("select 1 from rate_limit_counters where subject = $1", [leaver.id]);
      const links = await pg.query<{ is_active: boolean }>(
        "select is_active from group_invite_links where created_by = $1",
        [leaver.id],
      );
      return {
        subs: subs.rowCount,
        reads: reads.rowCount,
        relationships: relationships.rowCount,
        claimNames: claimNames.rows.map((row) => row.name),
        counters: counters.rowCount,
        links: links.rows,
      };
    });
    expect(state.subs).toBe(0);
    expect(state.reads).toBe(0);
    expect(state.relationships).toBe(0);
    expect(state.claimNames).toEqual(["Conta excluída"]);
    expect(state.counters).toBe(0);
    expect(state.links.every((l) => !l.is_active)).toBe(true);
  });

  it("revokes room capabilities and preserves finalized financial history", async () => {
    const [guestHost, participant] = await createTestUsers(2);
    const otherGroup = await createGroupWithMembers(guestHost, [participant], "Grupo da outra sala");

    const openRoom = crypto.randomUUID();
    await withPg(async (pg) => {
      await pg.query(
        "insert into assignment_rooms (id, host_user_id, group_target, header) values ($1, $2, $3::jsonb, $4::jsonb)",
        [openRoom, participant.id, JSON.stringify({ kind: "informal" }), JSON.stringify({ title: "Aberta" })],
      );
      await pg.query(
        "insert into guest_credentials.assignment_room_access (room_id, join_digest, join_expires_at, broadcast_topic) values ($1, $2, now() + interval '7 days', $3)",
        [openRoom, Buffer.from("ef".repeat(32), "hex"), `assignment-room:${"B".repeat(43)}`],
      );
      const hostRow = await pg.query<{ id: string }>(
        "insert into assignment_room_participants (room_id, id, ordinal, display_name, user_id) values ($1, $2, 0, 'Leaver host', $3) returning id",
        [openRoom, crypto.randomUUID(), participant.id],
      );
      await pg.query(
        "insert into guest_credentials.assignment_room_members (room_id, participant_id, token_digest, expires_at) values ($1, $2, $3, now() + interval '7 days')",
        [openRoom, hostRow.rows[0]!.id, Buffer.from("ab".repeat(32), "hex")],
      );
    });

    const finalizedRoom = crypto.randomUUID();
    await withPg(async (pg) => {
      await pg.query(
        "insert into assignment_rooms (id, host_user_id, group_target, header, status, expense_id) values ($1, $2, $3::jsonb, $4::jsonb, 'finalized', null)",
        [finalizedRoom, guestHost.id, JSON.stringify({ kind: "informal" }), JSON.stringify({ title: "Fechada" })],
      );
      await pg.query(
        "insert into guest_credentials.assignment_room_access (room_id, join_digest, join_expires_at, broadcast_topic) values ($1, $2, now() + interval '7 days', $3)",
        [finalizedRoom, Buffer.from("fe".repeat(32), "hex"), `assignment-room:${"C".repeat(43)}`],
      );
      const hostRow = await pg.query<{ id: string }>(
        "insert into assignment_room_participants (room_id, id, ordinal, display_name, user_id) values ($1, $2, 0, 'Outro host', $3) returning id",
        [finalizedRoom, crypto.randomUUID(), guestHost.id],
      );
      const leaverRow = await pg.query<{ id: string }>(
        "insert into assignment_room_participants (room_id, id, ordinal, display_name, user_id) values ($1, $2, 1, 'Leaver', $3) returning id",
        [finalizedRoom, crypto.randomUUID(), participant.id],
      );
      await pg.query(
        "insert into assignment_room_items (room_id, id, ordinal, description, quantity_milliunits, unit_price_cents, total_price_cents) values ($1, $2, 0, 'Item', 1000, 1500, 1500)",
        [finalizedRoom, crypto.randomUUID()],
      );
      await pg.query(
        "insert into assignment_room_claims (room_id, item_id, participant_id, ticks) values ($1, (select id from assignment_room_items where room_id = $1 limit 1), $2, 500)",
        [finalizedRoom, leaverRow.rows[0]!.id],
      );
      void hostRow;
    });

    const finalizedBefore = await withPg(async (pg) => {
      const claims = await pg.query("select * from assignment_room_claims where room_id = $1", [finalizedRoom]);
      const items = await pg.query("select * from assignment_room_items where room_id = $1", [finalizedRoom]);
      return { claims: claims.rows, items: items.rows };
    });

    await deleteUser(participant.id);

    const after = await withPg(async (pg) => {
      const openRoomRow = await pg.query("select 1 from assignment_rooms where id = $1", [openRoom]);
      const tombstones = await pg.query<{ display_name: string; removed_at: string | null; room_id: string }>(
        "select display_name, removed_at, room_id from assignment_room_participants where user_id = $1 order by room_id",
        [participant.id],
      );
      const credentials = await pg.query(
        "select 1 from guest_credentials.assignment_room_members m join assignment_room_participants p on p.room_id = m.room_id and p.id = m.participant_id where p.user_id = $1",
        [participant.id],
      );
      const finalizedClaims = await pg.query("select * from assignment_room_claims where room_id = $1", [finalizedRoom]);
      const finalizedItems = await pg.query("select * from assignment_room_items where room_id = $1", [finalizedRoom]);
      return {
        openRoom: openRoomRow.rowCount,
        tombstones: tombstones.rows,
        credentials: credentials.rowCount,
        finalizedClaims: finalizedClaims.rows,
        finalizedItems: finalizedItems.rows,
      };
    });

    expect(after.openRoom).toBe(0);
    expect(after.tombstones).toHaveLength(1);
    expect(after.tombstones[0]?.display_name).toBe("Conta excluída");
    expect(after.tombstones[0]?.removed_at).not.toBeNull();
    expect(after.tombstones[0]?.room_id).toBe(finalizedRoom);
    expect(after.credentials).toBe(0);
    expect(after.finalizedClaims).toEqual(finalizedBefore.claims);
    expect(after.finalizedItems).toEqual(finalizedBefore.items);
    void otherGroup;
  });

  it("retries idempotently after application commit before auth deletion", async () => {
    const [leaver, other] = await createTestUsers(2);
    await createGroupWithMembers(leaver, [other], "Grupo do retry");
    await settledExpense(leaver, await withPg(async (pg) => {
      const result = await pg.query<{ id: string }>("select id from groups where creator_id = $1", [leaver.id]);
      return result.rows[0]!.id;
    }), [leaver, other], 2000);
    await rpcOk(authenticateAs(other), "record_settlement", {
      p_operation_id: crypto.randomUUID(),
      p_group_id: (await withPg(async (pg) => {
        const result = await pg.query<{ id: string }>("select id from groups where creator_id = $1", [leaver.id]);
        return result.rows[0]!.id;
      })),
      p_from_user_id: other.id,
      p_to_user_id: leaver.id,
      p_amount_cents: 1000,
    });

    const first = await deleteUser(leaver.id);
    const second = await deleteUser(leaver.id);

    expect(second.deletedAt).not.toBeNull();
    expect(new Date(second.deletedAt).getTime()).toBe(new Date(first.deletedAt).getTime());
    const handles = await withPg(async (pg) => {
      const result = await pg.query<{ handle: string }>("select handle from users where id = $1", [leaver.id]);
      return result.rows;
    });
    expect(handles).toHaveLength(1);
    const memberships = await withPg(async (pg) => {
      const result = await pg.query("select 1 from group_members where user_id = $1", [leaver.id]);
      return result.rowCount;
    });
    expect(memberships).toBe(0);
  });

  it("refuses a later change that would leave a deleted account with a balance", async () => {
    const [leaver, other] = await createTestUsers(2);
    const groupId = await createGroupWithMembers(leaver, [other], "Grupo corrigido");
    const settled = await settledExpense(leaver, groupId, [leaver, other], 2000);
    await rpcOk(authenticateAs(other), "record_settlement", {
      p_operation_id: crypto.randomUUID(),
      p_group_id: groupId,
      p_from_user_id: other.id,
      p_to_user_id: leaver.id,
      p_amount_cents: 1000,
    });

    await deleteUser(leaver.id);

    const edit = async (shares: [number, number]) =>
      (await authenticateAs(other).rpc("edit_expense", {
        p_expense_id: settled.expenseId,
        p_expected_version_no: 1,
        p_occurred_on: "2026-09-27",
        p_title: "Correção histórica",
        p_merchant_name: "",
        p_expense_type: "single_amount",
        p_total_cents: 2000,
        p_service_fee_bps: 0,
        p_fixed_fee_cents: 0,
        p_payload: {
          items: [],
          participants: [
            { kind: "user", userId: leaver.id },
            { kind: "user", userId: other.id },
          ],
          shares,
          payers: [{ participantIndex: 0, amountCents: 2000 }],
          itemAssignments: null,
        },
      })) as RpcResult<unknown>;

    const refused = await edit([1900, 100]);
    expect(refused.error?.message).toBe("former_member_balance");
    expect(await balances(groupId)).toEqual([]);

    const retitled = await edit([1000, 1000]);
    expect(retitled.error).toBeNull();
    expect(await balances(groupId)).toEqual([]);
  });

  it("denies anon and authenticated deletion of self or another user", async () => {
    const [someone] = await createTestUsers(1);
    const anon = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const anonError = (await anon.rpc("delete_account", { p_user_id: someone.id })) as RpcResult<unknown>;
    expect(anonError.error?.message).toMatch(/permission denied/i);

    const authError = await expectRpcError(
      authenticateAs(someone).rpc("delete_account", { p_user_id: someone.id }),
    );
    expect(authError).toMatch(/permission denied/i);
  });

  it("serializes an in-flight group write before the balance guard or denies it after member removal", async () => {
    const [leaver, other] = await createTestUsers(2);
    const groupId = await createGroupWithMembers(leaver, [other], "Grupo da disputa");
    await settledExpense(leaver, groupId, [leaver, other], 1000);

    const deleter = new Client({ connectionString: process.env.SUPABASE_DB_URL });
    const writer = new Client({ connectionString: process.env.SUPABASE_DB_URL });
    await deleter.connect();
    await writer.connect();
    try {
      await writer.query("begin");
      await writer.query("select public.lock_group($1)", [groupId]);
      await writer.query(
        "update group_balances set net_cents = 999 where group_id = $1 and kind = 'user' and participant_id = $2",
        [groupId, leaver.id],
      );

      await deleter.query("set lock_timeout = '1s'");
      await expect(
        deleter.query("select public.delete_account($1)", [leaver.id]),
      ).rejects.toThrow(/lock timeout|canceling statement/);

      await writer.query("commit");
      const refused = await deleter.query("select public.delete_account($1)", [leaver.id]).catch((e) => e);
      expect(String(refused.message)).toMatch(/outstanding_balance/);
      const stillThere = await withPg(async (pg) => {
        const result = await pg.query<{ deleted_at: string | null }>(
          "select deleted_at from users where id = $1",
          [leaver.id],
        );
        return result.rows[0]?.deleted_at;
      });
      expect(stillThere).toBeNull();
    } finally {
      await writer.end().catch(() => {});
      await deleter.end().catch(() => {});
    }
  });
});

interface ChatMessageLike {
  id: string;
}
