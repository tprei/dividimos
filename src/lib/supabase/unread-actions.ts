import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export interface UnreadCount {
  groupId: string;
  count: number;
}

// TODO: userId is no longer used in the query (the RPC uses auth.uid() internally).
// It is kept in the signature for now to avoid touching all callers at once.
export async function getUnreadCounts(
  supabase: SupabaseClient<Database>,
  userId: string,
  groupIds: string[],
): Promise<Map<string, number>> {
  if (groupIds.length === 0) return new Map();

  const { data } = await supabase.rpc("get_unread_counts", {
    p_group_ids: groupIds,
  });

  const countMap = new Map<string, number>();
  for (const row of data ?? []) {
    countMap.set(row.group_id, row.unread_count);
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
