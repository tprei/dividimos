import { GroupsListContent } from "@/components/groups/groups-list-content";
import { getAuthUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/types";

export default async function GroupsPage() {
  const user = await getAuthUser();

  if (!user) return null;

  const supabase = await createClient();

  const [{ data: myMemberships }, { data: createdGroups }] = await Promise.all([
    supabase.from("group_members").select("group_id, status, invited_by").eq("user_id", user.id),
    supabase.from("groups").select("id").eq("creator_id", user.id),
  ]);

  const allGroupIds = new Set<string>();
  const pendingGroupIds: string[] = [];

  for (const m of myMemberships ?? []) {
    allGroupIds.add(m.group_id);
    if (m.status === "invited") pendingGroupIds.push(m.group_id);
  }
  for (const g of createdGroups ?? []) {
    allGroupIds.add(g.id);
  }

  if (allGroupIds.size === 0) {
    return <GroupsListContent initialGroups={[]} initialInvites={[]} />;
  }

  const groupIdArray = Array.from(allGroupIds);
  const nonPendingGroupIds = groupIdArray.filter((id) => !pendingGroupIds.includes(id));

  const [{ data: groupData }, { data: allMembers }, { data: activeBillRows }] = await Promise.all([
    supabase.from("groups").select("id, name, creator_id").in("id", groupIdArray),
    supabase.from("group_members").select("group_id, user_id").in("group_id", groupIdArray).eq("status", "accepted"),
    nonPendingGroupIds.length > 0
      ? supabase.from("expenses").select("group_id").in("group_id", nonPendingGroupIds).neq("status", "draft")
      : Promise.resolve({ data: [] }),
  ]);

  const membersByGroup = new Map<string, string[]>();
  for (const m of allMembers ?? []) {
    const list = membersByGroup.get(m.group_id) ?? [];
    list.push(m.user_id);
    membersByGroup.set(m.group_id, list);
  }

  const billCountByGroup = new Map<string, number>();
  for (const b of (activeBillRows as { group_id: string }[] | null) ?? []) {
    billCountByGroup.set(b.group_id, (billCountByGroup.get(b.group_id) ?? 0) + 1);
  }

  const allMemberIds = [...new Set((allMembers ?? []).map((m) => m.user_id))];
  const { data: profiles } = allMemberIds.length > 0
    ? await supabase.from("user_profiles").select("id, handle, name, avatar_url").in("id", allMemberIds)
    : { data: [] };

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  const groups: {
    id: string;
    name: string;
    creatorId: string;
    memberCount: number;
    members: UserProfile[];
    activeBillCount: number;
  }[] = [];

  for (const g of groupData ?? []) {
    if (pendingGroupIds.includes(g.id)) continue;
    const memberIds = membersByGroup.get(g.id) ?? [];
    const memberProfiles: UserProfile[] = memberIds.slice(0, 5).flatMap((id) => {
      const p = profileMap.get(id);
      return p ? [{ id: p.id, handle: p.handle, name: p.name, avatarUrl: p.avatar_url ?? undefined }] : [];
    });
    groups.push({
      id: g.id,
      name: g.name,
      creatorId: g.creator_id,
      memberCount: memberIds.length + 1,
      members: memberProfiles,
      activeBillCount: billCountByGroup.get(g.id) ?? 0,
    });
  }

  const pendingInviteUserIds: string[] = [];
  const pendingInviteByGroupMap = new Map<string, string>();
  for (const membership of myMemberships ?? []) {
    if (pendingGroupIds.includes(membership.group_id)) {
      const inviterRef = membership.invited_by;
      if (inviterRef) {
        pendingInviteByGroupMap.set(membership.group_id, inviterRef);
        pendingInviteUserIds.push(inviterRef);
      }
    }
  }

  const { data: inviterProfiles } = pendingInviteUserIds.length > 0
    ? await supabase.from("user_profiles").select("id, name").in("id", pendingInviteUserIds)
    : { data: [] };

  const inviterNameMap = new Map((inviterProfiles ?? []).map((p) => [p.id, p.name]));

  const invites = pendingGroupIds.flatMap((gid) => {
    const group = (groupData ?? []).find((g) => g.id === gid);
    if (!group) return [];
    const inviterId = pendingInviteByGroupMap.get(gid) ?? "";
    return [{ groupId: gid, groupName: group.name, invitedByName: inviterNameMap.get(inviterId) ?? "" }];
  });

  return <GroupsListContent initialGroups={groups} initialInvites={invites} />;
}
