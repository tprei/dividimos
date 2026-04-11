"use server";

import { createClient } from "@/lib/supabase/server";
import type { ActivityItem, UserProfile } from "@/types";

interface ExpenseRow {
  id: string;
  group_id: string;
  creator_id: string;
  title: string;
  total_amount: number;
  created_at: string;
}

interface SettlementRow {
  id: string;
  group_id: string;
  from_user_id: string;
  to_user_id: string;
  amount_cents: number;
  status: "pending" | "confirmed";
  created_at: string;
  confirmed_at: string | null;
}

interface MemberRow {
  group_id: string;
  user_id: string;
  accepted_at: string | null;
}

interface GroupRow {
  id: string;
  name: string;
}

interface ProfileRow {
  id: string;
  handle: string;
  name: string;
  avatar_url: string | null;
}

function toUserProfile(row: ProfileRow): UserProfile {
  return {
    id: row.id,
    handle: row.handle,
    name: row.name,
    avatarUrl: row.avatar_url ?? undefined,
  };
}

const FALLBACK_PROFILE: UserProfile = {
  id: "",
  handle: "",
  name: "Usuário",
  avatarUrl: undefined,
};

export interface FetchActivityOptions {
  userId: string;
  groupId?: string;
  limit?: number;
  before?: string;
}

export async function fetchActivityFeed(
  options: FetchActivityOptions,
): Promise<ActivityItem[]> {
  const { userId, groupId, limit = 30, before } = options;
  const supabase = await createClient();

  const userGroupIds = await resolveUserGroupIds(supabase, userId, groupId);
  if (userGroupIds.length === 0) return [];

  const [expenses, settlements, members, groupMap] = await Promise.all([
    fetchActiveExpenses(supabase, userGroupIds, before),
    fetchSettlements(supabase, userGroupIds, before),
    fetchMemberJoins(supabase, userGroupIds, userId, before),
    fetchGroupNames(supabase, userGroupIds),
  ]);

  const profileMap = await fetchProfileMap(
    supabase,
    collectUserIds(expenses, settlements, members),
  );

  const items: ActivityItem[] = [
    ...mapExpenses(expenses, groupMap, profileMap),
    ...mapSettlements(settlements, groupMap, profileMap),
    ...mapMembers(members, groupMap, profileMap),
  ];

  items.sort((a, b) => (b.timestamp > a.timestamp ? 1 : b.timestamp < a.timestamp ? -1 : 0));

  return items.slice(0, limit);
}

async function resolveUserGroupIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  groupId?: string,
): Promise<string[]> {
  if (groupId) {
    const { data } = await supabase
      .from("group_members")
      .select("group_id")
      .eq("group_id", groupId)
      .eq("user_id", userId)
      .eq("status", "accepted")
      .limit(1);
    return data && data.length > 0 ? [groupId] : [];
  }

  const { data } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", userId)
    .eq("status", "accepted");

  return (data ?? []).map((r) => r.group_id);
}

async function fetchActiveExpenses(
  supabase: Awaited<ReturnType<typeof createClient>>,
  groupIds: string[],
  before?: string,
) {
  let query = supabase
    .from("expenses")
    .select("id, group_id, creator_id, title, total_amount, created_at")
    .in("group_id", groupIds)
    .in("status", ["active", "settled"])
    .order("created_at", { ascending: false });

  if (before) {
    query = query.lt("created_at", before);
  }

  const { data } = await query;
  return (data ?? []) as ExpenseRow[];
}

async function fetchSettlements(
  supabase: Awaited<ReturnType<typeof createClient>>,
  groupIds: string[],
  before?: string,
) {
  let query = supabase
    .from("settlements")
    .select(
      "id, group_id, from_user_id, to_user_id, amount_cents, status, created_at, confirmed_at",
    )
    .in("group_id", groupIds)
    .order("created_at", { ascending: false });

  if (before) {
    query = query.lt("created_at", before);
  }

  const { data } = await query;
  return (data ?? []) as SettlementRow[];
}

async function fetchMemberJoins(
  supabase: Awaited<ReturnType<typeof createClient>>,
  groupIds: string[],
  currentUserId: string,
  before?: string,
) {
  let query = supabase
    .from("group_members")
    .select("group_id, user_id, accepted_at")
    .in("group_id", groupIds)
    .eq("status", "accepted")
    .neq("user_id", currentUserId)
    .not("accepted_at", "is", null)
    .order("accepted_at", { ascending: false });

  if (before) {
    query = query.lt("accepted_at", before);
  }

  const { data } = await query;
  return (data ?? []) as MemberRow[];
}

function collectUserIds(
  expenses: ExpenseRow[],
  settlements: SettlementRow[],
  members: MemberRow[],
): string[] {
  const ids = new Set<string>();
  for (const e of expenses) ids.add(e.creator_id);
  for (const s of settlements) {
    ids.add(s.from_user_id);
    ids.add(s.to_user_id);
  }
  for (const m of members) ids.add(m.user_id);
  return Array.from(ids);
}

async function fetchProfileMap(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userIds: string[],
): Promise<Map<string, UserProfile>> {
  if (userIds.length === 0) return new Map();

  const { data } = await supabase
    .from("user_profiles")
    .select("id, handle, name, avatar_url")
    .in("id", userIds);

  const map = new Map<string, UserProfile>();
  for (const row of (data ?? []) as ProfileRow[]) {
    map.set(row.id, toUserProfile(row));
  }
  return map;
}

async function fetchGroupNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  groupIds: string[],
): Promise<Map<string, string>> {
  const { data } = await supabase
    .from("groups")
    .select("id, name")
    .in("id", groupIds);

  const map = new Map<string, string>();
  for (const g of (data ?? []) as GroupRow[]) {
    map.set(g.id, g.name);
  }
  return map;
}

function getProfile(map: Map<string, UserProfile>, id: string): UserProfile {
  return map.get(id) ?? { ...FALLBACK_PROFILE, id };
}

function mapExpenses(
  rows: ExpenseRow[],
  groupMap: Map<string, string>,
  profileMap: Map<string, UserProfile>,
): ActivityItem[] {
  return rows.map((e) => ({
    id: `expense-${e.id}`,
    type: "expense_activated" as const,
    groupId: e.group_id,
    groupName: groupMap.get(e.group_id) ?? "Grupo",
    actorId: e.creator_id,
    actor: getProfile(profileMap, e.creator_id),
    timestamp: e.created_at,
    expenseId: e.id,
    expenseTitle: e.title,
    totalAmount: e.total_amount,
  }));
}

function mapSettlements(
  rows: SettlementRow[],
  groupMap: Map<string, string>,
  profileMap: Map<string, UserProfile>,
): ActivityItem[] {
  const items: ActivityItem[] = [];

  for (const s of rows) {
    items.push({
      id: `settlement-rec-${s.id}`,
      type: "settlement_recorded" as const,
      groupId: s.group_id,
      groupName: groupMap.get(s.group_id) ?? "Grupo",
      actorId: s.from_user_id,
      actor: getProfile(profileMap, s.from_user_id),
      timestamp: s.created_at,
      settlementId: s.id,
      toUserId: s.to_user_id,
      toUser: getProfile(profileMap, s.to_user_id),
      amountCents: s.amount_cents,
    });

    if (s.status === "confirmed" && s.confirmed_at) {
      items.push({
        id: `settlement-conf-${s.id}`,
        type: "settlement_confirmed" as const,
        groupId: s.group_id,
        groupName: groupMap.get(s.group_id) ?? "Grupo",
        actorId: s.to_user_id,
        actor: getProfile(profileMap, s.to_user_id),
        timestamp: s.confirmed_at,
        settlementId: s.id,
        fromUserId: s.from_user_id,
        fromUser: getProfile(profileMap, s.from_user_id),
        amountCents: s.amount_cents,
      });
    }
  }

  return items;
}

function mapMembers(
  rows: MemberRow[],
  groupMap: Map<string, string>,
  profileMap: Map<string, UserProfile>,
): ActivityItem[] {
  return rows
    .filter((m) => m.accepted_at !== null)
    .map((m) => ({
      id: `member-${m.group_id}-${m.user_id}`,
      type: "member_joined" as const,
      groupId: m.group_id,
      groupName: groupMap.get(m.group_id) ?? "Grupo",
      actorId: m.user_id,
      actor: getProfile(profileMap, m.user_id),
      timestamp: m.accepted_at!,
    }));
}
