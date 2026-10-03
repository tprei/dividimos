import { selectDebtRows } from "@/lib/ledger/debt-rows";
import { isGroupArchived } from "@/lib/group-lifecycle";
import {
  formatOccurredOn,
  groupNameOf,
  selectHomeRecentBills as selectHistoryBills,
  type RecentBillItem,
} from "@/stores/app-selectors";
import type { AppState } from "@/stores/app-store";
import type { OpenAssignmentRoom } from "@/types/assignment-room";

type HomeMode = "first-use" | "outstanding" | "settled";
let recentCache: {
  groups: AppState["groups"];
  expenses: AppState["expenses"];
  history: AppState["myExpenses"];
  me: AppState["me"];
  rows: RecentBillItem[];
} | null = null;

export function selectHomeRecentBills(state: AppState): RecentBillItem[] {
  const previous = recentCache;
  if (
    previous &&
    previous.groups === state.groups &&
    previous.expenses === state.expenses &&
    previous.history === state.myExpenses &&
    previous.me === state.me
  )
    return previous.rows;

  const rows: RecentBillItem[] = [];
  const seen = new Set<string>();
  if (state.me) {
    const recent = Object.values(state.groups).flatMap(
      (group) =>
        isGroupArchived(group)
          ? []
          : group.recentExpenses.map((expense) => ({ expense, group }))
    );
    recent.sort((a, b) =>
      b.expense.createdAt.localeCompare(a.expense.createdAt)
    );
    for (const { expense, group } of recent) {
      if (rows.length === 3) break;
      if (expense.status === "deleted" || seen.has(expense.id)) continue;
      seen.add(expense.id);
      rows.push({
        id: expense.id,
        title: expense.title,
        totalCents: expense.totalCents,
        occurredOn: formatOccurredOn(expense.occurredOn),
        groupName: groupNameOf(group, state.me.id),
      });
    }
  }
  if (rows.length < 3) {
    for (const bill of selectHistoryBills(state)) {
      if (rows.length === 3) break;
      if (!seen.has(bill.id)) rows.push(bill);
    }
  }
  recentCache = {
    groups: state.groups,
    expenses: state.expenses,
    history: state.myExpenses,
    me: state.me,
    rows,
  };
  return rows;
}

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

export interface OpenRoomCardItem {
  room: OpenAssignmentRoom;
  placeLabel: string;
}

let openRoomsCache: {
  groups: AppState["groups"];
  roomsByGroupId: AppState["openAssignmentRoomsByGroupId"];
  me: AppState["me"];
  blockedUsers: AppState["blockedUsers"];
  items: OpenRoomCardItem[];
} | null = null;

export function selectOpenRoomsFromOthers(state: AppState): OpenRoomCardItem[] {
  const previous = openRoomsCache;
  if (
    previous &&
    previous.groups === state.groups &&
    previous.roomsByGroupId === state.openAssignmentRoomsByGroupId &&
    previous.me === state.me &&
    previous.blockedUsers === state.blockedUsers
  )
    return previous.items;

  const items: OpenRoomCardItem[] = [];
  const meId = state.me?.id;
  if (meId !== undefined) {
    const blockedIds = new Set(state.blockedUsers.map((user) => user.id));
    for (const group of Object.values(state.groups)) {
      if (isGroupArchived(group)) continue;
      const rooms = state.openAssignmentRoomsByGroupId[group.group.id];
      if (rooms === undefined) continue;
      for (const room of rooms) {
        if (room.status !== "open" || room.host.id === meId) continue;
        if (!room.joined && blockedIds.has(room.host.id)) continue;
        items.push({
          room,
          placeLabel: groupNameOf(group, meId),
        });
      }
    }
    items.sort(
      (a, b) =>
        b.room.createdAt.localeCompare(a.room.createdAt) ||
        b.room.id.localeCompare(a.room.id),
    );
  }
  openRoomsCache = {
    groups: state.groups,
    roomsByGroupId: state.openAssignmentRoomsByGroupId,
    me: state.me,
    blockedUsers: state.blockedUsers,
    items,
  };
  return items;
}
