import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isIntegrationTestReady, untrackTestGroup } from "@/test/integration-setup";
import {
  authenticateAs,
  createExpense,
  createGroupWithMembers,
  createTestUsers,
  equalSplitPayload,
  expectRpcError,
  getBalances,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";
import { assertLedgerInvariantsAfterEach } from "@/test/ledger-invariants";

assertLedgerInvariantsAfterEach();

interface SettlementAck {
  settlementId: string;
  groupId: string;
  ledgerVersion: number;
  eventId: number | null;
}

interface Settlement {
  id: string;
  operationId: string;
  groupId: string;
  fromUserId: string;
  toUserId: string;
  amountCents: number;
  status: string;
  createdBy: string;
  createdAt: string;
  confirmedAt: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
}

const SETTLEMENT_KEYS = [
  "amountCents",
  "confirmedAt",
  "createdAt",
  "createdBy",
  "fromUserId",
  "groupId",
  "id",
  "operationId",
  "status",
  "toUserId",
  "voidedAt",
  "voidedBy",
];

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

describe.skipIf(!isIntegrationTestReady)(
  "settlement RPCs — record / void lifecycle",
  () => {
    // A paid 6000 split equally with B, so B owes A 3000. C is a member of
    // the group but not a party to the settlements; outsider never joins.
    let a: TestUser;
    let b: TestUser;
    let c: TestUser;
    let outsider: TestUser;
    let clientA: SupabaseClient;
    let clientB: SupabaseClient;
    let clientC: SupabaseClient;
    let clientOutsider: SupabaseClient;
    let groupId: string;
    let debtorOperationId: string;
    let debtorPaymentId: string;
    let creditorRecordedId: string;

    beforeAll(async () => {
      [a, b, c, outsider] = await createTestUsers(4);
      clientA = authenticateAs(a);
      clientB = authenticateAs(b);
      clientC = authenticateAs(c);
      clientOutsider = authenticateAs(outsider);
      groupId = await createGroupWithMembers(a, [b, c], "Liquidacoes");
      await createExpense(a, {
        groupId,
        title: "Jantar",
        totalCents: 6000,
        payload: equalSplitPayload([a.id, b.id], 6000),
      });
    });

    function owed(expected: number) {
      return [
        { kind: "user", participant_id: a.id, net_cents: expected },
        { kind: "user", participant_id: b.id, net_cents: -expected },
      ].sort((x, y) => x.participant_id.localeCompare(y.participant_id));
    }

    async function readBalances() {
      const rows = await getBalances(groupId);
      return rows.sort((x, y) => x.participant_id.localeCompare(y.participant_id));
    }

    async function activeSettlements(): Promise<Settlement[]> {
      const snapshot = await rpcOk<{ settlements: Settlement[] }>(
        clientB,
        "get_group",
        { p_group_id: groupId },
      );
      return snapshot.settlements;
    }

    function recordArgs(
      operationId: string,
      fromUserId: string,
      toUserId: string,
      amountCents: number,
    ) {
      return {
        p_operation_id: operationId,
        p_group_id: groupId,
        p_from_user_id: fromUserId,
        p_to_user_id: toUserId,
        p_amount_cents: amountCents,
      };
    }

    it("applies the debtor's payment to the balances in the same call", async () => {
      debtorOperationId = crypto.randomUUID();
      const ack = await rpcOk<SettlementAck>(
        clientB,
        "record_settlement",
        recordArgs(debtorOperationId, b.id, a.id, 1000),
      );
      debtorPaymentId = ack.settlementId;
      expect(Object.keys(ack).sort()).toEqual([
        "eventId",
        "groupId",
        "ledgerVersion",
        "settlementId",
      ]);
      expect(ack.eventId).toEqual(expect.any(Number));
      expect(ack.groupId).toBe(groupId);
      expect(await readBalances()).toEqual(owed(2000));
    });

    it("lists the recorded settlement in get_group as confirmed", async () => {
      const settlements = await activeSettlements();
      expect(settlements).toHaveLength(1);
      const settlement = settlements[0];
      expect(Object.keys(settlement).sort()).toEqual(SETTLEMENT_KEYS);
      expect(settlement).toMatchObject({
        id: debtorPaymentId,
        groupId,
        fromUserId: b.id,
        toUserId: a.id,
        amountCents: 1000,
        status: "confirmed",
        createdBy: b.id,
        voidedAt: null,
        voidedBy: null,
      });
      expect(settlement.confirmedAt).toEqual(expect.any(String));
    });

    it("applies a creditor-recorded payment identically", async () => {
      const ack = await rpcOk<SettlementAck>(
        clientA,
        "record_settlement",
        recordArgs(crypto.randomUUID(), b.id, a.id, 500),
      );
      creditorRecordedId = ack.settlementId;
      expect(ack.eventId).toEqual(expect.any(Number));
      expect(await readBalances()).toEqual(owed(1500));
    });

    it("replaying the same operation id returns the same settlement without reapplying", async () => {
      const ack = await rpcOk<SettlementAck>(
        clientA,
        "record_settlement",
        recordArgs(debtorOperationId, b.id, a.id, 1000),
      );
      expect(ack.settlementId).toBe(debtorPaymentId);
      expect(ack.eventId).toBeNull();
      expect(await readBalances()).toEqual(owed(1500));
      expect(await activeSettlements()).toHaveLength(2);
      const { rows } = await withPg((client) =>
        client.query<{ count: number }>(
          "select count(*)::int as count from public.group_events " +
            "where settlement_id = $1 and kind = 'settlement_recorded'",
          [debtorPaymentId],
        ),
      );
      expect(rows[0].count).toBe(1);
    });

    it("rejects a replayed operation id with different fields and invalid_argument", async () => {
      await expect(
        rpcErrorCode(
          clientB,
          "record_settlement",
          recordArgs(debtorOperationId, a.id, b.id, 1000),
        ),
      ).resolves.toBe("invalid_argument");
      await expect(
        rpcErrorCode(
          clientB,
          "record_settlement",
          recordArgs(debtorOperationId, b.id, a.id, 999),
        ),
      ).resolves.toBe("invalid_argument");
      await expect(
        rpcErrorCode(
          clientB,
          "record_settlement",
          recordArgs(debtorOperationId, b.id, c.id, 1000),
        ),
      ).resolves.toBe("invalid_argument");
      expect(await readBalances()).toEqual(owed(1500));
      expect(await activeSettlements()).toHaveLength(2);
    });

    it("rejects paying yourself with invalid_argument", async () => {
      await expect(
        rpcErrorCode(
          clientB,
          "record_settlement",
          recordArgs(crypto.randomUUID(), b.id, b.id, 1000),
        ),
      ).resolves.toBe("invalid_argument");
    });

    it("rejects a third party recording between two members with not_party", async () => {
      await expect(
        rpcErrorCode(
          clientOutsider,
          "record_settlement",
          recordArgs(crypto.randomUUID(), b.id, a.id, 100),
        ),
      ).resolves.toBe("not_party");
      await expect(
        rpcErrorCode(
          clientC,
          "record_settlement",
          recordArgs(crypto.randomUUID(), b.id, a.id, 100),
        ),
      ).resolves.toBe("not_party");
    });

    it("rejects a non-member counterparty with counterparty_not_member", async () => {
      await expect(
        rpcErrorCode(
          clientB,
          "record_settlement",
          recordArgs(crypto.randomUUID(), b.id, outsider.id, 100),
        ),
      ).resolves.toBe("counterparty_not_member");
      await expect(
        rpcErrorCode(
          clientA,
          "record_settlement",
          recordArgs(crypto.randomUUID(), outsider.id, a.id, 100),
        ),
      ).resolves.toBe("counterparty_not_member");
    });

    it("rejects amount 0 with invalid_argument", async () => {
      await expect(
        rpcErrorCode(
          clientB,
          "record_settlement",
          recordArgs(crypto.randomUUID(), b.id, a.id, 0),
        ),
      ).resolves.toBe("invalid_argument");
    });

    it("lets the creditor void and restore the balances exactly", async () => {
      const ack = await rpcOk<SettlementAck>(clientA, "void_settlement", {
        p_settlement_id: creditorRecordedId,
      });
      expect(ack.eventId).toEqual(expect.any(Number));
      expect(await readBalances()).toEqual(owed(2000));
    });

    it("rejects a second void with settlement_voided", async () => {
      await expect(
        rpcErrorCode(clientA, "void_settlement", {
          p_settlement_id: creditorRecordedId,
        }),
      ).resolves.toBe("settlement_voided");
    });

    it("lets the debtor void their own payment and restore the original debt", async () => {
      const ack = await rpcOk<SettlementAck>(clientB, "void_settlement", {
        p_settlement_id: debtorPaymentId,
      });
      expect(ack.eventId).toEqual(expect.any(Number));
      expect(await readBalances()).toEqual(owed(3000));
      expect(await activeSettlements()).toEqual([]);
    });

    it("journals one recorded event per record with the counterparty as subject", async () => {
      const { rows } = await withPg((client) =>
        client.query<{
          kind: string;
          settlement_id: string | null;
          actor_id: string | null;
          subject_user_id: string | null;
          payload: Record<string, unknown>;
        }>(
          "select kind, settlement_id, actor_id, subject_user_id, payload " +
            "from public.group_events where group_id = $1 " +
            "and kind in ('settlement_recorded','settlement_voided') " +
            "order by id",
          [groupId],
        ),
      );
      expect(rows.map((row) => row.kind)).toEqual([
        "settlement_recorded",
        "settlement_recorded",
        "settlement_voided",
        "settlement_voided",
      ]);
      expect(rows.map((row) => row.settlement_id)).toEqual([
        debtorPaymentId,
        creditorRecordedId,
        creditorRecordedId,
        debtorPaymentId,
      ]);
      expect(rows.map((row) => [row.actor_id, row.subject_user_id])).toEqual([
        [b.id, a.id],
        [a.id, b.id],
        [a.id, b.id],
        [b.id, a.id],
      ]);
      for (const row of rows) {
        expect(Object.keys(row.payload).sort()).toEqual([
          "amountCents",
          "fromUserId",
          "toUserId",
        ]);
      }

      const { rows: kinds } = await withPg((client) =>
        client.query<{ kind: string }>(
          "select unnest(enum_range(null::public.event_kind))::text as kind",
        ),
      );
      expect(kinds.map((row) => row.kind)).not.toContain("settlement_confirmed");
    });
  },
);

describe.skipIf(!isIntegrationTestReady)(
  "settlement RPCs — debt bound and membership guards",
  () => {
    // Creditor paid a 6000 expense split with the debtor, so the debtor owes
    // 3000. The bystander is a member with no debt either way.
    let debtor: TestUser;
    let creditor: TestUser;
    let bystander: TestUser;
    let clientDebtor: SupabaseClient;
    let clientCreditor: SupabaseClient;
    let clientBystander: SupabaseClient;
    let groupId: string;
    let partialOperationId: string;
    let partialPaymentId: string;
    let finalPaymentId: string;

    beforeAll(async () => {
      [debtor, creditor, bystander] = await createTestUsers(3);
      clientDebtor = authenticateAs(debtor);
      clientCreditor = authenticateAs(creditor);
      clientBystander = authenticateAs(bystander);
      groupId = await createGroupWithMembers(creditor, [debtor, bystander], "Limites");
      await createExpense(creditor, {
        groupId,
        title: "Churrasco",
        totalCents: 6000,
        payload: equalSplitPayload([debtor.id, creditor.id], 6000, 1),
      });
    });

    function recordArgs(
      operationId: string,
      fromUserId: string,
      toUserId: string,
      amountCents: number,
    ) {
      return {
        p_operation_id: operationId,
        p_group_id: groupId,
        p_from_user_id: fromUserId,
        p_to_user_id: toUserId,
        p_amount_cents: amountCents,
      };
    }

    function owed(expected: number) {
      return [
        { kind: "user", participant_id: creditor.id, net_cents: expected },
        { kind: "user", participant_id: debtor.id, net_cents: -expected },
      ].sort((x, y) => x.participant_id.localeCompare(y.participant_id));
    }

    async function readBalances() {
      const rows = await getBalances(groupId);
      return rows.sort((x, y) => x.participant_id.localeCompare(y.participant_id));
    }

    async function confirmedSettlementCount() {
      const { rows } = await withPg((client) =>
        client.query<{ count: number }>(
          "select count(*)::int as count from public.settlements " +
            "where group_id = $1 and status = 'confirmed'",
          [groupId],
        ),
      );
      return rows[0].count;
    }

    it("rejects recording more than the payer owes with amount_exceeds_debt", async () => {
      await expect(
        rpcErrorCode(
          clientDebtor,
          "record_settlement",
          recordArgs(crypto.randomUUID(), debtor.id, creditor.id, 3001),
        ),
      ).resolves.toBe("amount_exceeds_debt");
      await expect(
        rpcErrorCode(
          clientCreditor,
          "record_settlement",
          recordArgs(crypto.randomUUID(), debtor.id, creditor.id, 99999999),
        ),
      ).resolves.toBe("amount_exceeds_debt");
      expect(await readBalances()).toEqual(owed(3000));
    });

    it("rejects recording between two members with no debt, in both directions", async () => {
      await expect(
        rpcErrorCode(
          clientDebtor,
          "record_settlement",
          recordArgs(crypto.randomUUID(), debtor.id, bystander.id, 1000),
        ),
      ).resolves.toBe("amount_exceeds_debt");
      await expect(
        rpcErrorCode(
          clientBystander,
          "record_settlement",
          recordArgs(crypto.randomUUID(), bystander.id, debtor.id, 1000),
        ),
      ).resolves.toBe("amount_exceeds_debt");
      expect(await readBalances()).toEqual(owed(3000));
    });

    it("records a partial payment and leaves the remainder", async () => {
      partialOperationId = crypto.randomUUID();
      const ack = await rpcOk<SettlementAck>(
        clientDebtor,
        "record_settlement",
        recordArgs(partialOperationId, debtor.id, creditor.id, 1000),
      );
      partialPaymentId = ack.settlementId;
      expect(ack.eventId).toEqual(expect.any(Number));
      expect(await readBalances()).toEqual(owed(2000));
    });

    it("records exactly the owed amount and zeroes the balances", async () => {
      const ack = await rpcOk<SettlementAck>(
        clientDebtor,
        "record_settlement",
        recordArgs(crypto.randomUUID(), debtor.id, creditor.id, 2000),
      );
      finalPaymentId = ack.settlementId;
      expect(await readBalances()).toEqual([]);
    });

    it("rejects replaying a voided operation id with settlement_voided", async () => {
      await rpcOk<SettlementAck>(clientCreditor, "void_settlement", {
        p_settlement_id: partialPaymentId,
      });
      await expect(
        rpcErrorCode(
          clientDebtor,
          "record_settlement",
          recordArgs(partialOperationId, debtor.id, creditor.id, 1000),
        ),
      ).resolves.toBe("settlement_voided");
      expect(await readBalances()).toEqual(owed(1000));
      const { rows } = await withPg((client) =>
        client.query<{ count: number }>(
          "select count(*)::int as count from public.settlements where operation_id = $1",
          [partialOperationId],
        ),
      );
      expect(rows[0].count).toBe(1);
    });

    it("accepts a fresh payment covering the remaining debt after the void", async () => {
      const ack = await rpcOk<SettlementAck>(
        clientDebtor,
        "record_settlement",
        recordArgs(crypto.randomUUID(), debtor.id, creditor.id, 1000),
      );
      finalPaymentId = ack.settlementId;
      expect(await readBalances()).toEqual([]);
    });

    it("lets the creditor void a fabricated payment after the debtor left, restoring the debt", async () => {
      await rpcOk<{ groupId: string }>(clientDebtor, "leave_group", {
        p_group_id: groupId,
      });
      const ack = await rpcOk<SettlementAck>(clientCreditor, "void_settlement", {
        p_settlement_id: finalPaymentId,
      });
      expect(ack.eventId).toEqual(expect.any(Number));
      expect(await readBalances()).toEqual(owed(1000));
      expect(await confirmedSettlementCount()).toBe(1);
    });

    it("rejects a departed party at assert_member with not_a_member", async () => {
      await expect(
        rpcErrorCode(clientDebtor, "void_settlement", {
          p_settlement_id: finalPaymentId,
        }),
      ).resolves.toBe("not_a_member");
      await expect(
        rpcErrorCode(
          clientDebtor,
          "record_settlement",
          recordArgs(crypto.randomUUID(), debtor.id, creditor.id, 1000),
        ),
      ).resolves.toBe("not_a_member");
      expect(await readBalances()).toEqual(owed(1000));
    });

    it("still rejects a second void with settlement_voided after the counterparty left", async () => {
      await expect(
        rpcErrorCode(clientCreditor, "void_settlement", {
          p_settlement_id: finalPaymentId,
        }),
      ).resolves.toBe("settlement_voided");
      expect(await readBalances()).toEqual(owed(1000));
    });

    it("rejects a member who is not a party voiding with not_party", async () => {
      await expect(
        rpcErrorCode(clientBystander, "void_settlement", {
          p_settlement_id: finalPaymentId,
        }),
      ).resolves.toBe("not_party");
      expect(await readBalances()).toEqual(owed(1000));
    });
  },
);

describe.skipIf(!isIntegrationTestReady)(
  "settlement RPCs — group lifecycle guards",
  () => {
    let dmCreator: TestUser;
    let dmCounterparty: TestUser;
    let groupCreator: TestUser;
    let member: TestUser;
    let clientDmCreator: SupabaseClient;
    let clientGroupCreator: SupabaseClient;
    let clientMember: SupabaseClient;
    let dmGroupId: string;

    beforeAll(async () => {
      [dmCreator, dmCounterparty, groupCreator, member] = await createTestUsers(4);
      clientDmCreator = authenticateAs(dmCreator);
      clientGroupCreator = authenticateAs(groupCreator);
      clientMember = authenticateAs(member);
      dmGroupId = (
        await rpcOk<{ groupId: string }>(clientDmCreator, "get_or_create_dm", {
          p_user_id: dmCounterparty.id,
        })
      ).groupId;
    });

    it("rejects evicting the DM counterparty from a dm with cannot_leave_dm", async () => {
      await expect(
        rpcErrorCode(clientDmCreator, "remove_member", {
          p_group_id: dmGroupId,
          p_user_id: dmCounterparty.id,
        }),
      ).resolves.toBe("cannot_leave_dm");
    });

    it("refuses to delete a group that has an expense with group_has_history", async () => {
      const expenseGroupId = await createGroupWithMembers(
        groupCreator,
        [member],
        "Com historico",
      );
      await createExpense(groupCreator, {
        groupId: expenseGroupId,
        title: "Almoco",
        totalCents: 6000,
        payload: equalSplitPayload([groupCreator.id, member.id], 6000),
      });
      await expect(
        rpcErrorCode(clientGroupCreator, "delete_group", {
          p_group_id: expenseGroupId,
        }),
      ).resolves.toBe("outstanding_balance");

      await rpcOk<SettlementAck>(clientMember, "record_settlement", {
        p_operation_id: crypto.randomUUID(),
        p_group_id: expenseGroupId,
        p_from_user_id: member.id,
        p_to_user_id: groupCreator.id,
        p_amount_cents: 3000,
      });
      await expect(
        rpcErrorCode(clientGroupCreator, "delete_group", {
          p_group_id: expenseGroupId,
        }),
      ).resolves.toBe("group_has_history");
    });

    it("refuses to delete a group that has only a settlement with group_has_history", async () => {
      const settledGroupId = await createGroupWithMembers(
        groupCreator,
        [member],
        "So pagamento",
      );
      await createExpense(groupCreator, {
        groupId: settledGroupId,
        title: "Jantar",
        totalCents: 6000,
        payload: equalSplitPayload([groupCreator.id, member.id], 6000),
      });
      await rpcOk<SettlementAck>(clientMember, "record_settlement", {
        p_operation_id: crypto.randomUUID(),
        p_group_id: settledGroupId,
        p_from_user_id: member.id,
        p_to_user_id: groupCreator.id,
        p_amount_cents: 3000,
      });
      await withPg((client) =>
        client.query("delete from public.expenses where group_id = $1", [
          settledGroupId,
        ]),
      );
      // Writing around delete_expense leaves the projection stale on purpose,
      // so the invariant sweep would otherwise fail on this fixture.
      untrackTestGroup(settledGroupId);
      await expect(
        rpcErrorCode(clientGroupCreator, "delete_group", {
          p_group_id: settledGroupId,
        }),
      ).resolves.toBe("group_has_history");
    });

    it("deletes a group that never held money", async () => {
      const emptyGroupId = await createGroupWithMembers(
        groupCreator,
        [member],
        "Vazio",
      );
      const ack = await rpcOk<{ groupId: string }>(
        clientGroupCreator,
        "delete_group",
        { p_group_id: emptyGroupId },
      );
      expect(ack.groupId).toBe(emptyGroupId);
      const { rows } = await withPg((client) =>
        client.query<{ count: number }>(
          "select count(*)::int as count from public.groups where id = $1",
          [emptyGroupId],
        ),
      );
      expect(rows[0].count).toBe(0);
    });
  },
);

describe.skipIf(!isIntegrationTestReady)(
  "settlement RPCs — overpay override (p_allow_overpay)",
  () => {
    let debtor: TestUser;
    let creditor: TestUser;
    let clientDebtor: SupabaseClient;
    let debtGroupId: string;
    let zeroGroupId: string;

    beforeAll(async () => {
      [debtor, creditor] = await createTestUsers(2);
      clientDebtor = authenticateAs(debtor);

      debtGroupId = await createGroupWithMembers(creditor, [debtor], "Overpay");
      await createExpense(creditor, {
        groupId: debtGroupId,
        title: "Almoço",
        totalCents: 6000,
        payload: equalSplitPayload([debtor.id, creditor.id], 6000, 1),
      });

      zeroGroupId = await createGroupWithMembers(creditor, [debtor], "Zerado");
    });

    async function readBalances(groupId: string) {
      const rows = await getBalances(groupId);
      return rows.sort((x, y) => x.participant_id.localeCompare(y.participant_id));
    }

    it("accepts an overpayment and crosses balances past zero", async () => {
      const ack = await rpcOk<SettlementAck>(clientDebtor, "record_settlement", {
        p_operation_id: crypto.randomUUID(),
        p_group_id: debtGroupId,
        p_from_user_id: debtor.id,
        p_to_user_id: creditor.id,
        p_amount_cents: 4000,
        p_allow_overpay: true,
      });
      expect(ack.settlementId).toBeTruthy();

      const balances = await readBalances(debtGroupId);
      const sorted = [
        { kind: "user", participant_id: creditor.id, net_cents: -1000 },
        { kind: "user", participant_id: debtor.id, net_cents: 1000 },
      ].sort((x, y) => x.participant_id.localeCompare(y.participant_id));
      expect(balances).toEqual(sorted);
    });

    it("rejects a zero-balance settlement by default and accepts it with override", async () => {
      await expect(
        rpcErrorCode(clientDebtor, "record_settlement", {
          p_operation_id: crypto.randomUUID(),
          p_group_id: zeroGroupId,
          p_from_user_id: debtor.id,
          p_to_user_id: creditor.id,
          p_amount_cents: 1000,
        }),
      ).resolves.toBe("amount_exceeds_debt");

      const ack = await rpcOk<SettlementAck>(clientDebtor, "record_settlement", {
        p_operation_id: crypto.randomUUID(),
        p_group_id: zeroGroupId,
        p_from_user_id: debtor.id,
        p_to_user_id: creditor.id,
        p_amount_cents: 1000,
        p_allow_overpay: true,
      });
      expect(ack.settlementId).toBeTruthy();
    });

    it("still rejects a zero amount even with override", async () => {
      await expect(
        rpcErrorCode(clientDebtor, "record_settlement", {
          p_operation_id: crypto.randomUUID(),
          p_group_id: debtGroupId,
          p_from_user_id: debtor.id,
          p_to_user_id: creditor.id,
          p_amount_cents: 0,
          p_allow_overpay: true,
        }),
      ).resolves.toBe("invalid_argument");
    });

    it("still rejects a non-member actor even with override", async () => {
      await rpcOk<{ groupId: string }>(clientDebtor, "leave_group", {
        p_group_id: debtGroupId,
      });

      await expect(
        rpcErrorCode(clientDebtor, "record_settlement", {
          p_operation_id: crypto.randomUUID(),
          p_group_id: debtGroupId,
          p_from_user_id: debtor.id,
          p_to_user_id: creditor.id,
          p_amount_cents: 1000,
          p_allow_overpay: true,
        }),
      ).resolves.toBe("not_a_member");
    });
  },
);
