import type {
  ChatMessage,
  Conversation,
  ExpenseDetail,
  ExpenseSummary,
  ExpensePage,
  PageCursor,
  GroupEvent,
  GroupSnapshot,
} from "@/types/ledger";
import type { ConversationState, ExpenseListState } from "./app-store";
const emptyList: ExpenseListState = { ids: [], cursor: null, complete: false, total: null };

export function upsertSummaries(
  expenses: Record<string, ExpenseSummary>,
  summaries: ExpenseSummary[],
): Record<string, ExpenseSummary> {
  if (summaries.length === 0) return expenses;
  const next = { ...expenses };
  for (const summary of summaries) next[summary.id] = summary;
  return next;
}

function cursorFor(rows: readonly ExpenseSummary[]): PageCursor | null {
  const last = rows[rows.length - 1];
  return last === undefined ? null : { createdAt: last.createdAt, id: last.id };
}

/**
 * Seeds a group's list from a bootstrap snapshot. The snapshot carries no
 * server cursor or total, so the list stays incomplete with an unknown total
 * until a real page reports them.
 */
export function listFromSeed(
  existing: ExpenseListState | undefined,
  seed: ExpenseSummary[],
): ExpenseListState {
  const headIds = seed.map((row) => row.id);
  const head = new Set(headIds);
  const tailIds = (existing?.ids ?? []).filter((id) => !head.has(id));
  return {
    ids: [...headIds, ...tailIds],
    cursor: cursorFor(seed) ?? existing?.cursor ?? null,
    complete: existing?.complete ?? seed.length < 20,
    total: existing?.total ?? null,
  };
}

export function appendPage(
  existing: ExpenseListState | undefined,
  page: ExpensePage,
): ExpenseListState {
  const prev = existing ?? emptyList;
  const known = new Set(prev.ids);
  const fresh = page.expenses.filter((row) => !known.has(row.id)).map((row) => row.id);
  return {
    ids: [...prev.ids, ...fresh],
    // The server's own cursor and completeness, never inferred from the page.
    cursor: page.nextCursor,
    complete: page.complete,
    total: page.total,
  };
}

export function computeGroupOrder(groups: Record<string, GroupSnapshot>): string[] {
  return Object.keys(groups).sort((a, b) => {
    const at = groups[a]?.lastActivityAt ?? "";
    const bt = groups[b]?.lastActivityAt ?? "";
    if (at === bt) return a < b ? -1 : a > b ? 1 : 0;
    return at > bt ? -1 : 1;
  });
}

export function mergeActivity(
  existing: GroupEvent[],
  incoming: GroupEvent[],
): { items: GroupEvent[]; oldestId: number | null } {
  const byId = new Map<number, GroupEvent>();
  for (const row of [...existing, ...incoming]) byId.set(row.id, row);
  const items = [...byId.values()].sort((a, b) => b.id - a.id);
  return { items, oldestId: items.length > 0 ? (items[items.length - 1]?.id ?? null) : null };
}

function compareRows<T extends { createdAt: string; id: string }>(a: T, b: T): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

function byCreatedAtAsc<T extends { createdAt: string }>(a: T, b: T): number {
  if (a.createdAt < b.createdAt) return -1;
  if (a.createdAt > b.createdAt) return 1;
  return 0;
}

/**
 * The one identity reducer for chat rows, shared by sends, head snapshots,
 * broadcasts and older pages. An optimistic row carries its clientId as its
 * id until the server acknowledges it, so rows are keyed by clientId and the
 * authoritative server row always replaces the provisional one.
 */
export function mergeMessages(
  existing: readonly ChatMessage[],
  incoming: readonly ChatMessage[],
): ChatMessage[] {
  const byClientId = new Map<string, ChatMessage>();
  for (const row of existing) byClientId.set(row.clientId, row);
  for (const row of incoming) {
    const held = byClientId.get(row.clientId);
    // A provisional row uses its clientId as id; anything else is server truth.
    const heldIsProvisional = held !== undefined && held.id === held.clientId;
    const incomingIsProvisional = row.id === row.clientId;
    if (held === undefined || heldIsProvisional || !incomingIsProvisional) {
      byClientId.set(row.clientId, row);
    }
  }

  const seenIds = new Set<string>();
  const unique: ChatMessage[] = [];
  for (const row of byClientId.values()) {
    if (seenIds.has(row.id)) continue;
    seenIds.add(row.id);
    unique.push(row);
  }
  return unique.sort(compareRows);
}

function dedupeEvents(rows: GroupEvent[]): GroupEvent[] {
  const byId = new Map<number, GroupEvent>();
  for (const row of rows) byId.set(row.id, row);
  return [...byId.values()].sort(byCreatedAtAsc);
}

/** Rows the caller did not send, ordered oldest first. */
function incomingMessages(messages: readonly ChatMessage[], meId: string | null): ChatMessage[] {
  return meId === null ? [] : messages.filter((row) => row.senderId !== meId);
}

/**
 * The newest incoming message whose entire prefix is known. Without a proven
 * contiguous history the boundary stays null, so acknowledgement cannot claim
 * messages that were never loaded.
 */
export function readableThrough(
  state: Pick<ConversationState, "messages" | "messagesComplete">,
  meId: string | null,
): string | null {
  if (!state.messagesComplete) return null;
  const incoming = incomingMessages(state.messages, meId);
  return incoming.length === 0 ? null : incoming[incoming.length - 1]!.id;
}

export type ConversationMerge =
  | { kind: "head"; envelope: Conversation }
  | { kind: "older"; envelope: Conversation }
  | { kind: "broadcast"; messages: ChatMessage[]; events: GroupEvent[] };

const IDLE_RECONCILE: ConversationState["reconcile"] = {
  status: "idle",
  readableThroughMessageId: null,
};

/** Builds a conversation slice, defaulting to "nothing proven known yet". */
export function conversationState(
  overrides: Partial<ConversationState> = {},
): ConversationState {
  return {
    messages: [],
    events: [],
    messageCursor: null,
    messagesComplete: false,
    eventCursor: null,
    eventsComplete: false,
    readWatermark: null,
    reconcile: IDLE_RECONCILE,
    ...overrides,
  };
}

export function mergeConversation(
  existing: ConversationState | undefined,
  merge: ConversationMerge,
  meId: string | null,
): ConversationState {
  const base: ConversationState = existing ?? {
    messages: [],
    events: [],
    messageCursor: null,
    messagesComplete: false,
    eventCursor: null,
    eventsComplete: false,
    readWatermark: null,
    reconcile: IDLE_RECONCILE,
  };

  if (merge.kind === "broadcast") {
    // A live row never proves anything about history, so cursors and
    // completeness are left exactly as they were.
    const messages = mergeMessages(base.messages, merge.messages);
    const events = dedupeEvents([...base.events, ...merge.events]);
    const next = { ...base, messages, events };
    return {
      ...next,
      reconcile: {
        ...base.reconcile,
        readableThroughMessageId: readableThrough(next, meId),
      },
    };
  }

  const { envelope } = merge;
  const messages = mergeMessages(base.messages, envelope.messages);
  const events = dedupeEvents([...base.events, ...envelope.events]);

  // A head load re-seeds the boundary; an older page extends it. Either way
  // each stream's cursor and completeness come from that stream's own
  // response, never inferred from the other stream.
  const next: ConversationState = {
    messages,
    events,
    messageCursor: envelope.messageCursor,
    messagesComplete: envelope.messagesComplete,
    eventCursor: envelope.eventCursor,
    eventsComplete: envelope.eventsComplete,
    readWatermark: envelope.readWatermark ?? base.readWatermark,
    reconcile: base.reconcile,
  };

  return {
    ...next,
    reconcile: { ...base.reconcile, readableThroughMessageId: readableThrough(next, meId) },
  };
}

export function summaryFromDetail(detail: ExpenseDetail, meId: string | null): ExpenseSummary {
  const { expense, current, participants } = detail;
  const mine = meId === null ? undefined : participants.find((p) => p.kind === "user" && p.user?.id === meId);
  return {
    id: expense.id,
    groupId: expense.groupId,
    creatorId: expense.creatorId,
    status: expense.status,
    occurredOn: expense.occurredOn,
    createdAt: expense.createdAt,
    versionNo: expense.currentVersionNo,
    title: current.title,
    merchantName: current.merchantName,
    expenseType: current.expenseType,
    totalCents: current.totalCents,
    myShareCents: mine?.shareCents ?? 0,
    myPaidCents: mine?.paidCents ?? 0,
    participantCount: participants.length,
  };
}

export function renameInLists(
  expenseLists: Record<string, ExpenseListState>,
  oldId: string,
  newId: string,
): Record<string, ExpenseListState> {
  let changed = false;
  const next: Record<string, ExpenseListState> = {};
  for (const [groupId, list] of Object.entries(expenseLists)) {
    if (list.ids.includes(oldId)) {
      changed = true;
      next[groupId] = { ...list, ids: list.ids.map((id) => (id === oldId ? newId : id)) };
    } else {
      next[groupId] = list;
    }
  }
  return changed ? next : expenseLists;
}

export function renameDetail(detail: ExpenseDetail, newId: string): ExpenseDetail {
  return {
    ...detail,
    expense: { ...detail.expense, id: newId },
    current: { ...detail.current, expenseId: newId },
    versions: detail.versions.map((version) => ({ ...version, expenseId: newId })),
  };
}
