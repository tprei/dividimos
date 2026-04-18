import { getAuthUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { GroupDetailContent } from "@/components/group/group-detail-content";
import type { GroupDetailData, MemberEntry, ExpenseSummaryEntry } from "@/components/group/group-detail-content";
import type { ExpenseStatus, GroupMemberStatus, Settlement } from "@/types";

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
    { data: settlementRows },
    { data: inviteLinkRows },
    { data: balanceRows },
  ] = await Promise.all([
    supabase
      .from("user_profiles")
      .select("id, handle, name, avatar_url")
      .in("id", allUserIds),
    supabase
      .from("expenses")
      .select("id, title, total_amount, status, created_at")
      .eq("group_id", id)
      .neq("status", "draft")
      .order("created_at", { ascending: false }),
    supabase
      .from("settlements")
      .select("id, group_id, from_user_id, to_user_id, amount_cents, status, created_at, confirmed_at")
      .eq("group_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("group_invite_links")
      .select("token")
      .eq("group_id", id)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("balances")
      .select("*")
      .eq("group_id", id)
      .neq("amount_cents", 0)
      .or(`user_a.eq.${user.id},user_b.eq.${user.id}`),
  ]);

  const expenseList = expenseRows ?? [];
  const expenseIds = expenseList.map((e) => e.id);
  let guestRows: { id: string; expense_id: string; display_name: string; claim_token: string }[] = [];
  if (expenseIds.length > 0) {
    const { data } = await supabase
      .from("expense_guests")
      .select("id, expense_id, display_name, claim_token")
      .in("expense_id", expenseIds)
      .is("claimed_by", null);
    guestRows = data ?? [];
  }

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  const members: MemberEntry[] = [];

  const creatorProfile = profileMap.get(group.creator_id);
  if (creatorProfile) {
    members.push({
      userId: group.creator_id,
      status: "accepted",
      profile: {
        id: creatorProfile.id,
        handle: creatorProfile.handle,
        name: creatorProfile.name,
        avatarUrl: creatorProfile.avatar_url ?? undefined,
      },
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
        profile: {
          id: profile.id,
          handle: profile.handle,
          name: profile.name,
          avatarUrl: profile.avatar_url ?? undefined,
        },
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

  const settlements: Settlement[] = (settlementRows ?? []).map((s) => ({
    id: s.id,
    groupId: s.group_id,
    fromUserId: s.from_user_id,
    toUserId: s.to_user_id,
    amountCents: s.amount_cents,
    status: s.status as Settlement["status"],
    createdAt: s.created_at,
    confirmedAt: s.confirmed_at ?? undefined,
  }));

  const expenseTitleMap = new Map(expenseList.map((e) => [e.id, e.title]));
  const unclaimedGuests = guestRows.map((g) => ({
    id: g.id,
    expenseId: g.expense_id,
    displayName: g.display_name,
    claimToken: g.claim_token,
    expenseTitle: expenseTitleMap.get(g.expense_id) ?? "Despesa",
  }));

  const memberBalances: Record<string, number> = {};
  if (balanceRows) {
    for (const row of balanceRows as { user_a: string; user_b: string; amount_cents: number }[]) {
      if (row.user_a === user.id) {
        memberBalances[row.user_b] = (memberBalances[row.user_b] ?? 0) - row.amount_cents;
      } else {
        memberBalances[row.user_a] = (memberBalances[row.user_a] ?? 0) + row.amount_cents;
      }
    }
  }

  const initialData: GroupDetailData = {
    groupId: id,
    groupName: group.name,
    creatorId: group.creator_id,
    members,
    expenses,
    settlements,
    unclaimedGuests,
    inviteLinkToken: inviteLinkRows?.[0]?.token ?? null,
    memberBalances,
  };

  return <GroupDetailContent initialData={initialData} />;
}
