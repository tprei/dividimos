import { beforeAll, describe, expect, it } from "vitest";
import { formatBRL } from "../src/lib/currency";
import type { ValidationResult } from "../src/lib/expense-money";
import {
  decodeBootstrap,
  decodeConversation,
  decodeGroupSnapshot,
} from "../src/lib/ledger/decode";
import { transfersFromBalances } from "../src/lib/ledger/transfers";
import type { BalanceRow, GroupSnapshot, WireIssue } from "../src/types/ledger";
import {
  BOT_SPECS,
  ensureTroupe,
  MAX_ACTIVE_BOT_EXPENSES,
  OWNER_HANDLE,
  pruneOldExpenses,
  type Troupe,
} from "./bots";
import { firstName, note } from "./diary";

let troupe: Troupe;

beforeAll(async () => {
  troupe = await ensureTroupe();
});

function rnd(n: number): number {
  return Math.floor(Math.random() * n);
}

function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}

function formatExpenseTitle(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `Rodada das ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function bot(botId: string): string {
  return firstName(troupe.bots, botId);
}

function must<T>(result: ValidationResult<T, WireIssue>): T {
  if (!result.ok) {
    throw new Error(`Wire decode failed at ${result.issue.path.join(".") || "<root>"}`);
  }
  return result.value;
}

async function snapshotFor(actorId: string): Promise<GroupSnapshot> {
  const client = await troupe.seed.authenticateAs(actorId);
  const { data, error } = await client.rpc("get_group", {
    p_group_id: troupe.groupId,
  });
  if (error) {
    throw new Error(`get_group failed: ${error.message}`);
  }
  return must(decodeGroupSnapshot(data));
}

function netOf(rows: BalanceRow[], participantId: string): number {
  const row = rows.find((r) => r.participantId === participantId);
  return row ? row.netCents : 0;
}

describe("bot troupe", () => {
  it("shows the whole troupe in bootstrap", async () => {
    const client = await troupe.seed.authenticateAs(troupe.bots[0].id);
    const { data, error } = await client.rpc("bootstrap");
    if (error) {
      throw new Error(`bootstrap failed: ${error.message}`);
    }
    const { me, groups } = must(decodeBootstrap(data));
    expect(me.handle).toBe("bot_ana");
    expect(me.isBot).toBe(true);

    const groupSnapshot = groups.find((g) => g.group.id === troupe.groupId);
    expect(groupSnapshot).toBeDefined();
    if (!groupSnapshot) {
      throw new Error(`Group ${troupe.groupId} not found in bootstrap`);
    }

    // The owner joins a group that still owes something (syncOwnerMembership),
    // so the roster is the five bots plus at most one human. Counting every
    // member would break the moment he is invited.
    const botMembers = groupSnapshot.members.filter((member) => member.user.isBot);
    expect(botMembers).toHaveLength(BOT_SPECS.length);
    for (const member of groupSnapshot.members) {
      expect(member.status).toBe("accepted");
    }
    const humans = groupSnapshot.members.length - botMembers.length;
    expect(humans).toBeLessThanOrEqual(1);
    note(
      `All ${botMembers.length} bots showed up in bootstrap, badges on${humans === 1 ? `, with @${OWNER_HANDLE} watching` : ""}`,
    );
  });

  it("creates one to three expenses", async () => {
    const n = 1 + rnd(3);
    for (let i = 0; i < n; i++) {
      const creator = troupe.bots[rnd(troupe.bots.length)];
      const others = troupe.bots.filter((b) => b.id !== creator.id);
      const shuffledOthers = shuffle(others);
      const subsetCount = 1 + rnd(others.length);
      const chosenOthers = shuffledOthers.slice(0, subsetCount);
      const ids = [creator.id, ...chosenOthers.map((b) => b.id)];
      const totalCents = 1000 + rnd(49_001);
      const title = formatExpenseTitle();
      const expense = await troupe.seed.createExpense(troupe.groupId, creator.id, ids, {
        title,
        totalCents,
      });
      expect(expense.versionNo).toBe(1);
      expect(expense.status).toBe("active");
      note(
        `${bot(creator.id)} paid ${formatBRL(totalCents)} for "${title}", split ${ids.length} ways`,
      );
    }
  });

  it("rejects a stale edit", async () => {
    interface ActiveExpenseRow {
      id: string;
      creator_id: string;
    }

    const { data: expenses, error: listError } = await troupe.admin
      .from("expenses")
      .select("id,creator_id")
      .eq("group_id", troupe.groupId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .returns<ActiveExpenseRow[]>();

    if (listError) {
      throw new Error(`Failed to fetch newest active expense: ${listError.message}`);
    }

    let target = expenses?.[0];
    if (!target) {
      const creator = troupe.bots[0];
      const other = troupe.bots[1];
      const fallbackExpense = await troupe.seed.createExpense(
        troupe.groupId,
        creator.id,
        [creator.id, other.id],
        { title: formatExpenseTitle(), totalCents: 2000 },
      );
      target = { id: fallbackExpense.id, creator_id: fallbackExpense.creatorId };
    }

    const detail = await troupe.seed.getExpense(target.creator_id, target.id);
    const current = detail.current;
    const creatorClient = await troupe.seed.authenticateAs(target.creator_id);
    const { error } = await creatorClient.rpc("edit_expense", {
      p_expense_id: target.id,
      p_expected_version_no: 0,
      p_occurred_on: current.occurredOn,
      p_title: current.title,
      p_merchant_name: current.merchantName,
      p_expense_type: current.expenseType,
      p_total_cents: current.totalCents,
      p_service_fee_bps: current.serviceFeeBasisPoints,
      p_fixed_fee_cents: current.fixedFeeCents,
      p_payload: current.payload,
    });
    expect(error?.message).toBe("stale_version");
    note(`${bot(target.creator_id)} tried to edit "${current.title}" with a stale version, rejected`);
  });

  it("round-trips chat messages", async () => {
    const tag = `oi ${process.env.GITHUB_RUN_ID ?? Date.now()}`;
    const id1 = await troupe.seed.sendChatMessage(troupe.groupId, troupe.bots[1].id, `${tag} a`);
    const id2 = await troupe.seed.sendChatMessage(troupe.groupId, troupe.bots[2].id, `${tag} b`);
    const client3 = await troupe.seed.authenticateAs(troupe.bots[3].id);
    const { data, error } = await client3.rpc("get_conversation", {
      p_group_id: troupe.groupId,
    });
    if (error) {
      throw new Error(`get_conversation failed: ${error.message}`);
    }
    const conv = must(decodeConversation(data));
    const msg1 = conv.messages.find((m) => m.id === id1);
    const msg2 = conv.messages.find((m) => m.id === id2);
    expect(msg1).toBeDefined();
    expect(msg2).toBeDefined();
    expect(msg1?.sender.isBot).toBe(true);
    expect(msg2?.sender.isBot).toBe(true);
    note(
      `${bot(troupe.bots[1].id)} and ${bot(troupe.bots[2].id)} chatted, ${bot(troupe.bots[3].id)} read both`,
    );
  });

  it("conserves balances and derives consistent transfers", async () => {
    const snap = await snapshotFor(troupe.bots[0].id);
    const sum = snap.balances.reduce((acc, row) => acc + row.netCents, 0);
    expect(sum).toBe(0);
    note(`Balances sum to zero across ${snap.balances.length} participants`);

    const transfers = transfersFromBalances(snap.balances);
    for (const transfer of transfers) {
      expect(transfer.amountCents).toBeGreaterThan(0);
    }

    for (const row of snap.balances) {
      const outgoing = transfers
        .filter((t) => t.fromId === row.participantId)
        .reduce((acc, t) => acc + t.amountCents, 0);
      const incoming = transfers
        .filter((t) => t.toId === row.participantId)
        .reduce((acc, t) => acc + t.amountCents, 0);
      expect(outgoing - incoming).toBe(-row.netCents);
    }
  });

  it("records one settlement", async () => {
    let snap = await snapshotFor(troupe.bots[0].id);
    let transfers = transfersFromBalances(snap.balances).filter((t) => t.fromKind === "user");

    if (transfers.length === 0) {
      const creator = troupe.bots[0];
      const debtor = troupe.bots[1];
      await troupe.seed.createExpense(troupe.groupId, creator.id, [creator.id, debtor.id], {
        title: formatExpenseTitle(),
        totalCents: 2000,
      });
      snap = await snapshotFor(troupe.bots[0].id);
      transfers = transfersFromBalances(snap.balances).filter((t) => t.fromKind === "user");
    }

    expect(transfers.length).toBeGreaterThan(0);
    const transfer = transfers[0];
    const payer = troupe.bots.find((b) => b.id === transfer.fromId);
    if (!payer) {
      throw new Error(`Bot ${transfer.fromId} not found in troupe`);
    }

    const payerClient = await troupe.seed.authenticateAs(payer.id);
    const { error } = await payerClient.rpc("record_settlement", {
      p_operation_id: crypto.randomUUID(),
      p_group_id: troupe.groupId,
      p_from_user_id: transfer.fromId,
      p_to_user_id: transfer.toId,
      p_amount_cents: transfer.amountCents,
    });
    expect(error).toBeNull();

    const after = await snapshotFor(transfer.fromId);
    expect(netOf(after.balances, transfer.fromId)).toBe(
      netOf(snap.balances, transfer.fromId) + transfer.amountCents,
    );
    expect(netOf(after.balances, transfer.toId)).toBe(
      netOf(snap.balances, transfer.toId) - transfer.amountCents,
    );
    note(
      `${bot(transfer.fromId)} settled ${formatBRL(transfer.amountCents)} with ${bot(transfer.toId)}`,
    );
  });

  it("keeps the ledger bounded", async () => {
    const deleted = await pruneOldExpenses(troupe);

    const { count, error: countError } = await troupe.admin
      .from("expenses")
      .select("id", { count: "exact", head: true })
      .eq("group_id", troupe.groupId)
      .eq("status", "active");
    if (countError) {
      throw new Error(`Failed to count active expenses: ${countError.message}`);
    }

    expect(count ?? 0).toBeLessThanOrEqual(MAX_ACTIVE_BOT_EXPENSES);
    note(`Pruned ${deleted} old expense${deleted === 1 ? "" : "s"}, ${count ?? 0} active`);
  });
});
