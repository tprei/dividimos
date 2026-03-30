"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatBRL } from "@/lib/currency";
import { isWebPushConfigured } from "./web-push";
import { notifyUser } from "./notify-user";
import type { PushPayload } from "./web-push";

async function getCallerId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * Fire-and-forget wrapper that swallows all errors.
 * Push notification failure must never break the primary action.
 */
async function safeNotify(userId: string, payload: PushPayload): Promise<void> {
  if (!isWebPushConfigured()) return;
  try {
    await notifyUser(userId, payload);
  } catch {
    // Intentionally swallowed — push is best-effort
  }
}

/**
 * Notify multiple users in parallel. Excludes the actor (current user)
 * so they don't get notified about their own actions.
 */
async function safeNotifyMany(
  userIds: string[],
  excludeUserId: string,
  payload: PushPayload,
): Promise<void> {
  const recipients = userIds.filter((id) => id !== excludeUserId);
  if (recipients.length === 0) return;
  await Promise.all(recipients.map((id) => safeNotify(id, payload)));
}

// ============================================================
// Group invite
// ============================================================

/**
 * Notify the invitee that they were invited to a group.
 * Called after a successful group_members insert with status "invited".
 */
export async function notifyGroupInvite(
  groupId: string,
  inviteeId: string,
): Promise<void> {
  if (!isWebPushConfigured()) return;

  const callerId = await getCallerId();
  if (!callerId) return;

  const admin = createAdminClient();

  const { count } = await admin
    .from("group_members")
    .select("*", { count: "exact", head: true })
    .eq("group_id", groupId)
    .eq("user_id", callerId)
    .eq("status", "accepted");
  if (!count || count === 0) return;

  const [groupResult, inviterResult] = await Promise.all([
    admin.from("groups").select("name").eq("id", groupId).single(),
    // The most recent "accepted" or creator member who invited this person
    admin
      .from("group_members")
      .select("invited_by")
      .eq("group_id", groupId)
      .eq("user_id", inviteeId)
      .single(),
  ]);

  const groupName = groupResult.data?.name ?? "um grupo";
  const inviterId = inviterResult.data?.invited_by;

  let inviterName = "Alguém";
  if (inviterId) {
    const { data: profile } = await admin
      .from("user_profiles")
      .select("name")
      .eq("id", inviterId)
      .single();
    inviterName = profile?.name ?? "Alguém";
  }

  await safeNotify(inviteeId, {
    title: "Novo convite de grupo",
    body: `${inviterName} convidou você para "${groupName}"`,
    url: "/app/groups",
    tag: `group-invite-${groupId}`,
  });
}

// ============================================================
// Group invite accepted
// ============================================================

/**
 * Notify the inviter that their invite was accepted.
 * Called after a group_members update to status "accepted".
 */
export async function notifyGroupAccepted(
  groupId: string,
  accepterId: string,
): Promise<void> {
  if (!isWebPushConfigured()) return;

  const callerId = await getCallerId();
  if (!callerId || callerId !== accepterId) return;

  const admin = createAdminClient();

  const [groupResult, memberResult, accepterResult] = await Promise.all([
    admin.from("groups").select("name").eq("id", groupId).single(),
    admin
      .from("group_members")
      .select("invited_by")
      .eq("group_id", groupId)
      .eq("user_id", accepterId)
      .single(),
    admin
      .from("user_profiles")
      .select("name")
      .eq("id", accepterId)
      .single(),
  ]);

  const groupName = groupResult.data?.name ?? "um grupo";
  const inviterId = memberResult.data?.invited_by;
  const accepterName = accepterResult.data?.name ?? "Alguém";

  if (!inviterId || inviterId === accepterId) return;

  await safeNotify(inviterId, {
    title: "Convite aceito",
    body: `${accepterName} entrou em "${groupName}"`,
    url: `/app/groups/${groupId}`,
    tag: `group-accepted-${groupId}`,
  });
}

// ============================================================
// Expense activated
// ============================================================

/**
 * Notify affected group members when an expense is activated.
 * Called after a successful activate_expense RPC.
 */
export async function notifyExpenseActivated(
  expenseId: string,
): Promise<void> {
  if (!isWebPushConfigured()) return;

  const callerId = await getCallerId();
  if (!callerId) return;

  const admin = createAdminClient();

  const [expenseResult, sharesResult] = await Promise.all([
    admin
      .from("expenses")
      .select("group_id, creator_id, title, total_amount")
      .eq("id", expenseId)
      .single(),
    admin
      .from("expense_shares")
      .select("user_id")
      .eq("expense_id", expenseId),
  ]);

  if (!expenseResult.data) return;
  if (expenseResult.data.creator_id !== callerId) return;

  const { group_id, creator_id, title, total_amount } = expenseResult.data;
  const affectedUserIds = (sharesResult.data ?? []).map((s) => s.user_id);

  // Fetch group name and creator name in parallel
  const [groupResult, creatorResult] = await Promise.all([
    admin.from("groups").select("name").eq("id", group_id).single(),
    admin
      .from("user_profiles")
      .select("name")
      .eq("id", creator_id)
      .single(),
  ]);

  const groupName = groupResult.data?.name ?? "um grupo";
  const creatorName = creatorResult.data?.name ?? "Alguém";
  const amount = formatBRL(total_amount);

  await safeNotifyMany(affectedUserIds, creator_id, {
    title: `Nova despesa em "${groupName}"`,
    body: `${creatorName} adicionou "${title}" — ${amount}`,
    url: `/app/bill/${expenseId}`,
    tag: `expense-${expenseId}`,
  });
}

// ============================================================
// Settlement recorded
// ============================================================

/**
 * Notify the creditor when a settlement is recorded.
 * Called after a successful record_and_settle RPC.
 */
export async function notifySettlementRecorded(
  groupId: string,
  fromUserId: string,
  toUserId: string,
  amountCents: number,
): Promise<void> {
  if (!isWebPushConfigured()) return;

  const callerId = await getCallerId();
  if (!callerId || callerId !== fromUserId) return;

  const admin = createAdminClient();

  const [groupResult, fromUserResult] = await Promise.all([
    admin.from("groups").select("name").eq("id", groupId).single(),
    admin
      .from("user_profiles")
      .select("name")
      .eq("id", fromUserId)
      .single(),
  ]);

  const groupName = groupResult.data?.name ?? "um grupo";
  const fromName = fromUserResult.data?.name ?? "Alguém";
  const amount = formatBRL(amountCents);

  await safeNotify(toUserId, {
    title: "Pagamento registrado",
    body: `${fromName} pagou ${amount} em "${groupName}"`,
    url: `/app/groups/${groupId}`,
    tag: `settlement-${groupId}`,
  });
}
