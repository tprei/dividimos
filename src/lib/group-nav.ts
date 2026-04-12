import { createClient } from "@/lib/supabase/client";

export async function getGroupNavUrl(groupId: string, currentUserId: string): Promise<string> {
  const supabase = createClient();
  const { data: group } = await supabase
    .from("groups")
    .select("is_dm")
    .eq("id", groupId)
    .single();
  if (!group?.is_dm) return `/app/groups/${groupId}`;
  const { data: pair } = await supabase
    .from("dm_pairs")
    .select("user_a, user_b")
    .eq("group_id", groupId)
    .single();
  if (!pair) return `/app/groups/${groupId}`;
  const counterpartyId = pair.user_a === currentUserId ? pair.user_b : pair.user_a;
  return `/app/conversations/${counterpartyId}`;
}
