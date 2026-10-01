import { describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  createTestUsers,
  authenticateAs,
  createGroup,
  createGroupWithMembers,
  acceptInvitation,
  createExpense,
  equalSplitPayload,
  getBalances,
  withPg,
  expectRpcError,
} from "@/test/integration-helpers";
import { assertLedgerInvariantsAfterEach } from "@/test/ledger-invariants";

assertLedgerInvariantsAfterEach();

interface MutationAck {
  groupId: string;
  ledgerVersion: number;
  eventId: number | null;
}

interface SettlementAck {
  settlementId: string;
  groupId: string;
  ledgerVersion: number;
  eventId: number;
}

async function rpc<T>(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = (await client.rpc(fn, args)) as {
    data: T | null;
    error: { message: string } | null;
  };
  if (error) {
    throw new Error(`RPC ${fn} failed: ${error.message}`);
  }
  return data as T;
}

async function expectError(
  call: PromiseLike<{ error: { message: string } | null }>,
): Promise<string> {
  return expectRpcError(Promise.resolve(call));
}

function userSplitPayload(
  userIds: string[],
  shares: number[],
  payerIndex: number,
  payerAmountCents: number,
): unknown {
  return {
    items: [],
    participants: userIds.map((userId) => ({ kind: "user", userId })),
    shares,
    payers: [{ participantIndex: payerIndex, amountCents: payerAmountCents }],
    itemAssignments: null,
  };
}

function userNet(
  balances: Array<{ kind: string; participant_id: string; net_cents: number }>,
  userId: string,
): number | undefined {
  return balances.find((row) => row.kind === "user" && row.participant_id === userId)?.net_cents;
}

function departureCount(groupId: string, userId: string): Promise<number> {
  return withPg(async (pg) => {
    const { rows } = await pg.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM public.group_member_departures WHERE group_id = $1 AND user_id = $2",
      [groupId, userId],
    );
    return rows[0].count;
  });
}

async function expenseState(
  expenseId: string,
): Promise<{ status: string; deleted_by: string | null; declined_user_ids: string[]; current_version_no: number } | undefined> {
  return withPg(async (pg) => {
    const { rows } = await pg.query<{
      status: string;
      deleted_by: string | null;
      declined_user_ids: string[];
      current_version_no: number;
    }>(
      "SELECT status, deleted_by, declined_user_ids, current_version_no FROM public.expenses WHERE id = $1",
      [expenseId],
    );
    return rows[0];
  });
}

describe.skipIf(!isIntegrationTestReady)(
  "former-member departure guard integration tests",
  () => {
    describe("trap: invitation naming a departed member is declinable again", () => {
      it("declines the payer invitee by converting their slot to a guest instead of voiding the bill", async () => {
        const [mallory, victim, frank] = await createTestUsers(3);
        const { groupId } = await createGroup(mallory, "Armadilha", [victim.id, frank.id]);
        await acceptInvitation(frank, groupId);

        // victim pays frank's entire share: victim +100, frank -100.
        const billWithVictimAsPayer = await createExpense(mallory, {
          groupId,
          totalCents: 100,
          payload: userSplitPayload([mallory.id, victim.id, frank.id], [0, 0, 100], 1, 100),
        });
        // frank pays mallory's entire share, cancelling his own: frank +100, mallory -100.
        await createExpense(mallory, {
          groupId,
          totalCents: 100,
          payload: userSplitPayload([mallory.id, frank.id], [100, 0], 1, 100),
        });
        const before = await getBalances(groupId);
        expect(userNet(before, frank.id)).toBeUndefined();
        expect(userNet(before, victim.id)).toBe(100);
        expect(userNet(before, mallory.id)).toBe(-100);

        await rpc(authenticateAs(frank), "leave_group", { p_group_id: groupId });
        expect(await departureCount(groupId, frank.id)).toBe(1);

        await createExpense(mallory, {
          groupId,
          totalCents: 99999999,
          payload: equalSplitPayload([mallory.id, victim.id], 99999999),
        });

        const ack = await rpc<MutationAck>(authenticateAs(victim), "decline_invitation", {
          p_group_id: groupId,
        });
        expect(ack.groupId).toBe(groupId);

        const victimMembership = await withPg((pg) =>
          pg.query<{ count: number }>(
            "SELECT count(*)::int AS count FROM public.group_members WHERE group_id = $1 AND user_id = $2",
            [groupId, victim.id],
          ),
        );
        expect(victimMembership.rows[0].count).toBe(0);
        const balances = await getBalances(groupId);
        expect(balances.find((row) => row.participant_id === victim.id)).toBeUndefined();
        expect(balances.find((row) => row.participant_id === frank.id)).toBeUndefined();
        expect(userNet(balances, mallory.id)).toBe(49999899);
        expect(
          balances.filter((row) => row.kind === "guest").map((row) => row.net_cents).sort((a, b) => a - b),
        ).toEqual([-49999999, 100]);

        // The payer bill stayed alive: the decliner's slot became a guest,
        // so the departed member's net never moved.
        const payerBill = await expenseState(billWithVictimAsPayer.expenseId);
        expect(payerBill).toMatchObject({ status: "active", current_version_no: 2 });
        const converted = (
          await withPg(async (pg) =>
            pg.query<{
              payload: { participants: Array<{ kind: string; userId?: string; displayName?: string }> };
            }>(
              "select payload from public.expense_versions where expense_id = $1 and version_no = 2",
              [billWithVictimAsPayer.expenseId],
            )
          )
        ).rows[0]?.payload?.participants;
        expect(converted?.[1]?.kind).toBe("guest");
        expect(converted?.[1]?.displayName).toBe(victim.name);
      });
    });

    describe("re-invitation does not disarm the guard", () => {
      it("refuses void, share-raising edit, and new bill until the former member accepts again", async () => {
        const [alice, bob] = await createTestUsers(2);
        const cAlice = authenticateAs(alice);
        const cBob = authenticateAs(bob);
        const groupId = await createGroupWithMembers(alice, [bob], "Guarda reconvite");

        const bill = await createExpense(alice, {
          groupId,
          totalCents: 600,
          payload: equalSplitPayload([alice.id, bob.id], 600),
        });
        const settlement = await rpc<SettlementAck>(cBob, "record_settlement", {
          p_operation_id: crypto.randomUUID(),
          p_group_id: groupId,
          p_from_user_id: bob.id,
          p_to_user_id: alice.id,
          p_amount_cents: 300,
        });
        expect(await getBalances(groupId)).toHaveLength(0);

        await rpc(cBob, "leave_group", { p_group_id: groupId });
        await rpc(cAlice, "invite_member", { p_group_id: groupId, p_user_id: bob.id });

        const voidErr = await expectError(
          cAlice.rpc("void_settlement", { p_settlement_id: settlement.settlementId }),
        );
        expect(voidErr).toBe("former_member_balance");

        const cAliceLoose: SupabaseClient = cAlice;
        const editErr = await expectError(
          cAliceLoose.rpc("edit_expense", {
            p_expense_id: bill.expenseId,
            p_expected_version_no: 1,
            p_occurred_on: new Date().toISOString().slice(0, 10),
            p_title: "Despesa",
            p_merchant_name: null,
            p_expense_type: "single_amount",
            p_total_cents: 600,
            p_service_fee_bps: 0,
            p_fixed_fee_cents: 0,
            p_payload: userSplitPayload([alice.id, bob.id], [0, 600], 0, 600),
          }),
        );
        expect(editErr).toBe("former_member_balance");

        const newBillErr = await expectError(
          cAliceLoose.rpc("create_expense", {
            p_client_id: crypto.randomUUID(),
            p_group_id: groupId,
            p_occurred_on: new Date().toISOString().slice(0, 10),
            p_title: "Despesa",
            p_merchant_name: null,
            p_expense_type: "single_amount",
            p_total_cents: 400,
            p_service_fee_bps: 0,
            p_fixed_fee_cents: 0,
            p_chave_acesso: null,
            p_payload: equalSplitPayload([alice.id, bob.id], 400),
          }),
        );
        expect(newBillErr).toBe("former_member_balance");

        const state = await withPg(async (pg) => {
          const expense = await pg.query<{ status: string; current_version_no: number }>(
            "SELECT status, current_version_no FROM public.expenses WHERE id = $1",
            [bill.expenseId],
          );
          const settled = await pg.query<{ status: string }>(
            "SELECT status::text AS status FROM public.settlements WHERE id = $1",
            [settlement.settlementId],
          );
          return { expense: expense.rows[0], settlement: settled.rows[0] };
        });
        expect(state.expense).toMatchObject({ status: "active", current_version_no: 1 });
        expect(state.settlement).toEqual({ status: "confirmed" });

        await acceptInvitation(bob, groupId);
        const ack = await createExpense(alice, {
          groupId,
          totalCents: 400,
          payload: equalSplitPayload([alice.id, bob.id], 400),
        });
        expect(ack.expenseId).toBeTruthy();
        const balances = await getBalances(groupId);
        expect(userNet(balances, alice.id)).toBe(200);
        expect(userNet(balances, bob.id)).toBe(-200);
      });
    });

    describe("fresh pending invitee decline is unchanged", () => {
      it("keeps the bill active as a guest share with no user row for the decliner", async () => {
        const [creator, invitee] = await createTestUsers(2);
        const { groupId } = await createGroup(creator, "Recusa simples", [invitee.id]);
        const bill = await createExpense(creator, {
          groupId,
          totalCents: 6000,
          payload: equalSplitPayload([creator.id, invitee.id], 6000),
        });
        expect(userNet(await getBalances(groupId), invitee.id)).toBe(-3000);

        const ack = await rpc<MutationAck>(authenticateAs(invitee), "decline_invitation", {
          p_group_id: groupId,
        });
        expect(ack.groupId).toBe(groupId);

        const balances = await getBalances(groupId);
        expect(balances.find((row) => row.participant_id === invitee.id)).toBeUndefined();
        expect(userNet(balances, creator.id)).toBe(3000);
        expect(balances.find((row) => row.kind === "guest")?.net_cents).toBe(-3000);

        const billState = await expenseState(bill.expenseId);
        expect(billState).toMatchObject({ status: "active", current_version_no: 2 });
        const converted = (
          await withPg(async (pg) =>
            pg.query<{
              payload: { participants: Array<{ kind: string; userId?: string; displayName?: string }> };
            }>(
              "select payload from public.expense_versions where expense_id = $1 and version_no = 2",
              [bill.expenseId],
            )
          )
        ).rows[0]?.payload?.participants;
        expect(converted?.[1]?.kind).toBe("guest");
        expect(converted?.[1]?.displayName).toBe(invitee.name);
      });
    });

    describe("payer-decliner with no departed members still voids", () => {
      it("deletes the bill, credits the decliner, and keeps the version untouched", async () => {
        const [owner, payer] = await createTestUsers(2);
        const { groupId } = await createGroup(owner, "Pagante recusa", [payer.id]);
        const bill = await createExpense(owner, {
          groupId,
          totalCents: 2000,
          payload: equalSplitPayload([owner.id, payer.id], 2000, 1),
        });

        const ack = await rpc<MutationAck>(authenticateAs(payer), "decline_invitation", {
          p_group_id: groupId,
        });
        expect(ack.groupId).toBe(groupId);

        expect(await expenseState(bill.expenseId)).toEqual({
          status: "deleted",
          deleted_by: payer.id,
          declined_user_ids: [payer.id],
          current_version_no: 1,
        });
        const payerMembership = await withPg((pg) =>
          pg.query<{ count: number }>(
            "SELECT count(*)::int AS count FROM public.group_members WHERE group_id = $1 AND user_id = $2",
            [groupId, payer.id],
          ),
        );
        expect(payerMembership.rows[0].count).toBe(0);
        expect(await getBalances(groupId)).toHaveLength(0);
      });
    });

    describe("decliner who is themself the protected former member", () => {
      it("reports outstanding_balance and rolls the whole transaction back", async () => {
        const [creator, member] = await createTestUsers(2);
        const cMember = authenticateAs(member);
        const groupId = await createGroupWithMembers(creator, [member], "Recusa protegida");

        const bill = await createExpense(creator, {
          groupId,
          totalCents: 4000,
          payload: equalSplitPayload([creator.id, member.id], 4000),
        });
        await rpc<SettlementAck>(cMember, "record_settlement", {
          p_operation_id: crypto.randomUUID(),
          p_group_id: groupId,
          p_from_user_id: member.id,
          p_to_user_id: creator.id,
          p_amount_cents: 2000,
        });
        expect(await getBalances(groupId)).toHaveLength(0);

        await rpc(cMember, "leave_group", { p_group_id: groupId });
        await rpc(authenticateAs(creator), "invite_member", {
          p_group_id: groupId,
          p_user_id: member.id,
        });

        const err = await expectError(
          authenticateAs(member).rpc("decline_invitation", { p_group_id: groupId }),
        );
        expect(err).toBe("outstanding_balance");

        const state = await withPg(async (pg) => {
          const membership = await pg.query<{ status: string }>(
            "SELECT status::text AS status FROM public.group_members WHERE group_id = $1 AND user_id = $2",
            [groupId, member.id],
          );
          const expense = await pg.query<{ status: string; current_version_no: number }>(
            "SELECT status, current_version_no FROM public.expenses WHERE id = $1",
            [bill.expenseId],
          );
          return { membership: membership.rows[0], expense: expense.rows[0] };
        });
        expect(state.membership).toEqual({ status: "invited" });
        expect(state.expense).toMatchObject({ status: "active", current_version_no: 1 });
        expect(await getBalances(groupId)).toHaveLength(0);
      });
    });

    describe("group_member_departures RLS", () => {
      it("denies anon and authenticated clients direct access", async () => {
        const [user] = await createTestUsers(1);
        const anonClient = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );
        const authedClient = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          {
            global: { headers: { Authorization: `Bearer ${user.accessToken}` } },
            auth: { persistSession: false, autoRefreshToken: false },
          },
        );

        const anonErr = await expectRpcError(
          anonClient.from("group_member_departures").select("*"),
        );
        expect(anonErr).toMatch(/permission denied for table group_member_departures/);

        const authedErr = await expectRpcError(
          authedClient.from("group_member_departures").select("*"),
        );
        expect(authedErr).toMatch(/permission denied for table group_member_departures/);
      });
    });

    describe("departure markers", () => {
      it("are written by leave_group and remove_member and survive re-acceptance", async () => {
        const [creator, leaver, remover, removed] = await createTestUsers(4);
        const cRemover = authenticateAs(remover);

        const leftGroupId = await createGroupWithMembers(creator, [leaver], "Marcador saída");
        await rpc(authenticateAs(leaver), "leave_group", { p_group_id: leftGroupId });
        expect(await departureCount(leftGroupId, leaver.id)).toBe(1);

        await rpc(authenticateAs(creator), "invite_member", {
          p_group_id: leftGroupId,
          p_user_id: leaver.id,
        });
        await acceptInvitation(leaver, leftGroupId);
        expect(await departureCount(leftGroupId, leaver.id)).toBe(1);

        const ack = await createExpense(creator, {
          groupId: leftGroupId,
          totalCents: 2000,
          payload: equalSplitPayload([creator.id, leaver.id], 2000),
        });
        expect(ack.expenseId).toBeTruthy();
        const balances = await getBalances(leftGroupId);
        expect(userNet(balances, creator.id)).toBe(1000);
        expect(userNet(balances, leaver.id)).toBe(-1000);

        const removedGroupId = await createGroupWithMembers(remover, [removed], "Marcador remoção");
        await rpc(cRemover, "remove_member", {
          p_group_id: removedGroupId,
          p_user_id: removed.id,
        });
        expect(await departureCount(removedGroupId, removed.id)).toBe(1);
      });
    });
  },
);
