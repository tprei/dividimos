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

/**
 * Positive centavos that `callerId` owes `recipientId` for one canonical
 * balance row, or 0 when there is no debt in that direction — including when
 * the recipient owes the caller, the row is settled at zero, the row does not
 * involve both users, or no row exists. Canonical convention: userA < userB,
 * positive amountCents = userA owes userB.
 *
 * Used to gate Pix-key disclosure to a real payable edge.
 */
export function amountCallerOwesRecipient(
  balance: Pick<Balance, "userA" | "userB" | "amountCents"> | null,
  callerId: string,
  recipientId: string,
): number {
  if (!balance) return 0;
  const involvesCaller = balance.userA === callerId || balance.userB === callerId;
  const involvesRecipient = balance.userA === recipientId || balance.userB === recipientId;
  if (!involvesCaller || !involvesRecipient) return 0;
  // positive amountCents = userA owes userB
  const callerOwes = balance.userA === callerId ? balance.amountCents : -balance.amountCents;
  return callerOwes > 0 ? callerOwes : 0;
}
