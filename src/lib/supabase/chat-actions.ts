"use client";

import { createClient } from "@/lib/supabase/client";
import {
  expenseRowToExpense,
  settlementRowToSettlement,
  userProfileRowToUserProfile,
} from "@/lib/supabase/expense-mappers";
import type {
  ChatMessage,
  ChatMessageWithSender,
  Expense,
  Settlement,
  UserProfile,
} from "@/types";
import type { Database } from "@/types/database";

type ChatMessageRow = Database["public"]["Tables"]["chat_messages"]["Row"];
type UserProfileRow = Database["public"]["Views"]["user_profiles"]["Row"];

function chatMessageRowToMessage(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    groupId: row.group_id,
    senderId: row.sender_id,
    messageType: row.message_type,
    content: row.content,
    expenseId: row.expense_id ?? undefined,
    settlementId: row.settlement_id ?? undefined,
    createdAt: row.created_at,
  };
}

export { chatMessageRowToMessage };

export interface ThreadData {
  messages: ChatMessageWithSender[];
  expenses: Map<string, Expense>;
  settlements: Map<string, { settlement: Settlement; fromUser: UserProfile; toUser: UserProfile }>;
}

export async function sendChatMessage(
  groupId: string,
  content: string,
): Promise<{ id: string } | { error: string }> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado" };

  const { data, error } = await supabase
    .from("chat_messages")
    .insert({
      group_id: groupId,
      sender_id: user.id,
      message_type: "text" as const,
      content,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  return { id: data.id };
}

/**
 * Load chat messages for a group, with sender profiles and linked
 * expense/settlement data for system messages.
 *
 * Fetches messages, profiles, and linked entities in parallel where possible.
 */
export async function loadThreadMessages(
  groupId: string,
  limit = 50,
  before?: string,
): Promise<ThreadData> {
  const supabase = createClient();

  let query = supabase
    .from("chat_messages")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (before) {
    query = query.lt("created_at", before);
  }

  const { data: messageRows, error } = await query;

  if (error) {
    throw new Error(`Failed to load messages: ${error.message}`);
  }

  if (!messageRows || messageRows.length === 0) {
    return { messages: [], expenses: new Map(), settlements: new Map() };
  }

  const messages = (messageRows as ChatMessageRow[]).map(chatMessageRowToMessage);

  // Collect IDs for batch fetching
  const senderIds = [...new Set(messages.map((m) => m.senderId))];
  const expenseIds = [
    ...new Set(
      messages
        .filter((m) => m.messageType === "system_expense" && m.expenseId)
        .map((m) => m.expenseId!),
    ),
  ];
  const settlementIds = [
    ...new Set(
      messages
        .filter((m) => m.messageType === "system_settlement" && m.settlementId)
        .map((m) => m.settlementId!),
    ),
  ];

  // Parallel fetch: sender profiles + expenses + settlements
  const [profilesResult, expensesResult, settlementsResult] = await Promise.all([
    supabase
      .from("user_profiles")
      .select("*")
      .in("id", senderIds),
    expenseIds.length > 0
      ? supabase.from("expenses").select("*").in("id", expenseIds)
      : Promise.resolve({ data: [], error: null }),
    settlementIds.length > 0
      ? supabase.from("settlements").select("*").in("id", settlementIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  // Build profile lookup
  const profileMap = new Map<string, UserProfile>();
  for (const row of (profilesResult.data ?? []) as UserProfileRow[]) {
    profileMap.set(row.id, userProfileRowToUserProfile(row));
  }

  // Build expense lookup
  const expenseMap = new Map<string, Expense>();
  for (const row of expensesResult.data ?? []) {
    const expense = expenseRowToExpense(row as Database["public"]["Tables"]["expenses"]["Row"]);
    expenseMap.set(expense.id, expense);
  }

  // Build settlement lookup (need from/to user profiles)
  const settlementMap = new Map<
    string,
    { settlement: Settlement; fromUser: UserProfile; toUser: UserProfile }
  >();
  if (settlementsResult.data && settlementsResult.data.length > 0) {
    const settlementUserIds = new Set<string>();
    for (const row of settlementsResult.data) {
      const s = row as Database["public"]["Tables"]["settlements"]["Row"];
      settlementUserIds.add(s.from_user_id);
      settlementUserIds.add(s.to_user_id);
    }
    // Fetch any settlement user profiles not already loaded
    const missingIds = [...settlementUserIds].filter((id) => !profileMap.has(id));
    if (missingIds.length > 0) {
      const { data: extraProfiles } = await supabase
        .from("user_profiles")
        .select("*")
        .in("id", missingIds);
      for (const row of (extraProfiles ?? []) as UserProfileRow[]) {
        profileMap.set(row.id, userProfileRowToUserProfile(row));
      }
    }

    for (const row of settlementsResult.data) {
      const settlement = settlementRowToSettlement(
        row as Database["public"]["Tables"]["settlements"]["Row"],
      );
      const fromUser = profileMap.get(settlement.fromUserId);
      const toUser = profileMap.get(settlement.toUserId);
      if (fromUser && toUser) {
        settlementMap.set(settlement.id, { settlement, fromUser, toUser });
      }
    }
  }

  // Attach sender profiles to messages
  const fallbackProfile: UserProfile = {
    id: "",
    handle: "",
    name: "Usuário",
    avatarUrl: undefined,
  };
  const messagesWithSender: ChatMessageWithSender[] = messages.map((m) => ({
    ...m,
    sender: profileMap.get(m.senderId) ?? { ...fallbackProfile, id: m.senderId },
  }));

  return {
    messages: messagesWithSender,
    expenses: expenseMap,
    settlements: settlementMap,
  };
}

/**
 * Load counterparty profile and DM group metadata.
 */
export async function loadDmGroupInfo(groupId: string): Promise<{
  counterparty: UserProfile | null;
  currentUserId: string | null;
}> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { counterparty: null, currentUserId: null };

  // Get the other member of this DM group
  const { data: members } = await supabase
    .from("group_members")
    .select("user_id")
    .eq("group_id", groupId)
    .eq("status", "accepted");

  if (!members) return { counterparty: null, currentUserId: user.id };

  const otherUserId = members.find((m) => m.user_id !== user.id)?.user_id;
  if (!otherUserId) return { counterparty: null, currentUserId: user.id };

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("id", otherUserId)
    .single();

  if (!profile) return { counterparty: null, currentUserId: user.id };

  return {
    counterparty: userProfileRowToUserProfile(profile as UserProfileRow),
    currentUserId: user.id,
  };
}
