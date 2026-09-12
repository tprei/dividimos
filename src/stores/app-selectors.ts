import { transfersFromBalances, transfersInvolving } from "@/lib/ledger/transfers";
import type { BalanceRow, GroupSnapshot, Transfer } from "@/types/ledger";
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
