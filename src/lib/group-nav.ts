import { createClient } from "@/lib/supabase/client";

export type GroupNavResult = { url: string; isDm: boolean };

export async function getGroupNavUrl(groupId: string, currentUserId: string): Promise<GroupNavResult> {
  const supabase = createClient();
  const { data: group } = await supabase
    .from("groups")
    .select("is_dm")
    .eq("id", groupId)
    .single();
  if (!group?.is_dm) return { url: `/app/groups/${groupId}`, isDm: false };
  const { data: pair } = await supabase
    .from("dm_pairs")
    .select("user_a, user_b")
    .eq("group_id", groupId)
    .single();
  if (!pair) return { url: `/app/groups/${groupId}`, isDm: false };
  const counterpartyId = pair.user_a === currentUserId ? pair.user_b : pair.user_a;
  return { url: `/app/conversations/${counterpartyId}`, isDm: true };
}
