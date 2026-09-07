import { transfersFromBalances, transfersInvolving } from "@/lib/ledger/transfers";
import type { BalanceRow, GroupSnapshot, Settlement, Transfer } from "@/types/ledger";
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

export function selectPendingSettlementsForMe(
  state: AppState,
): Array<{ groupId: string; settlement: Settlement }> {
  const meId = state.me?.id;
  if (!meId) return [];
  const pending: Array<{ groupId: string; settlement: Settlement }> = [];
  for (const groupId of state.groupOrder) {
    const snapshot = state.groups[groupId];
    if (!snapshot) continue;
    for (const settlement of snapshot.pendingSettlements) {
      if (settlement.toUserId === meId) pending.push({ groupId, settlement });
    }
  }
  return pending;
}
