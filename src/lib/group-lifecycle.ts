import type { GroupSnapshot } from "@/types/ledger";

export type GroupArchiveAction = "archive" | "unarchive" | "blocked_by_balance";

export function isGroupArchived(snapshot: GroupSnapshot): boolean {
  return snapshot.archivedAt !== null;
}

export function myGroupNetCents(snapshot: GroupSnapshot, meId: string): number {
  const row = snapshot.balances.find(
    (balance) => balance.kind === "user" && balance.participantId === meId,
  );
  return row?.netCents ?? 0;
}

export function groupArchiveAction(
  snapshot: GroupSnapshot,
  meId: string,
): GroupArchiveAction | null {
  const mine = snapshot.members.find((member) => member.userId === meId);
  if (mine?.status !== "accepted") return null;
  if (isGroupArchived(snapshot)) return "unarchive";
  return myGroupNetCents(snapshot, meId) === 0 ? "archive" : "blocked_by_balance";
}

export function canDeleteGroup(snapshot: GroupSnapshot, meId: string): boolean {
  return (
    snapshot.group.creatorId === meId &&
    snapshot.financialHistorySharedAt === null &&
    snapshot.balances.length === 0
  );
}
