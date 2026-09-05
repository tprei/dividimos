import {
  decodeConversation,
  decodeExpenseDetail,
  decodeExpenseSummaries,
  decodeGroupEvents,
  decodeGroupSnapshot,
} from "@/lib/ledger/decode";
import { useAppStore } from "@/stores/app-store";
import type { ExpenseSummary, GroupSnapshot } from "@/types/ledger";
import { rpc } from "./client";

const inFlightGroups = new Map<string, Promise<void>>();
const inFlightExpensePages = new Map<string, Promise<void>>();

function refreshStaleDetails(
  groupId: string,
  snapshot: GroupSnapshot,
  prevLedgerVersion: number | null,
): void {
  const versionChanged =
    prevLedgerVersion === null ||
    prevLedgerVersion !== snapshot.group.ledgerVersion;

  const summariesById = new Map<string, ExpenseSummary>();
  for (const exp of snapshot.recentExpenses) {
    summariesById.set(exp.id, exp);
  }

  const details = useAppStore.getState().expenseDetails;
  for (const detail of Object.values(details)) {
    if (detail.expense.groupId !== groupId) continue;

    const summary = summariesById.get(detail.expense.id);
    if (summary) {
      if (
        detail.expense.currentVersionNo !== summary.versionNo ||
        detail.expense.status !== summary.status
      ) {
        void refreshExpense(detail.expense.id);
      }
    } else if (versionChanged) {
      void refreshExpense(detail.expense.id);
    }
  }
}

async function executeRefreshGroup(groupId: string): Promise<void> {
  const prevVersion =
    useAppStore.getState().groups[groupId]?.group.ledgerVersion ?? null;

  const snapshot = await rpc(
    "get_group",
    { p_group_id: groupId },
    decodeGroupSnapshot,
  );

  useAppStore.getState().applyGroup(snapshot);
  refreshStaleDetails(groupId, snapshot, prevVersion);
}

export function refreshGroup(groupId: string): Promise<void> {
  const existing = inFlightGroups.get(groupId);
  if (existing) return existing;

  const task = executeRefreshGroup(groupId).finally(() => {
    inFlightGroups.delete(groupId);
  });

  inFlightGroups.set(groupId, task);
  return task;
}

export async function refreshExpense(expenseId: string): Promise<void> {
  const detail = await rpc(
    "get_expense",
    { p_expense_id: expenseId },
    decodeExpenseDetail,
  );
  useAppStore.getState().applyExpenseDetail(detail);
}

export async function loadMoreExpenses(groupId: string): Promise<void> {
  const list = useAppStore.getState().expenseLists[groupId];
  if (!list || list.complete || inFlightExpensePages.has(groupId)) {
    return;
  }

  const task = (async () => {
    try {
      const page = await rpc(
        "get_group_expenses",
        {
          p_group_id: groupId,
          p_before: list.oldestCursor,
          p_limit: 30,
        },
        decodeExpenseSummaries,
      );
      const complete = page.length < 30;
      useAppStore.getState().applyExpensePage(groupId, page, complete);
    } finally {
      inFlightExpensePages.delete(groupId);
    }
  })();

  inFlightExpensePages.set(groupId, task);
  await task;
}

export async function loadActivity(before?: number): Promise<void> {
  const items = await rpc(
    "get_activity",
    {
      p_before_id: before ?? null,
      p_limit: 50,
    },
    decodeGroupEvents,
  );
  useAppStore.getState().applyActivity(items);
}

export async function loadConversation(
  groupId: string,
  before?: string,
): Promise<void> {
  const data = await rpc(
    "get_conversation",
    {
      p_group_id: groupId,
      p_before: before ?? null,
      p_limit: 50,
    },
    decodeConversation,
  );
  useAppStore.getState().applyConversation(groupId, data, before !== undefined);
}
