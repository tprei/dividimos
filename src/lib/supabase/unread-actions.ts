import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export interface UnreadCount {
  groupId: string;
  count: number;
}

/**
 * Fetches unread message counts for all DM conversations of a user.
 * Compares chat_messages.created_at against conversation_read_receipts.last_read_at.
 * Groups with no read receipt are treated as fully unread.
 */
export async function getUnreadCounts(
  supabase: SupabaseClient<Database>,
  userId: string,
  groupIds: string[],
): Promise<Map<string, number>> {
  if (groupIds.length === 0) return new Map();

  const [{ data: receipts }, { data: messages }] = await Promise.all([
    supabase
      .from("conversation_read_receipts")
      .select("group_id, last_read_at")
      .eq("user_id", userId)
      .in("group_id", groupIds),
    supabase
      .from("chat_messages")
      .select("group_id, created_at")
      .in("group_id", groupIds)
      .neq("sender_id", userId),
  ]);

  const receiptMap = new Map<string, string>();
  for (const r of receipts ?? []) {
    receiptMap.set(r.group_id, r.last_read_at);
  }

  const countMap = new Map<string, number>();
  for (const msg of messages ?? []) {
    const lastRead = receiptMap.get(msg.group_id);
    if (!lastRead || msg.created_at > lastRead) {
      countMap.set(msg.group_id, (countMap.get(msg.group_id) ?? 0) + 1);
    }
  }

  return countMap;
}

/**
 * Returns the total number of unread messages across all DM conversations.
 */
export async function getTotalUnreadCount(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<number> {
  const { data: dmPairs } = await supabase
    .from("dm_pairs")
    .select("group_id")
    .or(`user_a.eq.${userId},user_b.eq.${userId}`);

  if (!dmPairs || dmPairs.length === 0) return 0;

  const groupIds = dmPairs.map((p) => p.group_id);
  const countMap = await getUnreadCounts(supabase, userId, groupIds);

  let total = 0;
  for (const count of countMap.values()) {
    total += count;
  }
  return total;
}

/**
 * Marks a conversation as read by upserting the read receipt to now().
 */
export async function markConversationRead(
  supabase: SupabaseClient<Database>,
  userId: string,
  groupId: string,
): Promise<void> {
  await supabase.from("conversation_read_receipts").upsert(
    {
      user_id: userId,
      group_id: groupId,
      last_read_at: new Date().toISOString(),
    },
    { onConflict: "user_id,group_id" },
  );
}
