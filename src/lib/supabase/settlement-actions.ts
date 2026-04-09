import { createClient } from "@/lib/supabase/client";
import type { Balance, Settlement, UserProfile } from "@/types";
import type { Database } from "@/types/database";

type BalanceRow = Database["public"]["Tables"]["balances"]["Row"];
type SettlementRow = Database["public"]["Tables"]["settlements"]["Row"];

function mapBalanceRow(row: BalanceRow): Balance {
  return {
    groupId: row.group_id,
    userA: row.user_a,
    userB: row.user_b,
    amountCents: row.amount_cents,
    updatedAt: row.updated_at,
  };
}

function mapSettlementRow(row: SettlementRow): Settlement {
  return {
    id: row.id,
    groupId: row.group_id,
    fromUserId: row.from_user_id,
    toUserId: row.to_user_id,
    amountCents: row.amount_cents,
    status: row.status,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at ?? undefined,
  };
}

// ============================================================
// Balance queries
// ============================================================

/**
 * Query all non-zero balances for a group.
 * Returns directed debt edges (who owes whom).
 */
export async function queryBalances(groupId: string): Promise<Balance[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("balances")
    .select("*")
    .eq("group_id", groupId)
    .neq("amount_cents", 0);

  if (error) {
    throw new Error(`Failed to query balances: ${error.message}`);
  }

  return (data ?? []).map(mapBalanceRow);
}

/**
 * Query the balance between two specific users in a group.
 * Handles canonical ordering (user_a < user_b) internally.
 * Returns null if no balance exists (they have no history).
 */
export async function queryBalanceBetween(
  groupId: string,
  userId1: string,
  userId2: string,
): Promise<Balance | null> {
  const [userA, userB] = userId1 < userId2
    ? [userId1, userId2]
    : [userId2, userId1];

  const supabase = createClient();

  const { data, error } = await supabase
    .from("balances")
    .select("*")
    .eq("group_id", groupId)
    .eq("user_a", userA)
    .eq("user_b", userB)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to query balance: ${error.message}`);
  }

  if (!data) return null;

  return mapBalanceRow(data);
}

// ============================================================
// Settlement operations
// ============================================================

/**
 * Record a settlement and update balances atomically.
 * Either the debtor or creditor can call this.
 * Uses the record_and_settle RPC which inserts a confirmed settlement
 * and updates the running balance in one transaction.
 */
export async function recordSettlement(
  groupId: string,
  fromUserId: string,
  toUserId: string,
  amountCents: number,
): Promise<Settlement> {
  if (amountCents <= 0) {
    throw new Error("Settlement amount must be positive");
  }
  if (fromUserId === toUserId) {
    throw new Error("Cannot settle with yourself");
  }

  const supabase = createClient();

  const { data, error } = await supabase.rpc("record_and_settle", {
    p_group_id: groupId,
    p_from_user_id: fromUserId,
    p_to_user_id: toUserId,
    p_amount_cents: amountCents,
  });

  if (error) {
    throw new Error(`Failed to record settlement: ${error.message}`);
  }

  return {
    id: data,
    groupId,
    fromUserId,
    toUserId,
    amountCents,
    status: "confirmed",
    createdAt: new Date().toISOString(),
    confirmedAt: new Date().toISOString(),
  };
}

// ============================================================
// Settlement history queries
// ============================================================

/**
 * Query all settlements for a group, ordered by most recent first.
 */
export async function querySettlements(
  groupId: string,
): Promise<Settlement[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("settlements")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to query settlements: ${error.message}`);
  }

  return (data ?? []).map(mapSettlementRow);
}

/**
 * Query settlement history between two specific users in a group.
 * Returns settlements in both directions (A→B and B→A).
 */
export async function querySettlementHistoryForBalance(
  groupId: string,
  userId1: string,
  userId2: string,
): Promise<Settlement[]> {
  const supabase = createClient();

  // Fetch settlements in both directions with a single query using OR
  const { data, error } = await supabase
    .from("settlements")
    .select("*")
    .eq("group_id", groupId)
    .or(
      `and(from_user_id.eq.${userId1},to_user_id.eq.${userId2}),and(from_user_id.eq.${userId2},to_user_id.eq.${userId1})`,
    )
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to query settlement history: ${error.message}`);
  }

  return (data ?? []).map(mapSettlementRow);
}


// ============================================================
// Composite queries (with user profiles)
// ============================================================

export type SettlementWithUsers = Settlement & {
  fromUser: UserProfile;
  toUser: UserProfile;
};

/**
 * Query settlements for a group with user profile data attached.
 * Fetches settlements and profiles in parallel.
 */
export async function querySettlementsWithUsers(
  groupId: string,
): Promise<SettlementWithUsers[]> {
  const supabase = createClient();

  const [settlementsResult, profilesResult] = await Promise.all([
    supabase
      .from("settlements")
      .select("*")
      .eq("group_id", groupId)
      .order("created_at", { ascending: false }),
    supabase.from("user_profiles").select("*"),
  ]);

  if (settlementsResult.error) {
    throw new Error(
      `Failed to query settlements: ${settlementsResult.error.message}`,
    );
  }

  const settlements = (settlementsResult.data ?? []).map(mapSettlementRow);

  if (settlements.length === 0) return [];

  // Build profile lookup
  const profiles = new Map<string, UserProfile>();
  for (const p of profilesResult.data ?? []) {
    profiles.set(p.id, {
      id: p.id,
      handle: p.handle,
      name: p.name,
      avatarUrl: p.avatar_url ?? undefined,
    });
  }

  const unknownUser: UserProfile = {
    id: "",
    handle: "unknown",
    name: "Usuário desconhecido",
  };

  return settlements.map((s) => ({
    ...s,
    fromUser: profiles.get(s.fromUserId) ?? unknownUser,
    toUser: profiles.get(s.toUserId) ?? unknownUser,
  }));
}
