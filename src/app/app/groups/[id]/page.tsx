import { getAuthUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { userProfileRowToUserProfile } from "@/lib/supabase/expense-mappers";
import { GroupDetailContent } from "@/components/group/group-detail-content";
import type { GroupDetailData, MemberEntry, ExpenseSummaryEntry } from "@/components/group/group-detail-content";
import type { ExpenseStatus, GroupMemberStatus } from "@/types";

export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getAuthUser();

  if (!user) return null;

  const supabase = await createClient();

  const [{ data: group }, { data: groupMembers }] = await Promise.all([
    supabase.from("groups").select("name, creator_id").eq("id", id).single(),
    supabase.from("group_members").select("user_id, status, invited_by").eq("group_id", id),
  ]);

  if (!group) return null;

  const memberRows = groupMembers ?? [];
  const allUserIds = [
    ...new Set([group.creator_id, ...memberRows.map((m) => m.user_id)]),
  ];

  const [
    { data: profiles },
    { data: expenseRows },
    { data: inviteLinkRows },
  ] = await Promise.all([
    supabase
      .from("user_profiles")
      .select("id, handle, name, avatar_url")
      .in("id", allUserIds),
    supabase
      .from("expenses")
      .select("id, title, total_amount, status, created_at, creator_id")
      .eq("group_id", id)
      .neq("status", "draft")
      .order("created_at", { ascending: false }),
    supabase
      .from("group_invite_links")
      .select("token")
      .eq("group_id", id)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const expenseList = expenseRows ?? [];
  const expenseIds = expenseList.map((e) => e.id);
  let guestRows: { id: string; expense_id: string; display_name: string }[] = [];
  if (expenseIds.length > 0) {
    const { data } = await supabase
      .from("expense_guests")
      .select("id, expense_id, display_name")
      .in("expense_id", expenseIds)
      .is("claimed_by", null);
    guestRows = data ?? [];
  }

  const profileMap = new Map((profiles ?? []).map((p) => {
    const profile = userProfileRowToUserProfile(p);
    return [profile.id, profile];
  }));

  const members: MemberEntry[] = [];

  const creatorProfile = profileMap.get(group.creator_id);
  if (creatorProfile) {
    members.push({
      userId: group.creator_id,
      status: "accepted",
      profile: creatorProfile,
      invitedBy: group.creator_id,
    });
  }

  for (const m of memberRows) {
    if (m.user_id === group.creator_id) continue;
    const profile = profileMap.get(m.user_id);
    if (profile) {
      members.push({
        userId: m.user_id,
        status: m.status as GroupMemberStatus,
        profile,
        invitedBy: m.invited_by,
      });
    }
  }

  const expenses: ExpenseSummaryEntry[] = expenseList.map((e) => ({
    id: e.id,
    title: e.title,
    totalAmount: e.total_amount,
    status: e.status as ExpenseStatus,
    createdAt: e.created_at,
  }));

  const expenseMetaMap = new Map(
    expenseList.map((e) => [e.id, { creatorId: e.creator_id, status: e.status as ExpenseStatus }]),
  );
  const expenseTitleMap = new Map(expenseList.map((e) => [e.id, e.title]));
  const unclaimedGuests = guestRows.map((g) => {
    const meta = expenseMetaMap.get(g.expense_id);
    return {
      id: g.id,
      expenseId: g.expense_id,
      displayName: g.display_name,
      creatorId: meta?.creatorId ?? "",
      status: meta?.status ?? "active",
      expenseTitle: expenseTitleMap.get(g.expense_id) ?? "Despesa",
    };
  });

  const initialData: GroupDetailData = {
    groupId: id,
    groupName: group.name,
    creatorId: group.creator_id,
    members,
    expenses,
    unclaimedGuests,
    inviteLinkToken: inviteLinkRows?.[0]?.token ?? null,
  };

  return <GroupDetailContent initialData={initialData} />;
}
