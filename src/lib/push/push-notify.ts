"use server";

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
      .single(),
  ]);

  const isMember = (memberCountResult.count ?? 0) > 0;
  const isCreator = groupResult.data?.creator_id === callerId;
  if (!isMember && !isCreator) return;

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
  }, "groups");
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
  if (!isAnyPushConfigured()) return;

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
 * Called after a successful record_and_settle RPC.
 *
 * Two directions, depending on who initiated:
 *   - Pay mode    (caller = debtor/fromUser): notify the creditor
 *                  "{payer} pagou {amount}"
 *   - Collect mode (caller = creditor/toUser): notify the debtor
 *                   "{creditor} marcou seu pagamento de {amount} como recebido"
 *
 * Previously the guard only accepted `callerId === fromUserId`, so the
 * "Cobrar" flow (creditor records an incoming payment) silently dropped
 * every notification. Both directions now flow through a single function.
 */
export async function notifySettlementRecorded(
  groupId: string,
  fromUserId: string,
  toUserId: string,
  amountCents: number,
): Promise<void> {
  if (!isAnyPushConfigured()) return;

  const callerId = await getCallerId();
  if (!callerId) return;

  const callerIsFromUser = callerId === fromUserId;
  const callerIsToUser = callerId === toUserId;
  if (!callerIsFromUser && !callerIsToUser) return;

  const recipientId = callerIsFromUser ? toUserId : fromUserId;
  const counterpartyId = callerIsFromUser ? fromUserId : toUserId;

  const admin = createAdminClient();

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
 * Called from the settlement UI when creditor taps "Lembrar".
 * Rate limiting is enforced client-side (localStorage cooldown).
 */
export async function notifyPaymentNudge(
  groupId: string,
  debtorId: string,
  amountCents: number,
): Promise<void> {
  if (!isAnyPushConfigured()) return;

  const callerId = await getCallerId();
  if (!callerId || callerId === debtorId) return;

  const admin = createAdminClient();

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
// Expense edited
// ============================================================

/**
 * Notify affected group members when an active expense is edited.
 * Accepts pre-fetched data so it works even if the caller already
 * updated the row.
 */
export async function notifyExpenseEdited(
  expenseId: string,
  groupId: string,
  title: string,
  affectedUserIds: string[],
): Promise<void> {
  if (!isAnyPushConfigured()) return;

  const callerId = await getCallerId();
  if (!callerId) return;

  const admin = createAdminClient();

  const [groupResult, editorResult] = await Promise.all([
    admin.from("groups").select("name").eq("id", groupId).single(),
    admin
      .from("user_profiles")
      .select("name")
      .eq("id", callerId)
      .single(),
  ]);

  const groupName = groupResult.data?.name ?? "um grupo";
  const editorName = editorResult.data?.name ?? "Alguém";

  await safeNotifyMany(affectedUserIds, callerId, {
    title: `Despesa editada em "${groupName}"`,
    body: `${editorName} editou "${title}"`,
    url: `/app/bill/${expenseId}`,
    tag: `expense-edited-${expenseId}`,
  }, "expenses");
}

// ============================================================
// Expense deleted
// ============================================================

/**
 * Notify affected group members when an expense is deleted.
 * Accepts pre-fetched data since the expense row may already
 * be gone by the time this runs.
 */
export async function notifyExpenseDeleted(
  groupId: string,
  title: string,
  affectedUserIds: string[],
): Promise<void> {
  if (!isAnyPushConfigured()) return;

  const callerId = await getCallerId();
  if (!callerId) return;

  const admin = createAdminClient();

  const [groupResult, deleterResult] = await Promise.all([
    admin.from("groups").select("name").eq("id", groupId).single(),
    admin
      .from("user_profiles")
      .select("name")
      .eq("id", callerId)
      .single(),
  ]);

  const groupName = groupResult.data?.name ?? "um grupo";
  const deleterName = deleterResult.data?.name ?? "Alguém";

  await safeNotifyMany(affectedUserIds, callerId, {
    title: `Despesa removida em "${groupName}"`,
    body: `${deleterName} removeu "${title}"`,
    url: `/app/groups/${groupId}`,
    tag: `expense-deleted-${groupId}`,
  }, "expenses");
}

// ============================================================
// DM text message
// ============================================================

/**
 * Notify the counterparty when a text message is sent in a DM conversation.
 * Called after a successful sendChatMessage in a DM group.
 */
export async function notifyDmTextMessage(
  groupId: string,
  messagePreview: string,
): Promise<void> {
  if (!isAnyPushConfigured()) return;

  const callerId = await getCallerId();
  if (!callerId) return;

  const admin = createAdminClient();

  const { data: dmPair } = await admin
    .from("dm_pairs")
    .select("user_a, user_b")
    .eq("group_id", groupId)
    .single();

  if (!dmPair) return;

  const recipientId =
    dmPair.user_a === callerId ? dmPair.user_b : dmPair.user_b === callerId ? dmPair.user_a : null;
  if (!recipientId) return;

  const { data: senderProfile } = await admin
    .from("user_profiles")
    .select("name")
    .eq("id", callerId)
    .single();

  const senderName = senderProfile?.name ?? "Alguém";
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
