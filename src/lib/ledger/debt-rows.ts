import { transfersFromBalances } from "@/lib/ledger/transfers";
import type { AppState } from "@/stores/app-store";
import type { BalanceRow, GroupSnapshot, MemberStatus, ParticipantKind } from "@/types/ledger";

export interface DebtRow {
  groupId: string;
  groupName: string;
  isDm: boolean;
  counterpartyKind: ParticipantKind;
  counterpartyId: string;
  counterpartyName: string;
  counterpartyHandle: string | null;
  counterpartyAvatarUrl: string | null;
  amountCents: number;
  direction: "owes" | "owed";
}

interface Counterparty {
  kind: ParticipantKind;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
  status: MemberStatus | null;
}

function resolveCounterparty(
  snapshot: GroupSnapshot,
  participantId: string,
): Counterparty | null {
  for (const member of snapshot.members) {
    if (member.userId === participantId) {
      return {
        kind: "user",
        name: member.user.name,
        handle: member.user.handle,
        avatarUrl: member.user.avatarUrl,
        status: member.status,
      };
    }
  }
  for (const guest of snapshot.guests) {
    if (guest.id === participantId) {
      return { kind: "guest", name: guest.displayName, handle: null, avatarUrl: null, status: null };
    }
  }
  return null;
}

export function debtRowsForGroup(snapshot: GroupSnapshot, meId: string): DebtRow[] {
  const rows: DebtRow[] = [];
  for (const transfer of transfersFromBalances(snapshot.balances)) {
    const direction =
      transfer.fromId === meId ? "owes" : transfer.toId === meId ? "owed" : null;
    if (!direction) continue;

    const counterpartyId = direction === "owes" ? transfer.toId : transfer.fromId;
    const counterparty = resolveCounterparty(snapshot, counterpartyId);
    if (!counterparty || counterparty.status === "invited") continue;

    const isDm = snapshot.group.kind === "dm";
    rows.push({
      groupId: snapshot.group.id,
      groupName: isDm ? counterparty.name : snapshot.group.name,
      isDm,
      counterpartyKind: counterparty.kind,
      counterpartyId,
      counterpartyName: counterparty.name,
      counterpartyHandle: counterparty.handle,
      counterpartyAvatarUrl: counterparty.avatarUrl,
      amountCents: transfer.amountCents,
      direction,
    });
  }
  return rows;
}

interface DebtRowsCache {
  groups: Record<string, GroupSnapshot>;
  meId: string | null;
  rows: DebtRow[];
}

let debtRowsCache: DebtRowsCache | null = null;

export function selectDebtRows(state: AppState): DebtRow[] {
  const meId = state.me?.id ?? null;
  if (debtRowsCache && debtRowsCache.groups === state.groups && debtRowsCache.meId === meId) {
    return debtRowsCache.rows;
  }
  const rows: DebtRow[] = [];
  if (meId !== null) {
    for (const groupId of state.groupOrder) {
      const snapshot = state.groups[groupId];
      if (!snapshot) continue;
      rows.push(...debtRowsForGroup(snapshot, meId));
    }
  }
  debtRowsCache = { groups: state.groups, meId, rows };
  return rows;
}

function userNetCents(balances: readonly BalanceRow[], participantId: string): number {
  for (const row of balances) {
    if (row.kind === "user" && row.participantId === participantId) return row.netCents;
  }
  return 0;
}

/**
 * Amount `fromId` may still pay `toId` in `groupId`: the cap the
 * `record_settlement` RPC derives from the two raw nets, not the minimized
 * pair edge. A reroute can dissolve the greedy edge while both nets still
 * face each other, and only the nets decide whether the debt settled. Like
 * the RPC, only user balances count, so guest counterparties cap at 0.
 */
export function selectOutstandingCents(
  state: AppState,
  groupId: string,
  fromId: string,
  toId: string,
): number {
  const snapshot = state.groups[groupId];
  if (!snapshot) return 0;
  const fromNet = userNetCents(snapshot.balances, fromId);
  const toNet = userNetCents(snapshot.balances, toId);
  if (fromNet >= 0 || toNet <= 0) return 0;
  return Math.min(-fromNet, toNet);
}
