import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createExpense,
  createGroup,
  createGroupWithMembers,
  createTestUser,
  createTestUsers,
  equalSplitPayload,
  expectRpcError,
  withPg,
} from "@/test/integration-helpers";

interface DmHandle {
  groupId: string;
  created: boolean;
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

async function openDm(
  client: SupabaseClient,
  otherId: string,
): Promise<DmHandle> {
  return rpcOk<DmHandle>(client, "get_or_create_dm", { p_user_id: otherId });
}

async function countRows(query: string, params: unknown[]): Promise<number> {
  return withPg(async (client) => {
    const result = await client.query<{ count: string }>(query, params);
    return Number(result.rows[0].count);
  });
}

describe.skipIf(!isIntegrationTestReady)("blocked contact — direct messages", () => {
  it("denies new and existing DMs in both directions", async () => {
    const [ana, bruno] = await createTestUsers(2);
    const anaClient = authenticateAs(ana);
    const brunoClient = authenticateAs(bruno);

    const dm = await openDm(anaClient, bruno.id);
    expect(dm.created).toBe(true);

    await rpcOk(anaClient, "block_user", { p_user_id: bruno.id });

    expect(
      await rpcErrorCode(anaClient, "get_or_create_dm", { p_user_id: bruno.id }),
    ).toBe("member_excluded");
    expect(
      await rpcErrorCode(brunoClient, "get_or_create_dm", { p_user_id: ana.id }),
    ).toBe("member_excluded");

    const existing = await countRows(
      "select count(*)::text as count from public.groups where id = $1 and kind = 'dm'",
      [dm.groupId],
    );
    expect(existing).toBe(1);
  });

  it("denies new DM messages after a block while a retry replays the stored ack", async () => {
    const [ana, bruno] = await createTestUsers(2);
    const anaClient = authenticateAs(ana);
    const dm = await openDm(anaClient, bruno.id);

    const firstClientId = crypto.randomUUID();
    const first = await rpcOk<{ id: string }>(anaClient, "send_message", {
      p_client_id: firstClientId,
      p_group_id: dm.groupId,
      p_content: "primeira",
    });

    await rpcOk(anaClient, "block_user", { p_user_id: bruno.id });

    const replay = await rpcOk<{ id: string }>(anaClient, "send_message", {
      p_client_id: firstClientId,
      p_group_id: dm.groupId,
      p_content: "primeira",
    });
    expect(replay.id).toBe(first.id);

    expect(
      await rpcErrorCode(anaClient, "send_message", {
        p_client_id: crypto.randomUUID(),
        p_group_id: dm.groupId,
        p_content: "segunda",
      }),
    ).toBe("member_excluded");

    const messages = await withPg(async (client) => {
      const result = await client.query<{ content: string }>(
        "select content from public.chat_messages where group_id = $1 order by created_at",
        [dm.groupId],
      );
      return result.rows.map((row) => row.content);
    });
    expect(messages).toEqual(["primeira"]);
  });

  it("does not clear a declined DM opt-out on blocked outreach", async () => {
    const [ana, bruno] = await createTestUsers(2);
    const anaClient = authenticateAs(ana);
    const brunoClient = authenticateAs(bruno);

    const dm = await openDm(brunoClient, ana.id);
    await rpcOk(anaClient, "decline_invitation", { p_group_id: dm.groupId });

    await rpcOk(anaClient, "block_user", { p_user_id: bruno.id });

    expect(
      await rpcErrorCode(anaClient, "get_or_create_dm", { p_user_id: bruno.id }),
    ).toBe("member_excluded");
    expect(
      await rpcErrorCode(brunoClient, "get_or_create_dm", { p_user_id: ana.id }),
    ).toBe("member_excluded");

    const optOuts = await withPg(async (client) => {
      const result = await client.query<{ user_id: string; other_user_id: string }>(
        "select user_id, other_user_id from public.dm_opt_outs where (user_id, other_user_id) in (($1, $2), ($2, $1))",
        [ana.id, bruno.id],
      );
      return result.rows;
    });
    expect(optOuts).toEqual([{ user_id: ana.id, other_user_id: bruno.id }]);
  });

  it("unblocking does not override an outstanding DM decline", async () => {
    const [ana, bruno] = await createTestUsers(2);
    const anaClient = authenticateAs(ana);
    const brunoClient = authenticateAs(bruno);

    const dm = await openDm(brunoClient, ana.id);
    await rpcOk(anaClient, "decline_invitation", { p_group_id: dm.groupId });

    await rpcOk(anaClient, "block_user", { p_user_id: bruno.id });
    await rpcOk(anaClient, "unblock_user", { p_user_id: bruno.id });

    expect(
      await rpcErrorCode(brunoClient, "get_or_create_dm", { p_user_id: ana.id }),
    ).toBe("member_excluded");

    const optOuts = await withPg(async (client) => {
      const result = await client.query<{ user_id: string; other_user_id: string }>(
        "select user_id, other_user_id from public.dm_opt_outs where user_id = $1 and other_user_id = $2",
        [ana.id, bruno.id],
      );
      return result.rows;
    });
    expect(optOuts).toEqual([{ user_id: ana.id, other_user_id: bruno.id }]);
  });

  it("allows shared group messages and unrelated DMs", async () => {
    const [ana, bruno, carol] = await createTestUsers(3);
    const anaClient = authenticateAs(ana);
    const carolClient = authenticateAs(carol);
    const groupId = await createGroupWithMembers(ana, [bruno, carol], "Grupo aberto");

    await rpcOk(anaClient, "block_user", { p_user_id: bruno.id });

    const sent = await rpcOk<{ id: string }>(anaClient, "send_message", {
      p_client_id: crypto.randomUUID(),
      p_group_id: groupId,
      p_content: "bom dia grupo",
    });
    expect(sent.id).toBeTruthy();

    const dm = await openDm(anaClient, carol.id);
    expect(dm.created).toBe(true);
    await rpcOk(carolClient, "accept_invitation", { p_group_id: dm.groupId });
    await rpcOk(carolClient, "send_message", {
      p_client_id: crypto.randomUUID(),
      p_group_id: dm.groupId,
      p_content: "oi ana",
    });
  });

  it("delivers a group message live to everyone except members who blocked its sender", async () => {
    const [ana, bruno, carol] = await createTestUsers(3);
    const groupId = await createGroupWithMembers(ana, [bruno, carol], "Grupo ao vivo");
    await rpcOk(authenticateAs(ana), "block_user", { p_user_id: bruno.id });

    const sent = await rpcOk<{ id: string }>(authenticateAs(bruno), "send_message", {
      p_client_id: crypto.randomUUID(),
      p_group_id: groupId,
      p_content: "mensagem do bruno",
    });

    const topics = await withPg(async (client) => {
      const result = await client.query<{ topic: string }>(
        "select topic from realtime.messages where event = 'message' and payload->'message'->>'id' = $1",
        [sent.id],
      );
      return result.rows.map((row) => row.topic);
    });
    expect(topics).toContain(`user:${bruno.id}`);
    expect(topics).toContain(`user:${carol.id}`);
    expect(topics).not.toContain(`user:${ana.id}`);
  });
});

describe.skipIf(!isIntegrationTestReady)("blocked contact — invitations", () => {
  it("denies direct invitations and creator reinvites in both directions while an invited-row retry replays", async () => {
    const [ana, bruno] = await createTestUsers(2);
    const anaClient = authenticateAs(ana);
    const brunoClient = authenticateAs(bruno);

    const reinviteGroup = await createGroup(ana, "Reconvite", [bruno.id]);
    await rpcOk(anaClient, "remove_member", {
      p_group_id: reinviteGroup.groupId,
      p_user_id: bruno.id,
    });

    const retryGroup = await createGroup(ana, "Re_tentativa", []);
    await rpcOk(anaClient, "invite_member", {
      p_group_id: retryGroup.groupId,
      p_user_id: bruno.id,
    });

    const brunoGroup = await createGroup(bruno, "Do bruno", []);

    await rpcOk(anaClient, "block_user", { p_user_id: bruno.id });

    expect(
      await rpcErrorCode(anaClient, "invite_member", {
        p_group_id: reinviteGroup.groupId,
        p_user_id: bruno.id,
      }),
    ).toBe("member_excluded");
    const retryAck = await rpcOk<{ eventId: number | null }>(anaClient, "invite_member", {
      p_group_id: retryGroup.groupId,
      p_user_id: bruno.id,
    });
    expect(retryAck.eventId).toBeNull();
    expect(
      await rpcErrorCode(brunoClient, "invite_member", {
        p_group_id: brunoGroup.groupId,
        p_user_id: ana.id,
      }),
    ).toBe("member_excluded");

    const exclusions = await countRows(
      "select count(*)::text as count from public.group_member_exclusions where group_id = $1 and user_id = $2",
      [reinviteGroup.groupId, bruno.id],
    );
    expect(exclusions).toBe(1);

    const invitations = await countRows(
      "select count(*)::text as count from public.group_members where group_id = $1 and user_id = $2",
      [retryGroup.groupId, bruno.id],
    );
    expect(invitations).toBe(1);
  });

  it("returns state errors before the contact refusal", async () => {
    const [ana, bruno] = await createTestUsers(2);
    const anaClient = authenticateAs(ana);
    const groupId = await createGroupWithMembers(ana, [bruno], "Grupo estados");

    await rpcOk(anaClient, "block_user", { p_user_id: bruno.id });

    expect(
      await rpcErrorCode(anaClient, "invite_member", {
        p_group_id: groupId,
        p_user_id: bruno.id,
      }),
    ).toBe("already_member");
    expect(
      await rpcErrorCode(anaClient, "send_nudge", {
        p_group_id: groupId,
        p_user_id: bruno.id,
      }),
    ).toBe("no_debt");
  });

  it("denies blocked create-group member lists atomically", async () => {
    const [ana, bruno, carol] = await createTestUsers(3);
    const anaClient = authenticateAs(ana);
    await rpcOk(anaClient, "block_user", { p_user_id: bruno.id });

    expect(
      await rpcErrorCode(anaClient, "create_group", {
        p_name: "Festa",
        p_member_ids: [carol.id, bruno.id],
      }),
    ).toBe("member_excluded");

    const residue = await withPg(async (client) => {
      const groups = await client.query<{ count: string }>(
        "select count(*)::text as count from public.groups where creator_id = $1 and name = 'Festa'",
        [ana.id],
      );
      const members = await client.query<{ count: string }>(
        "select count(*)::text as count from public.group_members gm join public.groups g on g.id = gm.group_id where g.creator_id = $1 and gm.user_id = any($2::uuid[])",
        [ana.id, [carol.id, bruno.id]],
      );
      const events = await client.query<{ count: string }>(
        "select count(*)::text as count from public.group_events where actor_id = $1 and kind = 'member_invited'",
        [ana.id],
      );
      return {
        groups: Number(groups.rows[0].count),
        members: Number(members.rows[0].count),
        events: Number(events.rows[0].count),
      };
    });
    expect(residue).toEqual({ groups: 0, members: 0, events: 0 });
  });

  it("preserves the 50-member raw-input cap and onboarded lookup rules", async () => {
    const [ana, bruno] = await createTestUsers(2);
    const notOnboarded = await createTestUser({ onboarded: false });
    const anaClient = authenticateAs(ana);
    await rpcOk(anaClient, "block_user", { p_user_id: bruno.id });

    expect(
      await rpcErrorCode(anaClient, "create_group", {
        p_name: "Lotado",
        p_member_ids: Array.from({ length: 51 }, () => crypto.randomUUID()),
      }),
    ).toBe("invalid_argument");

    expect(
      await rpcErrorCode(anaClient, "create_group", {
        p_name: "Sem perfil",
        p_member_ids: [notOnboarded.id],
      }),
    ).toBe("user_not_found");
    expect(
      await rpcErrorCode(anaClient, "create_group", {
        p_name: "Misturado",
        p_member_ids: [bruno.id, notOnboarded.id],
      }),
    ).toBe("user_not_found");

    const groupId = await createGroup(ana, "Convite sem perfil", []);
    expect(
      await rpcErrorCode(anaClient, "invite_member", {
        p_group_id: groupId.groupId,
        p_user_id: notOnboarded.id,
      }),
    ).toBe("user_not_found");
  });
});

describe.skipIf(!isIntegrationTestReady)("blocked contact — nudges", () => {
  it("denies nudges in both directions before emitting an event and allows an unrelated debtor nudge", async () => {
    const [ana, bruno, carol] = await createTestUsers(3);
    const anaClient = authenticateAs(ana);
    const brunoClient = authenticateAs(bruno);

    const anaOwedGroup = await createGroupWithMembers(ana, [bruno], "Grupo nudge ida");
    await createExpense(ana, {
      groupId: anaOwedGroup,
      totalCents: 10000,
      payload: equalSplitPayload([ana.id, bruno.id], 10000),
    });

    const brunoOwedGroup = await createGroupWithMembers(bruno, [ana], "Grupo nudge volta");
    await createExpense(bruno, {
      groupId: brunoOwedGroup,
      totalCents: 12000,
      payload: equalSplitPayload([bruno.id, ana.id], 12000),
    });

    const carolGroup = await createGroupWithMembers(ana, [carol], "Grupo nudge carol");
    await createExpense(ana, {
      groupId: carolGroup,
      totalCents: 5000,
      payload: equalSplitPayload([ana.id, carol.id], 5000),
    });

    await rpcOk(anaClient, "block_user", { p_user_id: bruno.id });

    expect(
      await rpcErrorCode(anaClient, "send_nudge", {
        p_group_id: anaOwedGroup,
        p_user_id: bruno.id,
      }),
    ).toBe("member_excluded");
    expect(
      await rpcErrorCode(brunoClient, "send_nudge", {
        p_group_id: brunoOwedGroup,
        p_user_id: ana.id,
      }),
    ).toBe("member_excluded");

    const nudges = await countRows(
      "select count(*)::text as count from public.group_events where group_id = any($1::uuid[]) and kind = 'nudge'",
      [[anaOwedGroup, brunoOwedGroup]],
    );
    expect(nudges).toBe(0);

    const allowed = await rpcOk<{ eventId: number | null }>(anaClient, "send_nudge", {
      p_group_id: carolGroup,
      p_user_id: carol.id,
    });
    expect(allowed.eventId).not.toBeNull();
  });
});

describe.skipIf(!isIntegrationTestReady)("blocked contact — authorization first", () => {
  it("checks group membership before contact policy", async () => {
    const [ana, bruno, dave] = await createTestUsers(3);
    const groupId = await createGroupWithMembers(ana, [bruno], "Grupo fechado");
    const daveClient = authenticateAs(dave);
    await rpcOk(daveClient, "block_user", { p_user_id: bruno.id });

    expect(
      await rpcErrorCode(daveClient, "invite_member", {
        p_group_id: groupId,
        p_user_id: bruno.id,
      }),
    ).toBe("not_a_member");
    expect(
      await rpcErrorCode(daveClient, "send_message", {
        p_client_id: crypto.randomUUID(),
        p_group_id: groupId,
        p_content: "oi",
      }),
    ).toBe("not_a_member");
    expect(
      await rpcErrorCode(daveClient, "send_nudge", {
        p_group_id: groupId,
        p_user_id: bruno.id,
      }),
    ).toBe("not_a_member");
  });
});

describe.skipIf(!isIntegrationTestReady)("blocked contact — joining paths", () => {
  it.each([
    ["inviter blocks", true],
    ["invitee blocks", false],
  ] as const)("refuses a stale invitation once the pair is blocked (%s)", async (_label, inviterBlocks) => {
    const [ana, bruno] = await createTestUsers(2);
    const { groupId } = await createGroup(ana, "Grupo do convite", [bruno.id]);
    if (inviterBlocks) {
      await rpcOk(authenticateAs(ana), "block_user", { p_user_id: bruno.id });
    } else {
      await rpcOk(authenticateAs(bruno), "block_user", { p_user_id: ana.id });
    }

    expect(
      await rpcErrorCode(authenticateAs(bruno), "accept_invitation", { p_group_id: groupId }),
    ).toBe("member_excluded");
    expect(
      await countRows(
        "select count(*) from group_members where group_id = $1 and user_id = $2 and status = 'invited'",
        [groupId, bruno.id],
      ),
    ).toBe(1);
  });

  it("refuses the blocked person's invite link but not another member's", async () => {
    const [ana, bruno, carol] = await createTestUsers(3);
    const groupId = await createGroupWithMembers(ana, [carol], "Grupo do link");
    const anaLink = await rpcOk<{ token: string }>(authenticateAs(ana), "create_invite_link", {
      p_group_id: groupId,
    });
    await rpcOk(authenticateAs(ana), "block_user", { p_user_id: bruno.id });
    const brunoClient = authenticateAs(bruno);

    expect(await rpcErrorCode(brunoClient, "join_via_link", { p_token: anaLink.token })).toBe(
      "member_excluded",
    );
    expect(
      await countRows("select count(*) from group_invite_links where token = $1 and use_count > 0", [
        anaLink.token,
      ]),
    ).toBe(0);

    const carolLink = await rpcOk<{ token: string }>(authenticateAs(carol), "create_invite_link", {
      p_group_id: groupId,
    });
    await rpcOk(brunoClient, "join_via_link", { p_token: carolLink.token });
    expect(
      await countRows(
        "select count(*) from group_members where group_id = $1 and user_id = $2 and status = 'accepted'",
        [groupId, bruno.id],
      ),
    ).toBe(1);
  });

  it("refuses a guest claim on the blocked person's bill and leaves the guest unclaimed", async () => {
    const [ana, bruno] = await createTestUsers(2);
    const anaClient = authenticateAs(ana);
    const { groupId } = await createGroup(ana, "Grupo do convidado");
    const expense = await createExpense(ana, {
      groupId,
      totalCents: 1000,
      payload: {
        items: [],
        participants: [
          { kind: "user", userId: ana.id },
          { kind: "guest", displayName: "Bruno convidado" },
        ],
        shares: [500, 500],
        payers: [{ participantIndex: 0, amountCents: 1000 }],
        itemAssignments: null,
      },
    });
    const view = await rpcOk<{ participants: Array<{ kind: string; guest: { id: string } | null }> }>(
      anaClient,
      "get_expense",
      { p_expense_id: expense.expenseId },
    );
    const guestId = view.participants.find((entry) => entry.kind === "guest")?.guest?.id;
    const token = await rpcOk<{ token: string }>(anaClient, "create_guest_claim_token", {
      p_guest_id: guestId,
    });
    await rpcOk(authenticateAs(bruno), "block_user", { p_user_id: ana.id });

    expect(await rpcErrorCode(authenticateAs(bruno), "claim_guest", { p_token: token.token })).toBe(
      "member_excluded",
    );
    expect(
      await countRows("select count(*) from guests where id = $1 and claimed_by is not null", [guestId]),
    ).toBe(0);
    expect(
      await countRows("select count(*) from group_members where group_id = $1 and user_id = $2", [
        groupId,
        bruno.id,
      ]),
    ).toBe(0);
  });
});
