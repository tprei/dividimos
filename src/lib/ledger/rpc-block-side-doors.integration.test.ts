import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  acceptInvitation,
  authenticateAs,
  createExpense,
  createGroupWithMembers,
  createTestUsers,
  equalSplitPayload,
  expectRpcError,
  withPg,
} from "@/test/integration-helpers";

const OCCURRED_ON = "2026-09-26";

interface MutationAck {
  groupId: string;
  ledgerVersion: number;
  eventId: number | null;
}

interface InviteLinkAck {
  groupId: string;
  token: string;
  expiresAt: string | null;
  maxUses: number | null;
}

interface WithGroupAck {
  expenseId: string;
  groupId: string;
  versionNo: number;
  ledgerVersion: number;
  eventId: number | null;
}

interface SettlementAck {
  settlementId: string;
  groupId: string;
  ledgerVersion: number;
  eventId: number | null;
}

type RpcResult<T> = { data: T | null; error: { message: string } | null };

async function rpcOk<T>(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown> = {},
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
  args: Record<string, unknown> = {},
): Promise<string> {
  return expectRpcError(Promise.resolve(client.rpc(fn, args)));
}

async function membershipRows(
  groupId: string,
  userId: string,
): Promise<Array<{ status: string }>> {
  return withPg(async (client) => {
    const result = await client.query<{ status: string }>(
      "select status from public.group_members where group_id = $1 and user_id = $2",
      [groupId, userId],
    );
    return result.rows;
  });
}

async function countRows(query: string, params: unknown[]): Promise<number> {
  return withPg(async (client) => {
    const result = await client.query<{ count: string }>(query, params);
    return Number(result.rows[0].count);
  });
}

describe.skipIf(!isIntegrationTestReady)("blocked side doors — join paths, settlements, bulk creation oracle", () => {
  it("denies a link join through another member's invite link when the creator blocks the joiner", async () => {
    const [creator, member, joiner] = await createTestUsers(3);
    const creatorClient = authenticateAs(creator);
    const memberClient = authenticateAs(member);
    const joinerClient = authenticateAs(joiner);

    const groupId = await createGroupWithMembers(creator, [member], "Grupo link");
    await rpcOk(creatorClient, "block_user", { p_user_id: joiner.id });

    const link = await rpcOk<InviteLinkAck>(memberClient, "create_invite_link", {
      p_group_id: groupId,
    });
    expect(
      await rpcErrorCode(joinerClient, "join_via_link", { p_token: link.token }),
    ).toBe("member_excluded");
    expect(await membershipRows(groupId, joiner.id)).toEqual([]);
  });

  it("denies accept_invitation when the creator blocks the invitee, even invited by another member", async () => {
    const [creator, member, invitee] = await createTestUsers(3);
    const creatorClient = authenticateAs(creator);
    const memberClient = authenticateAs(member);
    const inviteeClient = authenticateAs(invitee);

    const groupId = await createGroupWithMembers(creator, [member], "Grupo convite");
    await rpcOk(creatorClient, "block_user", { p_user_id: invitee.id });

    await rpcOk(memberClient, "invite_member", {
      p_group_id: groupId,
      p_user_id: invitee.id,
    });
    expect(
      await rpcErrorCode(inviteeClient, "accept_invitation", { p_group_id: groupId }),
    ).toBe("member_excluded");
    expect(await membershipRows(groupId, invitee.id)).toEqual([
      { status: "invited" },
    ]);
  });

  it("denies a guest claim when the creator blocks the claimer and the expense belongs to another member", async () => {
    const [creator, member, claimer] = await createTestUsers(3);
    const creatorClient = authenticateAs(creator);
    const memberClient = authenticateAs(member);
    const claimerClient = authenticateAs(claimer);

    const groupId = await createGroupWithMembers(creator, [member], "Grupo guest");
    const expense = await createExpense(member, {
      groupId,
      totalCents: 10000,
      payload: {
        items: [],
        participants: [
          { kind: "user", userId: member.id },
          { kind: "guest", displayName: "Cobrador" },
        ],
        shares: [5000, 5000],
        payers: [{ participantIndex: 0, amountCents: 10000 }],
        itemAssignments: null,
      },
    });

    const guestId = await withPg(async (client) => {
      const result = await client.query<{ id: string }>(
        "select id from public.guests where expense_id = $1 order by id limit 1",
        [expense.expenseId],
      );
      return result.rows[0]?.id ?? "";
    });
    expect(guestId).not.toBe("");
    const token = await rpcOk<{ token: string }>(
      memberClient,
      "create_guest_claim_token",
      { p_guest_id: guestId },
    );

    await rpcOk(creatorClient, "block_user", { p_user_id: claimer.id });

    expect(
      await rpcErrorCode(claimerClient, "claim_guest", { p_token: token.token }),
    ).toBe("member_excluded");
    expect(await membershipRows(groupId, claimer.id)).toEqual([]);
  });

  it("refuses an uncapped overpay settlement between a blocked pair in both directions without writing a row", async () => {
    const [creditor, debtor] = await createTestUsers(2);
    const creditorClient = authenticateAs(creditor);
    const debtorClient = authenticateAs(debtor);

    const groupId = await createGroupWithMembers(creditor, [debtor], "Grupo dívida");
    await createExpense(creditor, {
      groupId,
      totalCents: 10000,
      payload: equalSplitPayload([creditor.id, debtor.id], 10000),
    });

    await rpcOk(creditorClient, "block_user", { p_user_id: debtor.id });

    const operationId = crypto.randomUUID();
    const settlementArgs = {
      p_operation_id: operationId,
      p_group_id: groupId,
      p_from_user_id: debtor.id,
      p_to_user_id: creditor.id,
      p_amount_cents: 5000,
      p_allow_overpay: true,
    };
    expect(
      await rpcErrorCode(debtorClient, "record_settlement", settlementArgs),
    ).toBe("member_excluded");
    expect(
      await rpcErrorCode(creditorClient, "record_settlement", {
        ...settlementArgs,
        p_from_user_id: creditor.id,
        p_to_user_id: debtor.id,
      }),
    ).toBe("member_excluded");
    expect(
      await countRows(
        "select count(*)::text as count from public.settlements where operation_id = $1",
        [operationId],
      ),
    ).toBe(0);
  });

  it.each([
    ["the creditor blocks the debtor", true],
    ["the debtor blocks the creditor", false],
  ] as const)("lets the debtor pay down a real debt and leave after %s", async (_label, creditorBlocks) => {
    const [creditor, debtor] = await createTestUsers(2);
    const creditorClient = authenticateAs(creditor);
    const debtorClient = authenticateAs(debtor);

    const groupId = await createGroupWithMembers(creditor, [debtor], "Grupo acerto");
    await createExpense(creditor, {
      groupId,
      totalCents: 10000,
      payload: equalSplitPayload([creditor.id, debtor.id], 10000),
    });

    if (creditorBlocks) {
      await rpcOk(creditorClient, "block_user", { p_user_id: debtor.id });
    } else {
      await rpcOk(debtorClient, "block_user", { p_user_id: creditor.id });
    }

    const settlementArgs = {
      p_operation_id: crypto.randomUUID(),
      p_group_id: groupId,
      p_from_user_id: debtor.id,
      p_to_user_id: creditor.id,
      p_amount_cents: 5000,
      p_allow_overpay: false,
    };
    expect(
      await rpcErrorCode(debtorClient, "record_settlement", { ...settlementArgs, p_amount_cents: 5001 }),
    ).toBe("amount_exceeds_debt");
    await rpcOk<SettlementAck>(debtorClient, "record_settlement", settlementArgs);

    await rpcOk(debtorClient, "leave_group", { p_group_id: groupId });
    expect(await membershipRows(groupId, debtor.id)).toEqual([]);
  });

  it("keeps the idempotent replay of an existing settlement working across a later block", async () => {
    const [creditor, debtor] = await createTestUsers(2);
    const creditorClient = authenticateAs(creditor);
    const debtorClient = authenticateAs(debtor);

    const groupId = await createGroupWithMembers(creditor, [debtor], "Grupo replay");
    await createExpense(creditor, {
      groupId,
      totalCents: 8000,
      payload: equalSplitPayload([creditor.id, debtor.id], 8000),
    });

    const operationId = crypto.randomUUID();
    const settlementArgs = {
      p_operation_id: operationId,
      p_group_id: groupId,
      p_from_user_id: debtor.id,
      p_to_user_id: creditor.id,
      p_amount_cents: 4000,
      p_allow_overpay: false,
    };
    const first = await rpcOk<SettlementAck>(debtorClient, "record_settlement", settlementArgs);
    const second = await rpcOk<SettlementAck>(debtorClient, "record_settlement", settlementArgs);
    expect(second.settlementId).toBe(first.settlementId);
    expect(
      await countRows(
        "select count(*)::text as count from public.settlements where operation_id = $1",
        [operationId],
      ),
    ).toBe(1);

    await rpcOk(creditorClient, "block_user", { p_user_id: debtor.id });
    const replay = await rpcOk<SettlementAck>(debtorClient, "record_settlement", settlementArgs);
    expect(replay.settlementId).toBe(first.settlementId);
    expect(
      await countRows(
        "select count(*)::text as count from public.settlements where operation_id = $1",
        [operationId],
      ),
    ).toBe(1);
  });

  it("answers invalid_payload, not member_excluded, when create_expense_with_group probes a blocker with an invalid payload", async () => {
    const [blocker, prober] = await createTestUsers(2);
    const blockerClient = authenticateAs(blocker);
    const proberClient = authenticateAs(prober);

    await rpcOk(blockerClient, "block_user", { p_user_id: prober.id });

    const clientId = crypto.randomUUID();
    expect(
      await rpcErrorCode(proberClient, "create_expense_with_group", {
        p_client_id: clientId,
        p_group_name: "Grupo sondagem",
        p_member_ids: [blocker.id],
        p_occurred_on: OCCURRED_ON,
        p_title: "Primeira conta",
        p_merchant_name: null,
        p_expense_type: "single_amount",
        p_total_cents: 6000,
        p_service_fee_bps: 0,
        p_fixed_fee_cents: 0,
        p_payload: {},
      }),
    ).toBe("invalid_payload");

    const residue = await withPg(async (client) => {
      const groups = await client.query<{ count: string }>(
        "select count(*)::text as count from public.groups where creator_id = $1 and name = 'Grupo sondagem'",
        [prober.id],
      );
      const expenses = await client.query<{ count: string }>(
        "select count(*)::text as count from public.expenses where client_id = $1",
        [clientId],
      );
      return {
        groups: Number(groups.rows[0].count),
        expenses: Number(expenses.rows[0].count),
      };
    });
    expect(residue).toEqual({ groups: 0, expenses: 0 });
  });

  it("still creates the group and expense for a valid payload naming an unblocked member", async () => {
    const [creator, member] = await createTestUsers(2);
    const creatorClient = authenticateAs(creator);

    const clientId = crypto.randomUUID();
    const ack = await rpcOk<WithGroupAck>(creatorClient, "create_expense_with_group", {
      p_client_id: clientId,
      p_group_name: "Grupo controle",
      p_member_ids: [member.id],
      p_occurred_on: OCCURRED_ON,
      p_title: "Primeira conta",
      p_merchant_name: null,
      p_expense_type: "single_amount",
      p_total_cents: 6000,
      p_service_fee_bps: 0,
      p_fixed_fee_cents: 0,
      p_payload: equalSplitPayload([creator.id, member.id], 6000),
    });
    expect(ack.groupId).toBeTruthy();
    expect(ack.expenseId).toBeTruthy();

    const fact = await withPg(async (client) => {
      const groups = await client.query<{ member_status: string | null }>(
        "select gm.status as member_status from public.groups g " +
          "left join public.group_members gm on gm.group_id = g.id and gm.user_id = $2 " +
          "where g.id = $1",
        [ack.groupId, member.id],
      );
      const expenses = await client.query<{ count: string }>(
        "select count(*)::text as count from public.expenses where id = $1 and group_id = $2",
        [ack.expenseId, ack.groupId],
      );
      return {
        memberStatus: groups.rows[0]?.member_status ?? null,
        expenseCount: Number(expenses.rows[0].count),
      };
    });
    expect(fact.memberStatus).toBe("invited");
    expect(fact.expenseCount).toBe(1);
  });

  it("keeps ordinary third-party invite and link joins working when nobody is blocked", async () => {
    const [creator, inviter, invitee, linkJoiner] = await createTestUsers(4);
    const inviterClient = authenticateAs(inviter);
    const linkJoinerClient = authenticateAs(linkJoiner);

    const groupId = await createGroupWithMembers(creator, [inviter], "Grupo aberto");

    await rpcOk(inviterClient, "invite_member", {
      p_group_id: groupId,
      p_user_id: invitee.id,
    });
    await acceptInvitation(invitee, groupId);

    const link = await rpcOk<InviteLinkAck>(inviterClient, "create_invite_link", {
      p_group_id: groupId,
    });
    const joined = await rpcOk<MutationAck>(linkJoinerClient, "join_via_link", {
      p_token: link.token,
    });
    expect(joined.groupId).toBe(groupId);
    expect(
      (await membershipRows(groupId, invitee.id)).map((row) => row.status),
    ).toEqual(["accepted"]);
    expect(
      (await membershipRows(groupId, linkJoiner.id)).map((row) => row.status),
    ).toEqual(["accepted"]);
  });
});
