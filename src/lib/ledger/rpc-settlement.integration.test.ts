import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isIntegrationTestReady } from "@/test/integration-setup";
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
  "settlement RPCs — record / confirm / void lifecycle",
  () => {
    // A paid 6000 split equally with B, so B owes A 3000. C is a member of
    // the group but not a party to the settlement; outsider never joins.
    let a: TestUser;
    let b: TestUser;
    let c: TestUser;
    let outsider: TestUser;
    let clientA: SupabaseClient;
    let clientB: SupabaseClient;
    let clientC: SupabaseClient;
    let clientOutsider: SupabaseClient;
    let groupId: string;
    let operationId: string;
    let settlementId: string;
    let recordAck: SettlementAck;
    let cancelSettlementId: string;

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

      operationId = crypto.randomUUID();
      recordAck = await rpcOk<SettlementAck>(clientB, "record_settlement", {
        p_operation_id: operationId,
        p_group_id: groupId,
        p_to_user_id: a.id,
        p_amount_cents: 3000,
      });
      settlementId = recordAck.settlementId;
    });

    function debtBalances() {
      return [
        { kind: "user", participant_id: a.id, net_cents: 3000 },
        { kind: "user", participant_id: b.id, net_cents: -3000 },
      ].sort((x, y) => x.participant_id.localeCompare(y.participant_id));
    }

    async function readBalances() {
      const rows = await getBalances(groupId);
      return rows.sort((x, y) => x.participant_id.localeCompare(y.participant_id));
    }

    async function pendingSettlements(): Promise<Settlement[]> {
      const snapshot = await rpcOk<{ pendingSettlements: Settlement[] }>(
        clientB,
        "get_group",
        { p_group_id: groupId },
      );
      return snapshot.pendingSettlements;
    }

    it("acks a recorded settlement with the mutation keys", () => {
      expect(Object.keys(recordAck).sort()).toEqual([
        "eventId",
        "groupId",
        "ledgerVersion",
        "settlementId",
      ]);
      expect(recordAck.settlementId).toEqual(expect.any(String));
      expect(recordAck.eventId).toEqual(expect.any(Number));
      expect(typeof recordAck.ledgerVersion).toBe("number");
      expect(recordAck.groupId).toBe(groupId);
    });

    it("leaves balances untouched while the settlement is only pending", async () => {
      expect(await readBalances()).toEqual(debtBalances());
    });

    it("lists the settlement in get_group pending with the exact Settlement keys", async () => {
      const pending = await pendingSettlements();
      expect(pending).toHaveLength(1);
      const settlement = pending[0];
      expect(Object.keys(settlement).sort()).toEqual(SETTLEMENT_KEYS);
      expect(settlement).toMatchObject({
        id: settlementId,
        operationId,
        groupId,
        fromUserId: b.id,
        toUserId: a.id,
        amountCents: 3000,
        status: "pending",
        createdBy: b.id,
        confirmedAt: null,
        voidedAt: null,
        voidedBy: null,
      });
      expect(typeof settlement.createdAt).toBe("string");
    });

    it("replaying the same operation id returns the same settlement and no new event", async () => {
      const ack = await rpcOk<SettlementAck>(clientB, "record_settlement", {
        p_operation_id: operationId,
        p_group_id: groupId,
        p_to_user_id: a.id,
        p_amount_cents: 3000,
      });
      expect(ack.settlementId).toBe(settlementId);
      expect(ack.eventId).toBeNull();
      expect(await pendingSettlements()).toHaveLength(1);
    });

    it("rejects confirmation by the debtor with not_payee", async () => {
      await expect(
        rpcErrorCode(clientB, "confirm_settlement", { p_settlement_id: settlementId }),
      ).resolves.toBe("not_payee");
    });

    it("confirmation nets both sides to zero: balance rows disappear and nothing stays pending", async () => {
      const ack = await rpcOk<SettlementAck>(clientA, "confirm_settlement", {
        p_settlement_id: settlementId,
      });
      expect(ack.settlementId).toBe(settlementId);
      expect(ack.eventId).toEqual(expect.any(Number));
      expect(await getBalances(groupId)).toEqual([]);
      expect(await pendingSettlements()).toEqual([]);
    });

    it("rejects a second confirmation with settlement_not_pending", async () => {
      await expect(
        rpcErrorCode(clientA, "confirm_settlement", { p_settlement_id: settlementId }),
      ).resolves.toBe("settlement_not_pending");
    });

    it("voiding the confirmed settlement restores the debt on both sides", async () => {
      const ack = await rpcOk<SettlementAck>(clientB, "void_settlement", {
        p_settlement_id: settlementId,
      });
      expect(ack.eventId).toEqual(expect.any(Number));
      expect(await readBalances()).toEqual(debtBalances());
      expect(await pendingSettlements()).toEqual([]);
    });

    it("rejects a second void with settlement_voided", async () => {
      await expect(
        rpcErrorCode(clientB, "void_settlement", { p_settlement_id: settlementId }),
      ).resolves.toBe("settlement_voided");
    });

    it("records a second settlement without disturbing the restored balances", async () => {
      const cancelOperationId = crypto.randomUUID();
      const ack = await rpcOk<SettlementAck>(clientB, "record_settlement", {
        p_operation_id: cancelOperationId,
        p_group_id: groupId,
        p_to_user_id: a.id,
        p_amount_cents: 3000,
      });
      cancelSettlementId = ack.settlementId;
      expect(ack.eventId).toEqual(expect.any(Number));
      expect(await readBalances()).toEqual(debtBalances());
      expect(await pendingSettlements()).toHaveLength(1);
    });

    it("rejects a void by a member outside the settlement with not_party", async () => {
      await expect(
        rpcErrorCode(clientC, "void_settlement", { p_settlement_id: cancelSettlementId }),
      ).resolves.toBe("not_party");
    });

    it("cancelling a pending settlement keeps balances unchanged throughout", async () => {
      await rpcOk<SettlementAck>(clientB, "void_settlement", {
        p_settlement_id: cancelSettlementId,
      });
      expect(await readBalances()).toEqual(debtBalances());
      expect(await pendingSettlements()).toEqual([]);
    });

    it("rejects a settlement to a non-member with counterparty_not_member", async () => {
      await expect(
        rpcErrorCode(clientB, "record_settlement", {
          p_operation_id: crypto.randomUUID(),
          p_group_id: groupId,
          p_to_user_id: outsider.id,
          p_amount_cents: 100,
        }),
      ).resolves.toBe("counterparty_not_member");
    });

    it("rejects amount 0 and paying yourself with invalid_argument", async () => {
      await expect(
        rpcErrorCode(clientB, "record_settlement", {
          p_operation_id: crypto.randomUUID(),
          p_group_id: groupId,
          p_to_user_id: a.id,
          p_amount_cents: 0,
        }),
      ).resolves.toBe("invalid_argument");
      await expect(
        rpcErrorCode(clientB, "record_settlement", {
          p_operation_id: crypto.randomUUID(),
          p_group_id: groupId,
          p_to_user_id: b.id,
          p_amount_cents: 3000,
        }),
      ).resolves.toBe("invalid_argument");
    });

    it("rejects a record attempt by a non-member with not_a_member", async () => {
      await expect(
        rpcErrorCode(clientOutsider, "record_settlement", {
          p_operation_id: crypto.randomUUID(),
          p_group_id: groupId,
          p_to_user_id: a.id,
          p_amount_cents: 3000,
        }),
      ).resolves.toBe("not_a_member");
    });

    it("journals the lifecycle in group_events with wasConfirmed on voids", async () => {
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
            "and kind in ('settlement_recorded','settlement_confirmed','settlement_voided') " +
            "order by id",
          [groupId],
        ),
      );
      expect(rows.map((row) => row.kind)).toEqual([
        "settlement_recorded",
        "settlement_confirmed",
        "settlement_voided",
        "settlement_recorded",
        "settlement_voided",
      ]);
      const undo = rows.find(
        (row) => row.kind === "settlement_voided" && row.settlement_id === settlementId,
      );
      expect(undo).toBeDefined();
      expect(undo?.payload.wasConfirmed).toBe(true);
      expect(undo?.actor_id).toBe(b.id);
      expect(undo?.subject_user_id).toBe(a.id);
      const cancel = rows.find(
        (row) =>
          row.kind === "settlement_voided" && row.settlement_id === cancelSettlementId,
      );
      expect(cancel).toBeDefined();
      expect(cancel?.payload.wasConfirmed).toBe(false);
    });
  },
);
