"use server";

import { createClient } from "@/lib/supabase/server";
import type { DebtSummary } from "@/types";

interface BalanceRow {
  group_id: string;
  user_a: string;
  user_b: string;
  amount_cents: number;
}

interface GroupRow {
  id: string;
  name: string;
  is_dm: boolean;
}

interface ProfileRow {
  id: string;
  name: string;
  avatar_url: string | null;
}

export async function fetchUserDebts(userId: string): Promise<DebtSummary[]> {
  const supabase = await createClient();

  const { data: balances, error } = await supabase
    .from("balances")
    .select("group_id, user_a, user_b, amount_cents")
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
    .neq("amount_cents", 0);

  if (error || !balances || balances.length === 0) {
    return [];
  }

  const groupIds = new Set<string>();
  const counterpartyIds = new Set<string>();

  for (const b of balances as BalanceRow[]) {
    groupIds.add(b.group_id);
    const counterparty = b.user_a === userId ? b.user_b : b.user_a;
    counterpartyIds.add(counterparty);
  }

  const [groupsResult, profilesResult] = await Promise.all([
    supabase.from("groups").select("id, name, is_dm").in("id", Array.from(groupIds)),
    supabase
      .from("user_profiles")
      .select("id, name, avatar_url")
      .in("id", Array.from(counterpartyIds)),
  ]);

  const groupMap = new Map<string, GroupRow>();
  for (const g of (groupsResult.data ?? []) as GroupRow[]) {
    groupMap.set(g.id, g);
  }

  const profileMap = new Map<string, ProfileRow>();
  for (const p of (profilesResult.data ?? []) as ProfileRow[]) {
    profileMap.set(p.id, p);
  }

  const debts: DebtSummary[] = [];

  for (const b of balances as BalanceRow[]) {
    const counterpartyId = b.user_a === userId ? b.user_b : b.user_a;
    const profile = profileMap.get(counterpartyId);

    let amountCents: number;
    let direction: "owes" | "owed";

    if (b.user_a === userId) {
      amountCents = Math.abs(b.amount_cents);
      direction = b.amount_cents > 0 ? "owes" : "owed";
    } else {
      amountCents = Math.abs(b.amount_cents);
      direction = b.amount_cents > 0 ? "owed" : "owes";
    }

    const group = groupMap.get(b.group_id);
    debts.push({
      groupId: b.group_id,
      groupName: group?.name ?? "Grupo",
      isDm: group?.is_dm ?? false,
      counterpartyId,
      counterpartyName: profile?.name ?? "Usuario",
      counterpartyAvatarUrl: profile?.avatar_url ?? null,
      amountCents,
      direction,
    });
  }

  debts.sort((a, b) => {
    if (a.direction !== b.direction) {
      return a.direction === "owes" ? -1 : 1;
    }
    return b.amountCents - a.amountCents;
  });

  return debts;
}
