import {
  decodeConversation,
  decodeExpenseDetail,
  decodeExpenseSummaries,
  decodeGroupEvents,
  decodeGroupSnapshot,
  decodeVendorCharges,
} from "@/lib/ledger/decode";
import { useAppStore } from "@/stores/app-store";
import type { ChatCursor, Conversation, ExpenseSummary, GroupSnapshot } from "@/types/ledger";
import { rpc } from "./client";

const inFlightGroups = new Map<string, Promise<void>>();
const pendingGroups = new Map<string, Promise<void>>();
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
  const prev = useAppStore.getState().groups[groupId];
  const prevVersion = prev?.group.ledgerVersion ?? null;
  const prevEventId = prev?.lastEventId ?? null;

  const snapshot = await rpc(
    "get_group",
    { p_group_id: groupId },
    decodeGroupSnapshot,
  );

  useAppStore.getState().applyGroup(snapshot);
  refreshStaleDetails(groupId, snapshot, prevVersion);
  const conversation = useAppStore.getState().conversations[groupId];
  const loaded = conversation !== undefined && conversation.messages.length > 0;
  if (loaded && prevEventId !== null && snapshot.lastEventId > prevEventId) {
    void loadConversation(groupId);
  }
}

function runGroupRefresh(groupId: string): Promise<void> {
  const task = executeRefreshGroup(groupId).finally(() => {
    inFlightGroups.delete(groupId);
    const followUp = pendingGroups.get(groupId);
    if (followUp) {
      pendingGroups.delete(groupId);
      inFlightGroups.set(groupId, followUp);
    }
  });
  inFlightGroups.set(groupId, task);
  return task;
}

export function refreshGroup(groupId: string): Promise<void> {
  const current = inFlightGroups.get(groupId);
  if (!current) return runGroupRefresh(groupId);

  const scheduled = pendingGroups.get(groupId);
  if (scheduled) return scheduled;

  const followUp = current.catch(() => undefined).then(() => runGroupRefresh(groupId));
  pendingGroups.set(groupId, followUp);
  return followUp;
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
  const before = list.oldestCursor;
  if (before === null) {
    return;
  }

  const task = (async () => {
    try {
      const page = await rpc(
        "get_group_expenses",
        {
          p_group_id: groupId,
          p_before: before,
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
      p_before_id: before ?? Number.MAX_SAFE_INTEGER,
      p_limit: 50,
    },
    decodeGroupEvents,
  );
  useAppStore.getState().applyActivity(items);
}

export interface ConversationPageCursors {
  messageBefore: ChatCursor | null;
  eventBefore: ChatCursor | null;
}

/**
 * Loads the newest page when no cursors are given, or the page strictly older
 * than each stream's cursor. Each stream is paged independently: exhausting
 * one says nothing about the other.
 */
export async function loadConversation(
  groupId: string,
  cursors?: ConversationPageCursors,
): Promise<Conversation> {
  const data = await rpc(
    "get_conversation",
    {
      p_group_id: groupId,
      p_message_before_created_at: cursors?.messageBefore?.createdAt ?? null,
      p_message_before_id: cursors?.messageBefore?.id ?? null,
      p_event_before_created_at: cursors?.eventBefore?.createdAt ?? null,
      p_event_before_id: cursors?.eventBefore === undefined || cursors.eventBefore === null
        ? null
        : Number(cursors.eventBefore.id),
      p_limit: 50,
    },
    decodeConversation,
  );
  useAppStore
    .getState()
    .applyConversation(groupId, { kind: cursors === undefined ? "head" : "older", envelope: data });
  return data;
}

export async function loadVendorCharges(limit = 50): Promise<void> {
  const charges = await rpc(
    "get_vendor_charges",
    { p_limit: limit },
    decodeVendorCharges,
  );
  useAppStore.getState().applyVendorCharges(charges);
}
