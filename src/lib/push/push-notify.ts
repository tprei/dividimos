"use server";
import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatBRL } from "@/lib/currency";
import { isWebPushConfigured } from "./web-push";
import { isFcmConfigured } from "./fcm";
import { notifyUser } from "./notify-user";
import type { PushPayload } from "./web-push";
import type { NotificationCategory } from "@/types";

function isAnyPushConfigured(): boolean {
  return isWebPushConfigured() || isFcmConfigured();
}

async function getCallerId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * Resolve a group's display context for notifications. DM groups have no
 * meaningful `name`; return the counterparty's name instead so titles like
 * "Nova despesa em '{name}'" don't render with an empty string.
 */
async function getGroupNotificationContext(
  groupId: string,
  callerId: string,
): Promise<{ displayName: string; isDm: boolean }> {
  const admin = createAdminClient();
  const { data: group } = await admin
    .from("groups")
    .select("name, is_dm")
    .eq("id", groupId)
    .single();

  if (!group) return { displayName: "um grupo", isDm: false };
  if (!group.is_dm) return { displayName: group.name ?? "um grupo", isDm: false };

  const { data: dmPair } = await admin
    .from("dm_pairs")
    .select("user_a, user_b")
    .eq("group_id", groupId)
    .single();

  const counterpartyId = dmPair
    ? dmPair.user_a === callerId
      ? dmPair.user_b
      : dmPair.user_b === callerId
        ? dmPair.user_a
        : null
    : null;

  if (!counterpartyId) return { displayName: "", isDm: true };

  const { data: profile } = await admin
    .from("user_profiles")
    .select("name")
    .eq("id", counterpartyId)
    .single();

  return { displayName: profile?.name ?? "", isDm: true };
}

/**
 * Check whether a user has a notification category enabled.
 * Missing key = enabled (opt-out model).
 */
export async function checkPreference(
  userId: string,
  category: NotificationCategory,
): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("users")
    .select("notification_preferences")
    .eq("id", userId)
    .single();
  if (!data) return true;
  const prefs = (data.notification_preferences ?? {}) as Record<string, boolean>;
  return prefs[category] !== false;
}

/**
 * Fire-and-forget wrapper that swallows all errors.
 * Push notification failure must never break the primary action.
 */
async function safeNotify(
  userId: string,
  payload: PushPayload,
  category: NotificationCategory,
): Promise<void> {
  if (!isAnyPushConfigured()) return;
  try {
    const enabled = await checkPreference(userId, category);
    if (!enabled) return;
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
  category: NotificationCategory,
): Promise<void> {
  const recipients = userIds.filter((id) => id !== excludeUserId);
  if (recipients.length === 0) return;
  await Promise.all(recipients.map((id) => safeNotify(id, payload, category)));
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
  if (!isAnyPushConfigured()) return;

  const callerId = await getCallerId();
  if (!callerId) return;

  const admin = createAdminClient();

  // Caller must be the group creator OR an accepted member.
  // Group creators have no row in group_members — they're tracked via
  // groups.creator_id — so membership-only checks would skip notifies from
  // the creator, which is the most common path.
  const [groupResult, memberCountResult, inviterResult] = await Promise.all([
    admin.from("groups").select("name, creator_id").eq("id", groupId).single(),
    admin
      .from("group_members")
      .select("*", { count: "exact", head: true })
      .eq("group_id", groupId)
      .eq("user_id", callerId)
      .eq("status", "accepted"),
    admin
      .from("group_members")
      .select("invited_by")
      .eq("group_id", groupId)
      .eq("user_id", inviteeId)
      .eq("status", "invited")
      .single(),
  ]);

  const isMember = (memberCountResult.count ?? 0) > 0;
  const isCreator = groupResult.data?.creator_id === callerId;
  if (!isMember && !isCreator) return;

  if (!inviterResult.data) return;
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
    url: `/app/groups/${groupId}`,
    tag: `group-invite-${groupId}`,
  }, "groups");
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
  if (!isAnyPushConfigured()) return;

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
      .eq("status", "accepted")
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

  if (!memberResult.data || !inviterId || inviterId === accepterId) return;

  await safeNotify(inviterId, {
    title: "Convite aceito",
    body: `${accepterName} entrou em "${groupName}"`,
    url: `/app/groups/${groupId}`,
    tag: `group-accepted-${groupId}`,
  }, "groups");
}

// ============================================================
// Expense activated
// ============================================================

/**
 * Notify affected group members when an expense is activated.
 *
 * Requires a committed one-shot activation event: the atomic claim UPDATE
 * below only matches a row that is `status = 'active'`, was created by the
 * caller, and has never been claimed before (`activation_notified_at IS
 * NULL`). Draft, settled, nonexistent, noncreator, and replayed calls all
 * fail that single WHERE clause and return zero rows, so this function
 * sends nothing for any of them. Exactly one concurrent caller can ever
 * observe a returned row for a given expense.
 */
export async function notifyExpenseActivated(
  expenseId: string,
): Promise<void> {
  if (!isAnyPushConfigured()) return;

  const callerId = await getCallerId();
  if (!callerId) return;

  const admin = createAdminClient();

  const [claimResult, sharesResult] = await Promise.all([
    admin
      .from("expenses")
      .update({ activation_notified_at: new Date().toISOString() })
      .eq("id", expenseId)
      .eq("status", "active")
      .eq("creator_id", callerId)
      .is("activation_notified_at", null)
      .select("group_id, creator_id, title, total_amount")
      .maybeSingle(),
    admin
      .from("expense_shares")
      .select("user_id")
      .eq("expense_id", expenseId),
  ]);

  if (!claimResult.data) return;

  const { group_id, creator_id, title, total_amount } = claimResult.data;
  const affectedUserIds = (sharesResult.data ?? []).map((s) => s.user_id);

  const [creatorResult, groupContext] = await Promise.all([
    admin.from("user_profiles").select("name").eq("id", creator_id).single(),
    getGroupNotificationContext(group_id, callerId),
  ]);

  const creatorName = creatorResult.data?.name ?? "Alguém";
  const amount = formatBRL(total_amount);

  const notificationTitle = groupContext.isDm
    ? "Nova despesa"
    : `Nova despesa em "${groupContext.displayName}"`;

  await safeNotifyMany(affectedUserIds, creator_id, {
    title: notificationTitle,
    body: `${creatorName} adicionou "${title}" — ${amount}`,
    url: groupContext.isDm
      ? `/app/conversations/${creator_id}`
      : `/app/bill/${expenseId}`,
    tag: `expense-${expenseId}`,
  }, "expenses");
}

// ============================================================
// Settlement recorded
// ============================================================

/**
 * Notify the other party when a settlement is recorded.
 * Derives every field from the committed settlement row so a caller
 * cannot forge the parties, amount, or group. The caller must be one
 * of the two settlement participants (verified server-side via session).
 *
 * Two directions, depending on who initiated:
 *   - Pay mode    (caller = debtor/fromUser): notify the creditor
 *                  "{payer} pagou {amount}"
 *   - Collect mode (caller = creditor/toUser): notify the debtor
 *                   "{creditor} marcou seu pagamento de {amount} como recebido"
 */
export async function notifySettlementRecorded(
  settlementId: string,
): Promise<void> {
  if (!isAnyPushConfigured()) return;

  const callerId = await getCallerId();
  if (!callerId) return;

  const admin = createAdminClient();

  // Atomically claim the notification one-shot: the conditional UPDATE
  // matches only a confirmed settlement that has never been notified.
  // The first caller gets a row back; all subsequent calls (replay,
  // concurrent tabs) and any pending/nonexistent settlement get null.
  const { data: settlement } = await admin
    .from("settlements")
    .update({ notification_sent_at: new Date().toISOString() })
    .eq("id", settlementId)
    .eq("status", "confirmed")
    .is("notification_sent_at", null)
    .select("group_id, from_user_id, to_user_id, amount_cents")
    .maybeSingle();

  if (!settlement) return;

  const groupId = settlement.group_id as string;
  const fromUserId = settlement.from_user_id as string;
  const toUserId = settlement.to_user_id as string;
  const amountCents = settlement.amount_cents as number;

  const callerIsFromUser = callerId === fromUserId;
  const callerIsToUser = callerId === toUserId;
  if (!callerIsFromUser && !callerIsToUser) return;

  const recipientId = callerIsFromUser ? toUserId : fromUserId;
  const counterpartyId = callerIsFromUser ? fromUserId : toUserId;

  const [counterpartyResult, groupContext] = await Promise.all([
    admin
      .from("user_profiles")
      .select("name")
      .eq("id", counterpartyId)
      .single(),
    getGroupNotificationContext(groupId, callerId),
  ]);

  const counterpartyName = counterpartyResult.data?.name ?? "Alguém";
  const amount = formatBRL(amountCents);

  const body = callerIsFromUser
    ? (groupContext.isDm
        ? `${counterpartyName} pagou ${amount}`
        : `${counterpartyName} pagou ${amount} em "${groupContext.displayName}"`)
    : (groupContext.isDm
        ? `${counterpartyName} marcou seu pagamento de ${amount} como recebido`
        : `${counterpartyName} marcou seu pagamento de ${amount} como recebido em "${groupContext.displayName}"`);

  await safeNotify(recipientId, {
    title: "Pagamento registrado",
    body,
    url: groupContext.isDm
      ? `/app/conversations/${counterpartyId}`
      : `/app/groups/${groupId}`,
    tag: `settlement-${groupId}`,
  }, "settlements");
}

// ============================================================
// Payment nudge (creditor → debtor reminder)
// ============================================================

/**
 * Notify the debtor that the creditor is requesting payment.
 * Delegates all authority, balance verification, and cooldown to the
 * claim_nudge RPC, which atomically checks accepted membership, reads
 * the committed directed balance, enforces a 24-hour server-side
 * cooldown, and returns the owed amount. The notification is only sent
 * if the RPC returns a row.
 */
export async function notifyPaymentNudge(
  groupId: string,
  debtorId: string,
): Promise<void> {
  if (!isAnyPushConfigured()) return;

  const callerId = await getCallerId();
  if (!callerId || callerId === debtorId) return;

  const admin = createAdminClient();

  const { data: claimResult } = await admin.rpc("claim_nudge", {
    p_group_id: groupId,
    p_debtor_id: debtorId,
  });

  if (!claimResult || claimResult.length === 0) return;

  const amountCents = (claimResult as { amount_cents: number }[])[0].amount_cents;

  const [creditorResult, groupContext] = await Promise.all([
    admin.from("user_profiles").select("name").eq("id", callerId).single(),
    getGroupNotificationContext(groupId, callerId),
  ]);

  const creditorName = creditorResult.data?.name ?? "Alguém";
  const amount = formatBRL(amountCents);

  const body = groupContext.isDm
    ? `${creditorName} pediu ${amount}`
    : `${creditorName} pediu ${amount} em "${groupContext.displayName}"`;

  await safeNotify(debtorId, {
    title: "Lembrete de pagamento",
    body,
    url: groupContext.isDm
      ? `/app/conversations/${callerId}`
      : `/app/groups/${groupId}`,
    tag: `nudge-${groupId}-${callerId}`,
  }, "nudges");
}


// ============================================================
// DM text message
// ============================================================

/**
 * Notify the counterparty when a text message is sent in a DM conversation.
 * Derives the message preview from the latest committed chat_messages row
 * sent by the caller, so a client cannot inject arbitrary notification text.
 */
export async function notifyDmTextMessage(
  groupId: string,
): Promise<void> {
  if (!isAnyPushConfigured()) return;

  const callerId = await getCallerId();
  if (!callerId) return;

  const admin = createAdminClient();

  const [dmPairResult, latestMessageResult] = await Promise.all([
    admin
      .from("dm_pairs")
      .select("user_a, user_b")
      .eq("group_id", groupId)
      .single(),
    admin
      .from("chat_messages")
      .select("content")
      .eq("group_id", groupId)
      .eq("sender_id", callerId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
  ]);

  const dmPair = dmPairResult.data;
  if (!dmPair || !latestMessageResult.data) return;

  const recipientId =
    dmPair.user_a === callerId ? dmPair.user_b : dmPair.user_b === callerId ? dmPair.user_a : null;
  if (!recipientId) return;

  const { data: senderProfile } = await admin
    .from("user_profiles")
    .select("name")
    .eq("id", callerId)
    .single();

  const senderName = senderProfile?.name ?? "Alguém";
  const messagePreview = latestMessageResult.data.content as string;
  const truncated =
    messagePreview.length > 80
      ? messagePreview.slice(0, 77) + "…"
      : messagePreview;

  await safeNotify(recipientId, {
    title: senderName,
    body: truncated,
    url: `/app/conversations/${callerId}`,
    tag: `dm-${groupId}`,
  }, "messages");
}
