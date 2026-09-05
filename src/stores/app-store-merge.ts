import type {
  ChatMessage,
  ExpenseDetail,
  ExpenseSummary,
  GroupEvent,
  GroupSnapshot,
} from "@/types/ledger";
import type { ConversationState, ExpenseListState } from "./app-store";

const emptyList: ExpenseListState = { ids: [], oldestCursor: null, complete: false };

export function upsertSummaries(
  expenses: Record<string, ExpenseSummary>,
  summaries: ExpenseSummary[],
): Record<string, ExpenseSummary> {
  if (summaries.length === 0) return expenses;
  const next = { ...expenses };
  for (const summary of summaries) next[summary.id] = summary;
  return next;
}

/** Newest-first list: snapshot seed becomes the head, the previous tail is preserved and deduped. */
export function listFromSeed(
  existing: ExpenseListState | undefined,
  seed: ExpenseSummary[],
  expenses: Record<string, ExpenseSummary>,
): ExpenseListState {
  const headIds = seed.map((row) => row.id);
  const head = new Set(headIds);
  const tailIds = (existing?.ids ?? []).filter((id) => !head.has(id));
  const ids = [...headIds, ...tailIds];
  const oldest = ids.length > 0 ? expenses[ids[ids.length - 1]]?.createdAt : undefined;
  return {
    ids,
    oldestCursor: oldest ?? existing?.oldestCursor ?? null,
    complete: existing?.complete ?? seed.length < 20,
  };
}

export function appendPage(
  existing: ExpenseListState | undefined,
  page: ExpenseSummary[],
  complete: boolean,
): ExpenseListState {
  const prev = existing ?? emptyList;
  const known = new Set(prev.ids);
  const fresh = page.filter((row) => !known.has(row.id)).map((row) => row.id);
  return {
    ids: [...prev.ids, ...fresh],
    oldestCursor: page.length > 0 ? (page[page.length - 1]?.createdAt ?? prev.oldestCursor) : prev.oldestCursor,
    complete,
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

function byCreatedAtAsc<T extends { createdAt: string }>(a: T, b: T): number {
  if (a.createdAt < b.createdAt) return -1;
  if (a.createdAt > b.createdAt) return 1;
  return 0;
}

function dedupeMessages(rows: ChatMessage[]): ChatMessage[] {
  const byClientId = new Map<string, ChatMessage>();
  for (const row of rows) byClientId.set(row.clientId, row);
  const seenIds = new Set<string>();
  const unique: ChatMessage[] = [];
  for (const row of byClientId.values()) {
    if (seenIds.has(row.id)) continue;
    seenIds.add(row.id);
    unique.push(row);
  }
  return unique.sort(byCreatedAtAsc);
}

function dedupeEvents(rows: GroupEvent[]): GroupEvent[] {
  const byId = new Map<number, GroupEvent>();
  for (const row of rows) byId.set(row.id, row);
  return [...byId.values()].sort(byCreatedAtAsc);
}

function minCreatedAt(messages: ChatMessage[], events: GroupEvent[]): string | null {
  let min: string | null = null;
  for (const row of [...messages, ...events]) {
    if (min === null || row.createdAt < min) min = row.createdAt;
  }
  return min;
}

export function mergeConversation(
  existing: ConversationState | undefined,
  incoming: { messages: ChatMessage[]; events: GroupEvent[] },
  prepend: boolean,
): ConversationState {
  const messages = dedupeMessages([...(existing?.messages ?? []), ...incoming.messages]);
  const events = dedupeEvents([...(existing?.events ?? []), ...incoming.events]);
  const firstLoad = !existing || (existing.messages.length === 0 && existing.events.length === 0);
  const oldestCursor = prepend || firstLoad ? minCreatedAt(messages, events) : existing.oldestCursor;
  return { messages, events, oldestCursor };
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
