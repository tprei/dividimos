import type { GroupSnapshot } from "@/types/ledger";

/**
 * Newest activity timestamp across the authoritative group snapshots. Group
 * snapshots already carry `lastActivityAt`, so the badge reads the same data
 * the rest of the app trusts instead of keeping its own copy.
 */
export function newestActivityAt(groups: Record<string, GroupSnapshot>): string | null {
  let newest: string | null = null;
  for (const snapshot of Object.values(groups)) {
    if (newest === null || snapshot.lastActivityAt > newest) {
      newest = snapshot.lastActivityAt;
    }
  }
  return newest;
}

/**
 * Whether this account has activity newer than what it last saw. An account
 * with no recorded view has seen nothing, so any activity is unread.
 */
export function hasUnreadActivity(
  newestAt: string | null,
  viewedAt: string | undefined,
): boolean {
  if (newestAt === null) return false;
  if (viewedAt === undefined) return true;
  return newestAt > viewedAt;
}
