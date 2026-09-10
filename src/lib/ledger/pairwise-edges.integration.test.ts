import { beforeAll, describe, expect, it } from "vitest";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createExpense,
  createGroupWithMembers,
  createTestUsers,
  equalSplitPayload,
  type TestUser,
} from "@/test/integration-helpers";
import { netAndMinimize, transfersFromBalances } from "./transfers";
import type { BalanceRow, Transfer } from "@/types/ledger";

interface SnapshotSlice {
  balances: BalanceRow[];
  pairwiseEdges: Transfer[];
}

function netFromEdges(edges: readonly Transfer[]): Record<string, number> {
  const nets: Record<string, number> = {};
  for (const edge of edges) {
    nets[edge.fromId] = (nets[edge.fromId] ?? 0) - edge.amountCents;
    nets[edge.toId] = (nets[edge.toId] ?? 0) + edge.amountCents;
  }
  return nets;
}

describe.skipIf(!isIntegrationTestReady)("group_pairwise_edges", () => {
  let a: TestUser;
  let b: TestUser;
  let c: TestUser;
  let groupId: string;

  beforeAll(async () => {
    [a, b, c] = await createTestUsers(3);
    groupId = await createGroupWithMembers(a, [b, c], "Pairwise");
    await createExpense(a, {
      groupId,
      title: "Jantar",
      totalCents: 9000,
      payload: equalSplitPayload([a.id, b.id, c.id], 9000),
    });
    await createExpense(b, {
      groupId,
      title: "Uber",
      totalCents: 3000,
      payload: equalSplitPayload([b.id, a.id], 3000),
    });
    await createExpense(c, {
      groupId,
      title: "Cinema",
      totalCents: 4000,
      payload: equalSplitPayload([c.id, a.id], 4000),
    });
  });

  async function readSlice(): Promise<SnapshotSlice> {
    const { data, error } = await authenticateAs(a).rpc("get_group" as never, {
      p_group_id: groupId,
    } as never);
    if (error) throw new Error(error.message);
    return data as SnapshotSlice;
  }

  it("nets every unordered pair per expense and reconciles to group balances", async () => {
    const { balances, pairwiseEdges } = await readSlice();
    const byPair = [...pairwiseEdges].sort((x, y) => x.fromId.localeCompare(y.fromId));
    expect(byPair).toEqual(
      [
        { fromKind: "user", fromId: b.id, toId: a.id, amountCents: 1500 },
        { fromKind: "user", fromId: c.id, toId: a.id, amountCents: 1000 },
      ].sort((x, y) => x.fromId.localeCompare(y.fromId)),
    );
    const nets = netFromEdges(pairwiseEdges);
    for (const row of balances) {
      expect(nets[row.participantId] ?? 0).toBe(row.netCents);
    }
    const minimized = netAndMinimize(
      pairwiseEdges.map((edge) => ({
        fromUserId: edge.fromId,
        toUserId: edge.toId,
        amountCents: edge.amountCents,
      })),
    );
    expect(minimized).toEqual(
      transfersFromBalances(balances).map((transfer) => ({
        fromUserId: transfer.fromId,
        toUserId: transfer.toId,
        amountCents: transfer.amountCents,
      })),
    );
  });

  it("applies confirmed settlements to the pair they touch and drops settled pairs", async () => {
    const before = await readSlice();
    const edge = before.pairwiseEdges.find((candidate) => candidate.toId === a.id);
    if (!edge) throw new Error("expected an edge into the actor");
    const { error } = await authenticateAs(a).rpc("record_settlement" as never, {
      p_operation_id: crypto.randomUUID(),
      p_group_id: groupId,
      p_from_user_id: edge.fromId,
      p_to_user_id: edge.toId,
      p_amount_cents: edge.amountCents,
    } as never);
    expect(error).toBeNull();

    const after = await readSlice();
    expect(
      after.pairwiseEdges.some(
        (candidate) =>
          (candidate.fromId === edge.fromId && candidate.toId === edge.toId) ||
          (candidate.fromId === edge.toId && candidate.toId === edge.fromId),
      ),
    ).toBe(false);
    const nets = netFromEdges(after.pairwiseEdges);
    for (const row of after.balances) {
      expect(nets[row.participantId] ?? 0).toBe(row.netCents);
    }
  });
});
