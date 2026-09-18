import { selectDebtRows } from "@/lib/ledger/debt-rows";
import type { AppState } from "@/stores/app-store";

export type HomeMode = "first-use" | "outstanding" | "settled";

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
