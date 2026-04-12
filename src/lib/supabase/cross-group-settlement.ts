import { createClient } from "@/lib/supabase/client";

export interface GroupDebt {
  groupId: string;
  groupName: string;
  amountCents: number;
}

type BalanceRow = {
  group_id: string;
  user_a: string;
  user_b: string;
  amount_cents: number;
};

type GroupRow = {
  id: string;
  name: string;
};

export async function getGroupDebts(
  userId: string,
  counterpartyId: string,
): Promise<GroupDebt[]> {
  const supabase = createClient();

  const [balancesResult, groupsResult] = await Promise.all([
    supabase
      .from("balances")
      .select("group_id, user_a, user_b, amount_cents")
      .neq("amount_cents", 0)
      .or(`user_a.eq.${userId},user_b.eq.${userId}`),
    supabase.from("groups").select("id, name"),
  ]);

  if (balancesResult.error) {
    throw new Error(`Failed to query balances: ${balancesResult.error.message}`);
  }
  if (groupsResult.error) {
    throw new Error(`Failed to query groups: ${groupsResult.error.message}`);
  }

  const groupNames = new Map<string, string>(
    ((groupsResult.data ?? []) as GroupRow[]).map((g) => [g.id, g.name]),
  );

  const debts: GroupDebt[] = [];

  for (const row of (balancesResult.data ?? []) as BalanceRow[]) {
    const isUserA = row.user_a === userId;
    const isUserB = row.user_b === userId;
    const isCounterpartyA = row.user_a === counterpartyId;
    const isCounterpartyB = row.user_b === counterpartyId;

    const involves =
      (isUserA && isCounterpartyB) || (isUserB && isCounterpartyA);
    if (!involves) continue;

    let amountCents: number;
    if (isUserA) {
      amountCents = -row.amount_cents;
    } else {
      amountCents = row.amount_cents;
    }

    if (amountCents === 0) continue;

    debts.push({
      groupId: row.group_id,
      groupName: groupNames.get(row.group_id) ?? row.group_id,
      amountCents,
    });
  }

  debts.sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents));

  return debts;
}

export async function findLargestDebtGroup(
  userId: string,
  counterpartyId: string,
): Promise<{ groupId: string; amountCents: number } | null> {
  const debts = await getGroupDebts(userId, counterpartyId);
  if (debts.length === 0) return null;
  const largest = debts[0];
  return { groupId: largest.groupId, amountCents: largest.amountCents };
}
