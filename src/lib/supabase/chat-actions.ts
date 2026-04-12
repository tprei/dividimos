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

function chatMessageRowToChatMessage(row: ChatMessageRow): ChatMessage {
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

export { chatMessageRowToChatMessage };

/**
 * Sends a text message to a DM group conversation.
 * Returns the created ChatMessage or an error.
 */
export async function sendChatMessage(
  groupId: string,
  content: string,
): Promise<ChatMessage | { error: string }> {
  const trimmed = content.trim();
  if (!trimmed) return { error: "Mensagem vazia" };

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
      content: trimmed,
    })
    .select()
    .single();

  if (error) return { error: error.message };
  return chatMessageRowToChatMessage(data);
}

export interface ConversationThread {
  messages: ChatMessageWithSender[];
  expenses: Map<string, Expense>;
  settlements: Map<string, Settlement>;
  profiles: Map<string, UserProfile>;
}

/**
 * Loads chat messages for a group, paginated by cursor.
 * Returns messages in ascending chronological order (oldest first).
 * Also resolves related expenses, settlements, and sender profiles.
 */
export async function loadConversationMessages(
  groupId: string,
  options: { limit?: number; before?: string } = {},
): Promise<ConversationThread | { error: string }> {
  const supabase = createClient();
  const limit = options.limit ?? 50;

  let query = supabase
    .from("chat_messages")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (options.before) {
    query = query.lt("created_at", options.before);
  }

  const { data: rows, error } = await query;
  if (error) return { error: error.message };
  if (!rows || rows.length === 0) {
    return {
      messages: [],
      expenses: new Map(),
      settlements: new Map(),
      profiles: new Map(),
    };
  }

  // Reverse to get ascending order for display
  const messageRows = rows.reverse();

  // Collect IDs for batch lookups
  const senderIds = new Set<string>();
  const expenseIds = new Set<string>();
  const settlementIds = new Set<string>();

  for (const row of messageRows) {
    senderIds.add(row.sender_id);
    if (row.expense_id) expenseIds.add(row.expense_id);
    if (row.settlement_id) settlementIds.add(row.settlement_id);
  }

  // Parallel batch fetches for related data
  const [profilesResult, expensesResult, settlementsResult] =
    await Promise.all([
      supabase
        .from("user_profiles")
        .select("*")
        .in("id", [...senderIds]),
      expenseIds.size > 0
        ? supabase
            .from("expenses")
            .select("*")
            .in("id", [...expenseIds])
        : Promise.resolve({ data: [], error: null }),
      settlementIds.size > 0
        ? supabase
            .from("settlements")
            .select("*")
            .in("id", [...settlementIds])
        : Promise.resolve({ data: [], error: null }),
    ]);

  // Build lookup maps
  const profiles = new Map<string, UserProfile>();
  if (profilesResult.data) {
    for (const row of profilesResult.data) {
      profiles.set(row.id, userProfileRowToUserProfile(row));
    }
  }

  const expenses = new Map<string, Expense>();
  if (expensesResult.data) {
    for (const row of expensesResult.data) {
      expenses.set(row.id, expenseRowToExpense(row));
    }
  }

  const settlements = new Map<string, Settlement>();
  if (settlementsResult.data) {
    for (const row of settlementsResult.data) {
      settlements.set(row.id, settlementRowToSettlement(row));
    }
  }

  // For settlements, also resolve from/to user profiles
  if (settlements.size > 0) {
    const settlementUserIds = new Set<string>();
    for (const s of settlements.values()) {
      if (!profiles.has(s.fromUserId)) settlementUserIds.add(s.fromUserId);
      if (!profiles.has(s.toUserId)) settlementUserIds.add(s.toUserId);
    }
    if (settlementUserIds.size > 0) {
      const { data: extraProfiles } = await supabase
        .from("user_profiles")
        .select("*")
        .in("id", [...settlementUserIds]);
      if (extraProfiles) {
        for (const row of extraProfiles) {
          profiles.set(row.id, userProfileRowToUserProfile(row));
        }
      }
    }
  }

  // Build messages with sender
  const fallbackProfile: UserProfile = {
    id: "unknown",
    handle: "unknown",
    name: "Usuário",
  };

  const messages: ChatMessageWithSender[] = messageRows.map((row) => ({
    ...chatMessageRowToChatMessage(row),
    sender: profiles.get(row.sender_id) ?? fallbackProfile,
  }));

  return { messages, expenses, settlements, profiles };
}
