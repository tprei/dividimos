import {
  decodeConversation,
  decodeExpenseDetail,
  decodeExpensePage,
  decodeGroupEvents,
  decodeGroupSnapshot,
  decodeChargePage,
} from "@/lib/ledger/decode";
import {
  CHARGES_READ_KEY,
  conversationReadKey,
  expensePageReadKey,
  expenseReadKey,
  MY_EXPENSES_READ_KEY,
  groupReadKey,
  useAppStore,
  type ResourceReadState,
} from "@/stores/app-store";
import type { Conversation, ExpenseSummary, GroupSnapshot, PageCursor } from "@/types/ledger";
import { getAuthGeneration, rpc } from "./client";
import { LedgerError } from "./errors";

const inFlightGroups = new Map<string, Promise<void>>();
const pendingGroups = new Map<string, Promise<void>>();
const inFlightExpensePages = new Map<string, Promise<void>>();
const inFlightExpensePageOwners = new Map<string, symbol>();

interface ReadAttempt {
  generation: number;
  authGeneration: number;
}

const readGenerations = new Map<string, ReadAttempt>();
const ACTIVITY_READ_KEY = "activity";

function setReadState(key: string, read: ResourceReadState): void {
  if (key === ACTIVITY_READ_KEY) {
    useAppStore.getState().setActivityRead(read);
    return;
  }
  useAppStore.getState().setResourceRead(key, read);

}

function beginRead(key: string): ReadAttempt {
  const previous = readGenerations.get(key);
  const attempt: ReadAttempt = {
    generation: (previous?.generation ?? 0) + 1,
    authGeneration: getAuthGeneration(),
  };
  readGenerations.set(key, attempt);
  setReadState(key, { status: "loading" });
  return attempt;
}

function isCurrentRead(key: string, attempt: ReadAttempt): boolean {
  const current = readGenerations.get(key);
  return (
    current?.generation === attempt.generation &&
    current.authGeneration === attempt.authGeneration &&
    getAuthGeneration() === attempt.authGeneration
  );
}

export function invalidateSyncReads(): void {
  readGenerations.clear();
  inFlightGroups.clear();
  pendingGroups.clear();
  inFlightExpensePages.clear();
  inFlightExpensePageOwners.clear();
}

async function trackedRead<T>(
  key: string,
  attempt: ReadAttempt,
  read: () => Promise<T>,
  publish: (value: T) => void,
): Promise<T | null> {
  let value: T;
  try {
    value = await read();
  } catch (error) {
    if (!isCurrentRead(key, attempt)) return null;
    setReadState(key, {
      status: "error",
      code: error instanceof LedgerError ? error.code : "unknown",
    });
    throw error;
  }

  if (!isCurrentRead(key, attempt)) return null;
  publish(value);
  setReadState(key, { status: "ready" });
  return value;
}

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

  const key = groupReadKey(groupId);
  const attempt = beginRead(key);

  const snapshot = await trackedRead(
    key,
    attempt,
    () => rpc("get_group", { p_group_id: groupId }, decodeGroupSnapshot),
    (value) => useAppStore.getState().applyGroup(value),
  );

  if (snapshot === null || !isCurrentRead(key, attempt)) return;
  refreshStaleDetails(groupId, snapshot, prevVersion);
  const conversation = useAppStore.getState().conversations[groupId];
  const loaded = conversation !== undefined && conversation.messages.length > 0;
  if (loaded && prevEventId !== null && snapshot.lastEventId > prevEventId) {
    void loadConversation(groupId);
  }
}

function runGroupRefresh(groupId: string): Promise<void> {
  const task = executeRefreshGroup(groupId).finally(() => {
    if (inFlightGroups.get(groupId) !== task) return;
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

  const authGeneration = getAuthGeneration();
  const followUp = current.catch(() => undefined).then(() => {
    if (getAuthGeneration() !== authGeneration) return;
    return runGroupRefresh(groupId);
  });
  pendingGroups.set(groupId, followUp);
  return followUp;
}


export async function refreshExpense(expenseId: string): Promise<void> {
  const key = expenseReadKey(expenseId);
  const attempt = beginRead(key);
  await trackedRead(
    key,
    attempt,
    () => rpc("get_expense", { p_expense_id: expenseId }, decodeExpenseDetail),
    (detail) => useAppStore.getState().applyExpenseDetail(detail),
  );
}

export async function loadMoreExpenses(groupId: string): Promise<void> {
  const list = useAppStore.getState().expenseLists[groupId];
  if (!list || list.complete || inFlightExpensePages.has(groupId)) {
    return;
  }
  const before = list.cursor;
  if (before === null) {
    return;
  }

  const key = expensePageReadKey(groupId);
  const attempt = beginRead(key);
  const owner = Symbol("expense_page");

  const task = (async () => {
    try {
      await trackedRead(
        key,
        attempt,
        () =>
          rpc(
            "get_group_expenses",
            {
              p_group_id: groupId,
              p_before_created_at: before.createdAt,
              p_before_id: before.id,
              p_limit: 30,
            },
            decodeExpensePage,
          ),
        (page) => useAppStore.getState().applyExpensePage(groupId, page),
      );
    } finally {
      if (inFlightExpensePageOwners.get(groupId) === owner) {
        inFlightExpensePages.delete(groupId);
        inFlightExpensePageOwners.delete(groupId);
      }
    }
  })();

  inFlightExpensePages.set(groupId, task);
  inFlightExpensePageOwners.set(groupId, owner);
  await task;
}

/**
 * Cross-group history for the bills screen. Without a cursor this reseeds the
 * list from the newest page; with one it appends the next older page.
 */
export async function loadMyExpenses(cursor?: PageCursor): Promise<void> {
  const attempt = beginRead(MY_EXPENSES_READ_KEY);
  await trackedRead(
    MY_EXPENSES_READ_KEY,
    attempt,
    () =>
      rpc(
        "get_my_expenses",
        {
          p_before_created_at: cursor?.createdAt ?? null,
          p_before_id: cursor?.id ?? null,
          p_limit: 50,
        },
        decodeExpensePage,
      ),
    (page) => useAppStore.getState().applyMyExpensePage(page, cursor === undefined),
  );
}

const ACTIVITY_PAGE_SIZE = 50;

export async function loadActivity(before?: number): Promise<void> {
  const attempt = beginRead(ACTIVITY_READ_KEY);
  await trackedRead(
    ACTIVITY_READ_KEY,
    attempt,
    () =>
      rpc(
        "get_activity",
        {
          p_before_id: before ?? Number.MAX_SAFE_INTEGER,
          p_limit: ACTIVITY_PAGE_SIZE,
        },
        decodeGroupEvents,
      ),
    (items) => useAppStore.getState().applyActivity(items, items.length < ACTIVITY_PAGE_SIZE),
  );
}

export interface ConversationPageCursors {
  messageBefore: PageCursor | null;
  eventBefore: PageCursor | null;
}

/**
 * Loads the newest page when no cursors are given, or the page strictly older
 * than each stream's cursor. Each stream is paged independently: exhausting
 * one says nothing about the other.
 */
export async function loadConversation(
  groupId: string,
  cursors?: ConversationPageCursors,
): Promise<Conversation | null> {
  const key = conversationReadKey(groupId);
  const attempt = beginRead(key);
  return await trackedRead(
    key,
    attempt,
    () =>
      rpc(
        "get_conversation",
        {
          p_group_id: groupId,
          p_message_before_created_at: cursors?.messageBefore?.createdAt ?? null,
          p_message_before_id: cursors?.messageBefore?.id ?? null,
          p_event_before_created_at: cursors?.eventBefore?.createdAt ?? null,
          p_event_before_id:
            cursors?.eventBefore === undefined || cursors.eventBefore === null
              ? null
              : Number(cursors.eventBefore.id),
          p_limit: 50,
        },
        decodeConversation,
      ),
    (data) =>
      useAppStore
        .getState()
        .applyConversation(groupId, {
          kind: cursors === undefined ? "head" : "older",
          envelope: data,
        }),
  );
}

export async function loadVendorCharges(cursor?: PageCursor): Promise<void> {
  const attempt = beginRead(CHARGES_READ_KEY);
  await trackedRead(
    CHARGES_READ_KEY,
    attempt,
    () =>
      rpc(
        "get_vendor_charges",
        {
          p_before_created_at: cursor?.createdAt ?? null,
          p_before_id: cursor?.id ?? null,
          p_limit: 50,
        },
        decodeChargePage,
      ),
    (page) => useAppStore.getState().applyChargePage(page, cursor === undefined),
  );
}
