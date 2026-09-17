import { selectDebtRows } from "@/lib/ledger/debt-rows";
import type { AppState } from "@/stores/app-store";
import type { GroupSnapshot } from "@/types/ledger";

type HomeMode = "first-use" | "outstanding" | "settled";

export function selectHomeMode(state: AppState): HomeMode {
  const rows = selectDebtRows(state);
  if (rows.length > 0) {
    return "outstanding";
  }

  const meId = state.me?.id ?? null;
  let hasAcceptedGroup = false;
  if (meId !== null) {
    for (const snapshot of Object.values(state.groups)) {
      if (!snapshot || snapshot.group.kind !== "group") continue;
      const member = snapshot.members.find((m) => m.userId === meId);
      if (member?.status === "accepted") {
        hasAcceptedGroup = true;
        break;
      }
    }
  }

  const hasLoadedExpenses = state.myExpenses.ids.length > 0;
  if (!hasAcceptedGroup && !hasLoadedExpenses) {
    return "first-use";
  }

  return "settled";
}

export function formatOccurredOn(occurredOn: string): string {
  const [year, month, day] = occurredOn.split("-");
  if (!year || !month || !day) return occurredOn;
  return `${day}/${month}/${year}`;
}

export function groupNameOf(snapshot: GroupSnapshot | undefined, meId: string): string {
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

type RecentBillsState = Pick<AppState, "expenses" | "groups" | "me" | "myExpenses">;

export function selectRecentBills(state: RecentBillsState, limit = 3): RecentBillItem[] {
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
