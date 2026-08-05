import { createClient } from "@/lib/supabase/client";
import { queryBalances, querySettlements } from "@/lib/supabase/settlement-actions";
import type { Balance, Settlement, User } from "@/types";

export type GroupFinancialSnapshot = Readonly<{
  balances: Balance[];
  settlements: Settlement[];
  /** Every id appearing in balances, resolved — including members who left. */
  participants: User[];
}>;

export interface LoadGroupFinancesOptions {
  groupId: string;
  knownParticipants: readonly User[];
}

/**
 * Load the one authoritative financial snapshot for a group: balances,
 * settlement history, and participants resolved for every id appearing in a
 * balance row. Unknown ids (e.g. a removed member) fall back to a placeholder
 * so the Acerto cards always show a name.
 *
 * Supabase errors propagate; the caller owns failure handling.
 */
export async function loadGroupFinances(
  options: LoadGroupFinancesOptions,
): Promise<GroupFinancialSnapshot> {
  const { groupId, knownParticipants } = options;

  const [loadedBalances, loadedSettlements] = await Promise.all([
    queryBalances(groupId),
    querySettlements(groupId),
  ]);

  const balanceUserIds = new Set<string>();
  for (const b of loadedBalances) {
    balanceUserIds.add(b.userA);
    balanceUserIds.add(b.userB);
  }

  const knownIds = new Set(knownParticipants.map((p) => p.id));
  const missingIds = [...balanceUserIds].filter((id) => !knownIds.has(id));

  let participants: User[] = [...knownParticipants];

  if (missingIds.length > 0) {
    const supabase = createClient();
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("id, handle, name, avatar_url")
      .in("id", missingIds);

    const extra: User[] = [];
    const fetched = new Set<string>();

    for (const p of profiles ?? []) {
      if (p.id === null || p.name === null || p.handle === null) continue;
      fetched.add(p.id);
      extra.push({
        id: p.id,
        name: p.name,
        handle: p.handle,
        email: "",
        pixKeyType: "email" as const,
        pixKeyHint: "",
        avatarUrl: p.avatar_url ?? undefined,
        onboarded: true,
        createdAt: "",
      });
    }

    for (const id of missingIds) {
      if (!fetched.has(id)) {
        extra.push({
          id,
          name: "Membro removido",
          handle: "",
          email: "",
          pixKeyType: "email" as const,
          pixKeyHint: "",
          onboarded: false,
          createdAt: "",
        });
      }
    }

    participants = [...knownParticipants, ...extra];
  }

  return { balances: loadedBalances, settlements: loadedSettlements, participants };
}
