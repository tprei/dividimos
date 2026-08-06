import type { Balance } from "@/types";

/**
 * Per-member net balances relative to a viewer, derived from canonical
 * (user_a < user_b) balance rows. Positive means the member is owed by the
 * viewer ("te deve"); negative means the viewer owes the member ("você deve").
 *
 * The balances table holds the minimized transfer set, so this reflects the
 * canonical obligations, not an intermediate graph.
 */
export function computeMemberNetBalances(
  balances: readonly Balance[],
  userId: string,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const row of balances) {
    if (row.userA === userId) {
      result.set(row.userB, (result.get(row.userB) ?? 0) - row.amountCents);
    } else if (row.userB === userId) {
      result.set(row.userA, (result.get(row.userA) ?? 0) + row.amountCents);
    }
  }
  return result;
}
