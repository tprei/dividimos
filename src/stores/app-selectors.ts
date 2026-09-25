import { transfersFromBalances, transfersInvolving } from "@/lib/ledger/transfers";
import { conversationRow, type ConversationRowData } from "@/lib/conversations";
import type { BalanceRow, ExpenseSummary, GroupSnapshot, Me, Transfer } from "@/types/ledger";
import type { ExpenseListState } from "./app-store";
import type { LedgerErrorCode } from "@/lib/sync/errors";
import type { ResourceReadState } from "./app-store";
import type { AppState, MyDebts } from "./app-store";

export function selectGroup(state: AppState, id: string): GroupSnapshot | null {
  return state.groups[id] ?? null;
}

interface TransfersCacheEntry {
  ledgerVersion: number;
  balances: BalanceRow[];
  transfers: Transfer[];
}

const transfersCache = new Map<string, TransfersCacheEntry>();

export function selectTransfers(state: AppState, groupId: string): Transfer[] {
  const snapshot = state.groups[groupId];
  if (!snapshot) return [];
  const cached = transfersCache.get(groupId);
  if (
    cached &&
    cached.ledgerVersion === snapshot.group.ledgerVersion &&
    cached.balances === snapshot.balances
  ) {
    return cached.transfers;
  }
  const transfers = transfersFromBalances(snapshot.balances);
  transfersCache.set(groupId, {
    ledgerVersion: snapshot.group.ledgerVersion,
    balances: snapshot.balances,
    transfers,
  });
  return transfers;
}

/**
 * Amount of the minimized `fromId → toId` edge, or 0 when a reroute dissolved
 * that pair. Reads through the cached `selectTransfers` so unrelated store
 * updates don't recompute the graph; the still-payable cap is
 * `selectOutstandingCents` in lib/ledger/debt-rows.
 */
export function selectPairEdgeCents(
  state: AppState,
  groupId: string,
  fromId: string,
  toId: string,
): number {
  for (const transfer of selectTransfers(state, groupId)) {
    if (transfer.fromId === fromId && transfer.toId === toId) return transfer.amountCents;
  }
  return 0;
}

interface DebtsCache {
  groups: Record<string, GroupSnapshot>;
  meId: string | null;
  debts: MyDebts[];
}

let debtsCache: DebtsCache | null = null;

export function selectMyDebts(state: AppState): MyDebts[] {
  const meId = state.me?.id ?? null;
  if (debtsCache && debtsCache.groups === state.groups && debtsCache.meId === meId) {
    return debtsCache.debts;
  }
  const debts: MyDebts[] = [];
  if (meId !== null) {
    for (const groupId of state.groupOrder) {
      const snapshot = state.groups[groupId];
      if (!snapshot) continue;
      const { owes, owed } = transfersInvolving(selectTransfers(state, groupId), meId);
      if (owes.length === 0 && owed.length === 0) continue;
      debts.push({ groupId, owes, owed });
    }
  }
  debtsCache = { groups: state.groups, meId, debts };
  return debts;
}

export function selectUnreadTotal(state: AppState): number {
  let total = 0;
  for (const snapshot of Object.values(state.groups)) total += snapshot.unreadCount;
  return total;
}

export function selectExpenseList(state: AppState, groupId: string) {
  const list = state.expenseLists[groupId];
  const summaries = [];
  if (list) {
    for (const id of list.ids) {
      const summary = state.expenses[id];
      if (summary) summaries.push(summary);
    }
  }
  return summaries;
}

interface PendingInvitationsCache {
  groups: Record<string, GroupSnapshot>;
  meId: string | null;
  snapshots: GroupSnapshot[];
}

let pendingInvitationsCache: PendingInvitationsCache | null = null;

export function selectPendingInvitations(state: AppState): GroupSnapshot[] {
  const meId = state.me?.id ?? null;
  if (
    pendingInvitationsCache &&
    pendingInvitationsCache.groups === state.groups &&
    pendingInvitationsCache.meId === meId
  ) {
    return pendingInvitationsCache.snapshots;
  }
  const snapshots: GroupSnapshot[] = [];
  if (meId !== null) {
    for (const groupId of state.groupOrder) {
      const snapshot = state.groups[groupId];
      if (!snapshot || snapshot.group.kind !== "group") continue;
      const member = snapshot.members.find((m) => m.userId === meId);
      if (member?.status !== "invited") continue;
      snapshots.push(snapshot);
    }
  }
  pendingInvitationsCache = { groups: state.groups, meId, snapshots };
  return snapshots;
}

export function findDmGroup(
  state: AppState,
  meId: string,
  counterpartyId: string,
): GroupSnapshot | null {
  for (const groupId of state.groupOrder) {
    const snapshot = state.groups[groupId];
    if (!snapshot || snapshot.group.kind !== "dm") continue;
    const { dmUserA, dmUserB } = snapshot.group;
    if (
      (dmUserA === meId && dmUserB === counterpartyId) ||
      (dmUserA === counterpartyId && dmUserB === meId)
    ) {
      return snapshot;
    }
  }
  return null;
}

/**
 * What the caller's own membership in a DM is, as far as authoritative data
 * shows. Missing or malformed membership is never "accepted": the compose and
 * payment actions depend on this, so an unreadable group must fail closed.
 */
export type DmMembershipView =
  | { status: "loading" }
  | { status: "error"; code: LedgerErrorCode }
  | { status: "absent" }
  | { status: "invited"; invitedBy: string | null }
  | { status: "accepted" };

export function selectDmMembership(
  snapshot: GroupSnapshot | undefined,
  meId: string,
  read: ResourceReadState,
): DmMembershipView {
  if (snapshot === undefined) {
    if (read.status === "error") return { status: "error", code: read.code };
    // Only a completed read can prove the group is genuinely gone.
    return read.status === "ready" ? { status: "absent" } : { status: "loading" };
  }

  const mine = snapshot.members.find((member) => member.userId === meId);
  if (mine === undefined) return { status: "absent" };
  if (mine.status === "accepted") return { status: "accepted" };
  if (mine.status === "invited") {
    return { status: "invited", invitedBy: mine.invitedBy };
  }
  // An unrecognised status is malformed data, not consent.
  return { status: "absent" };
}

/**
 * One history row of the bills screen, named the way the home screen names
 * groups: a DM is labelled with the counterparty, never with its internal name.
 */
export interface MyExpenseRow {
  id: string;
  title: string;
  merchantName: string | null;
  occurredOn: string;
  totalCents: number;
  deleted: boolean;
  groupName: string;
}

interface MyExpenseRowEntry {
  summary: ExpenseSummary;
  snapshot: GroupSnapshot | undefined;
  row: MyExpenseRow;
}

interface MyExpenseRowsCache {
  list: ExpenseListState;
  meId: string | null;
  entries: Map<string, MyExpenseRowEntry>;
  rows: MyExpenseRow[];
}

let myExpenseRowsCache: MyExpenseRowsCache | null = null;

/**
 * Rows for the bills screen in the server's order. Cached per row: a store
 * write that touches no listed expense and none of their groups — another
 * group's refresh, an activity merge, a read transition — keeps the previous
 * array identity so the screen does not re-render.
 */
export function selectMyExpenseRows(state: AppState): MyExpenseRow[] {
  const meId = state.me?.id ?? null;
  const cache = myExpenseRowsCache;
  if (cache !== null && cache.list === state.myExpenses && cache.meId === meId) {
    let unchanged = true;
    for (const entry of cache.entries.values()) {
      if (
        state.expenses[entry.summary.id] !== entry.summary ||
        state.groups[entry.summary.groupId] !== entry.snapshot
      ) {
        unchanged = false;
        break;
      }
    }
    if (unchanged) return cache.rows;
  }
  const entries = new Map<string, MyExpenseRowEntry>();
  const rows: MyExpenseRow[] = [];
  if (meId !== null) {
    for (const id of state.myExpenses.ids) {
      const summary = state.expenses[id];
      if (summary === undefined) continue;
      const snapshot = state.groups[summary.groupId];
      const reusable =
        cache !== null && cache.meId === meId ? cache.entries.get(id) : undefined;
      const entry =
        reusable && reusable.summary === summary && reusable.snapshot === snapshot
          ? reusable
          : {
              summary,
              snapshot,
              row: {
                id: summary.id,
                title: summary.title,
                merchantName: summary.merchantName,
                occurredOn: summary.occurredOn,
                totalCents: summary.totalCents,
                deleted: summary.status === "deleted",
                groupName: groupNameOf(snapshot, meId),
              },
            };
      entries.set(id, entry);
      rows.push(entry.row);
    }
  }
  const stable =
    cache !== null &&
    cache.meId === meId &&
    cache.rows.length === rows.length &&
    cache.rows.every((row, index) => row === rows[index]);
  myExpenseRowsCache = { list: state.myExpenses, meId, entries, rows: stable ? cache.rows : rows };
  return myExpenseRowsCache.rows;
}

interface ConversationRowEntry {
  snapshot: GroupSnapshot;
  row: ConversationRowData | null;
}

interface ConversationRowsCache {
  meId: string | null;
  groupOrder: string[];
  entries: Map<string, ConversationRowEntry>;
  rows: ConversationRowData[];
}

let conversationRowsCache: ConversationRowsCache | null = null;

/**
 * One row per conversable group, in group order. Rows are cached per group
 * snapshot, so a refresh of one conversation rebuilds only that row and a
 * write that touches no snapshot at all keeps the whole array identity.
 */
export function selectConversationRows(
  state: AppState,
  meId: string | null,
): ConversationRowData[] {
  if (meId === null) return [];
  const cache = conversationRowsCache;
  if (
    cache !== null &&
    cache.meId === meId &&
    cache.groupOrder.length === state.groupOrder.length &&
    cache.groupOrder.every((groupId, index) => {
      if (groupId !== state.groupOrder[index]) return false;
      const entry = cache.entries.get(groupId);
      return entry !== undefined && entry.snapshot === state.groups[groupId];
    })
  ) {
    return cache.rows;
  }
  const entries = new Map<string, ConversationRowEntry>();
  const rows: ConversationRowData[] = [];
  for (const groupId of state.groupOrder) {
    const snapshot = state.groups[groupId];
    if (snapshot === undefined) continue;
    const reusable =
      cache !== null && cache.meId === meId ? cache.entries.get(groupId) : undefined;
    const entry =
      reusable && reusable.snapshot === snapshot
        ? reusable
        : { snapshot, row: conversationRow(snapshot, meId) };
    entries.set(groupId, entry);
    if (entry.row !== null) rows.push(entry.row);
  }
  const stable =
    cache !== null &&
    cache.meId === meId &&
    cache.rows.length === rows.length &&
    cache.rows.every((row, index) => row === rows[index]);
  conversationRowsCache = {
    meId,
    groupOrder: state.groupOrder,
    entries,
    rows: stable ? cache.rows : rows,
  };
  return conversationRowsCache.rows;
}

interface RecentBillsCache {
  list: ExpenseListState;
  expenses: Record<string, ExpenseSummary>;
  groups: Record<string, GroupSnapshot>;
  me: Me | null;
  bills: RecentBillItem[];
}

/**
 * Display date for a bill row: yyyy-mm-dd as dd/mm/yyyy, returned as-is when
 * the string is not a calendar date.
 */
export function formatOccurredOn(occurredOn: string): string {
  const [year, month, day] = occurredOn.split("-");
  if (!year || !month || !day) return occurredOn;
  return `${day}/${month}/${year}`;
}

/**
 * Display name for a group. A DM is shown as the counterparty's name, because
 * "conversa com Ana" is what the user calls it, not the stored group name.
 */
export function groupNameOf(
  snapshot: GroupSnapshot | undefined,
  meId: string,
): string {
  if (!snapshot) return "";
  if (snapshot.group.kind === "dm") {
    const other = snapshot.members.find((m) => m.userId !== meId);
    if (other) return other.user.name;
  }
  return snapshot.group.name;
}

export interface RecentBillItem {
  id: string;
  title: string;
  totalCents: number;
  occurredOn: string;
  groupName: string;
}

export function selectRecentBills(
  state: Pick<AppState, "expenses" | "groups" | "me" | "myExpenses">,
  limit = 3,
): RecentBillItem[] {
  const me = state.me;
  if (!me) return [];
  const result: RecentBillItem[] = [];
  for (const id of state.myExpenses.ids) {
    if (result.length >= limit) break;
    const exp = state.expenses[id];
    if (!exp || exp.status === "deleted") continue;
    result.push({
      id: exp.id,
      title: exp.title,
      totalCents: exp.totalCents,
      occurredOn: formatOccurredOn(exp.occurredOn),
      groupName: groupNameOf(state.groups[exp.groupId], me.id),
    });
  }
  return result;
}

let recentBillsCache: RecentBillsCache | null = null;

/**
 * The home screen's "Contas recentes" section. Cached on the identities it
 * reads, so unrelated writes (activity, reads, conversation merges) keep the
 * previous array and the home screen does not re-render.
 */
export function selectHomeRecentBills(state: AppState): RecentBillItem[] {
  const cache = recentBillsCache;
  if (
    cache !== null &&
    cache.list === state.myExpenses &&
    cache.expenses === state.expenses &&
    cache.groups === state.groups &&
    cache.me === state.me
  ) {
    return cache.bills;
  }
  const bills = selectRecentBills(state, 3);
  recentBillsCache = {
    list: state.myExpenses,
    expenses: state.expenses,
    groups: state.groups,
    me: state.me,
    bills,
  };
  return bills;
}
