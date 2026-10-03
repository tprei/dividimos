import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ExpenseDetail } from "@/types/ledger";
import {
  createTestUsers,
  createGroupWithMembers,
  createExpense,
  equalSplitPayload,
  authenticateAs,
  getBalances,
  expectRpcError,
} from "@/test/integration-helpers";
import { isIntegrationTestReady } from "@/test/integration-setup";
import { assertLedgerInvariantsAfterEach } from "@/test/ledger-invariants";

assertLedgerInvariantsAfterEach();

interface ExpenseContext {
  detail: ExpenseDetail;
  assignmentRoom: unknown;
}

type ParticipantProjection = Array<{
  participantIndex: number;
  kind: string;
  shareCents: number;
  paidCents: number;
  userId: string | null;
}>;

function projectParticipants(detail: ExpenseDetail): ParticipantProjection {
  return detail.participants.map((participant) => ({
    participantIndex: participant.participantIndex,
    kind: participant.kind,
    shareCents: participant.shareCents,
    paidCents: participant.paidCents,
    userId: participant.user?.id ?? null,
  }));
}

async function rpc<T>(
  client: SupabaseClient<Database>,
  name: keyof Database["public"]["Functions"],
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.rpc(name, args as never);
  if (error) {
    throw new Error(error.message);
  }
  return data as T;
}

describe.skipIf(!isIntegrationTestReady)("participants of deleted bills", () => {
  it("keeps every participant with pre-delete shares visible after delete and restores unchanged", async () => {
    const [alice, bob] = await createTestUsers(2);
    const groupId = await createGroupWithMembers(alice, [bob], "Conta apagada");
    const created = await createExpense(alice, {
      groupId,
      title: "Churrasco",
      totalCents: 9000,
      payload: {
        items: [],
        participants: [
          { kind: "user", userId: alice.id },
          { kind: "user", userId: bob.id },
          { kind: "guest", guestId: null, displayName: "Convidado 1" },
        ],
        shares: [3000, 3000, 3000],
        payers: [{ participantIndex: 0, amountCents: 9000 }],
        itemAssignments: null,
      },
    });

    const before = await rpc<ExpenseContext>(
      authenticateAs(alice),
      "get_expense_context",
      { p_expense_id: created.expenseId },
    );
    expect(before.detail.expense.status).toBe("active");
    const projected = projectParticipants(before.detail);
    expect(projected).toEqual([
      { participantIndex: 0, kind: "user", shareCents: 3000, paidCents: 9000, userId: alice.id },
      { participantIndex: 1, kind: "user", shareCents: 3000, paidCents: 0, userId: bob.id },
      { participantIndex: 2, kind: "guest", shareCents: 3000, paidCents: 0, userId: null },
    ]);
    const guestBefore = before.detail.participants[2]?.guest;
    if (!guestBefore) {
      throw new Error("Guest participant missing before delete");
    }

    await rpc(authenticateAs(alice), "delete_expense", { p_expense_id: created.expenseId });

    const afterDeleteForMember = await rpc<ExpenseContext>(
      authenticateAs(bob),
      "get_expense_context",
      { p_expense_id: created.expenseId },
    );
    expect(afterDeleteForMember.detail.expense.status).toBe("deleted");
    expect(projectParticipants(afterDeleteForMember.detail)).toEqual(projected);
    expect(afterDeleteForMember.detail.participants[2]?.guest).toEqual({
      id: guestBefore.id,
      displayName: "Convidado 1",
      claimedBy: null,
      claimLinkGeneration: 0,
    });
    const afterDeleteForDeleter = await rpc<ExpenseContext>(
      authenticateAs(alice),
      "get_expense_context",
      { p_expense_id: created.expenseId },
    );
    expect(projectParticipants(afterDeleteForDeleter.detail)).toEqual(projected);

    await rpc(authenticateAs(alice), "restore_expense", { p_expense_id: created.expenseId });

    const afterRestore = await rpc<ExpenseContext>(
      authenticateAs(bob),
      "get_expense_context",
      { p_expense_id: created.expenseId },
    );
    expect(afterRestore.detail.expense.status).toBe("active");
    expect(projectParticipants(afterRestore.detail)).toEqual(projected);
  });

  it("returns participant balances to zero while the bill stays deleted", async () => {
    const [alice, bob] = await createTestUsers(2);
    const groupId = await createGroupWithMembers(alice, [bob], "Saldo zerado");
    const created = await createExpense(alice, {
      groupId,
      title: "Mercado",
      totalCents: 8000,
      payload: equalSplitPayload([alice.id, bob.id], 8000),
    });

    const netByParticipant: Record<string, number> = Object.fromEntries(
      (await getBalances(groupId)).map((row) => [row.participant_id, row.net_cents]),
    );
    expect(netByParticipant[alice.id]).toBe(4000);
    expect(netByParticipant[bob.id]).toBe(-4000);
    expect(Object.keys(netByParticipant)).toHaveLength(2);

    await rpc(authenticateAs(alice), "delete_expense", { p_expense_id: created.expenseId });
    expect(await getBalances(groupId)).toEqual([]);

    await rpc(authenticateAs(alice), "restore_expense", { p_expense_id: created.expenseId });
  });

  it("denies a non-member read of a deleted bill with not_a_member", async () => {
    const [alice, bob, outsider] = await createTestUsers(3);
    const groupId = await createGroupWithMembers(alice, [bob], "Leitura negada");
    const created = await createExpense(alice, {
      groupId,
      title: "Padaria",
      totalCents: 3000,
      payload: equalSplitPayload([alice.id, bob.id], 3000),
    });

    await rpc(authenticateAs(alice), "delete_expense", { p_expense_id: created.expenseId });

    const code = await expectRpcError(
      authenticateAs(outsider).rpc("get_expense_context", { p_expense_id: created.expenseId }),
    );
    expect(code).toBe("not_a_member");
  });
});
