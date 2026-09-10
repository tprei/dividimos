import { transfersFromBalances } from "@/lib/ledger/transfers";
import type { AppState } from "@/stores/app-store";
import type { GroupSnapshot, MemberStatus, ParticipantKind } from "@/types/ledger";

export interface DebtRow {
  groupId: string;
  groupName: string;
  isDm: boolean;
  counterpartyKind: ParticipantKind;
  counterpartyId: string;
  counterpartyName: string;
  counterpartyAvatarUrl: string | null;
  amountCents: number;
  direction: "owes" | "owed";
}

interface Counterparty {
  kind: ParticipantKind;
  name: string;
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
        avatarUrl: member.user.avatarUrl,
        status: member.status,
      };
    }
  }
  for (const guest of snapshot.guests) {
    if (guest.id === participantId) {
      return { kind: "guest", name: guest.displayName, avatarUrl: null, status: null };
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
