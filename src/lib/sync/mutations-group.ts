import type { ValidationResult } from "@/lib/expense-money";
import {
  decodeInviteLink,
  decodeMe,
  decodeMutationAck,
  decodeUserProfile,
  decodeVendorCharge,
} from "@/lib/ledger/decode";
import { CLAIM_TOKEN_RE } from "@/lib/claim-qr";
import { getAuthGeneration, rpc, rpcVoid } from "@/lib/sync/client";
import { LedgerError } from "@/lib/sync/errors";
import { refreshGroup } from "@/lib/sync/refresh";
import { useAppStore } from "@/stores/app-store";
import type {
  InviteLink,
  Me,
  MutationAck,
  NotificationPreferences,
  UserProfile,
  VendorCharge,
  WireIssue,
} from "@/types/ledger";
import { notify } from "./mutations";

export interface GuestClaimToken {
  token: string;
  expiresAt: string;
}

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}
const pendingVendorChargeCancellations = new Set<string>();

function decodeGroupId(raw: unknown): ValidationResult<{ groupId: string }, WireIssue> {
  if (isObject(raw) && typeof raw.groupId === "string") {
    return { ok: true, value: { groupId: raw.groupId } };
  }
  return { ok: false, issue: { code: "invalid_wire", path: ["groupId"] } };
}

function decodeGuestClaimToken(raw: unknown): ValidationResult<GuestClaimToken, WireIssue> {
  if (
    isObject(raw) &&
    typeof raw.token === "string" &&
    CLAIM_TOKEN_RE.test(raw.token) &&
    typeof raw.expiresAt === "string" &&
    raw.expiresAt.length > 0
  ) {
    return { ok: true, value: { token: raw.token, expiresAt: raw.expiresAt } };
  }
  return { ok: false, issue: { code: "invalid_wire", path: ["token"] } };
}

function decodeGuestId(raw: unknown): ValidationResult<{ guestId: string }, WireIssue> {
  if (isObject(raw) && typeof raw.guestId === "string") {
    return { ok: true, value: { guestId: raw.guestId } };
  }
  return { ok: false, issue: { code: "invalid_wire", path: ["guestId"] } };
}

function decodeUserProfileOrNull(raw: unknown): ValidationResult<UserProfile | null, WireIssue> {
  if (raw === null) {
    return { ok: true, value: null };
  }
  return decodeUserProfile(raw);
}

export async function createGroup(name: string, memberIds: string[]): Promise<MutationAck> {
  const ack = await rpc("create_group", { p_name: name, p_member_ids: memberIds }, decodeMutationAck);
  await refreshGroup(ack.groupId);
  notify(ack.eventId);
  return ack;
}

export async function inviteMember(groupId: string, userId: string): Promise<MutationAck> {
  const ack = await rpc("invite_member", { p_group_id: groupId, p_user_id: userId }, decodeMutationAck);
  void refreshGroup(groupId);
  notify(ack.eventId);
  return ack;
}

/** Codes that mean the group is authoritatively gone for this caller. */
const ABSENCE_CODES = new Set(["not_a_member", "group_not_found"]);

export async function acceptInvitation(groupId: string): Promise<MutationAck> {
  const generation = getAuthGeneration();
  const ack = await rpc("accept_invitation", { p_group_id: groupId }, decodeMutationAck);

  // Confirm against authoritative membership before reporting success, so the
  // screen never unlocks chat and payment on an unconfirmed transition.
  await refreshGroup(groupId);
  if (getAuthGeneration() !== generation) return ack;

  const meId = useAppStore.getState().me?.id;
  const mine = useAppStore
    .getState()
    .groups[groupId]?.members.find((member) => member.userId === meId);
  if (mine?.status !== "accepted") {
    throw new LedgerError("unknown");
  }
  notify(ack.eventId);
  return ack;
}

export async function declineInvitation(groupId: string): Promise<MutationAck> {
  const generation = getAuthGeneration();
  const ack = await rpc("decline_invitation", { p_group_id: groupId }, decodeMutationAck);

  try {
    await refreshGroup(groupId);
  } catch (error) {
    // After declining, an unreadable group is the expected authoritative
    // outcome rather than a failure to report.
    if (!(error instanceof LedgerError && ABSENCE_CODES.has(error.code))) {
      throw error;
    }
  }

  if (getAuthGeneration() !== generation) return ack;
  useAppStore.getState().removeGroup(groupId);
  notify(ack.eventId);
  return ack;
}

export async function leaveGroup(groupId: string): Promise<MutationAck> {
  const ack = await rpc("leave_group", { p_group_id: groupId }, decodeMutationAck);
  useAppStore.getState().removeGroup(groupId);
  notify(ack.eventId);
  return ack;
}

export async function removeMember(groupId: string, userId: string): Promise<MutationAck> {
  const ack = await rpc("remove_member", { p_group_id: groupId, p_user_id: userId }, decodeMutationAck);
  void refreshGroup(groupId);
  notify(ack.eventId);
  return ack;
}

export async function sendNudge(groupId: string, userId: string): Promise<MutationAck> {
  const ack = await rpc("send_nudge", { p_group_id: groupId, p_user_id: userId }, decodeMutationAck);
  notify(ack.eventId);
  return ack;
}

export async function deleteGroup(groupId: string): Promise<void> {
  await rpc("delete_group", { p_group_id: groupId }, decodeGroupId);
  useAppStore.getState().removeGroup(groupId);
}

export async function getOrCreateDm(userId: string): Promise<{ groupId: string; created: boolean }> {
  const ack = await rpc("get_or_create_dm", { p_user_id: userId }, decodeMutationAck);
  await refreshGroup(ack.groupId);
  return { groupId: ack.groupId, created: ack.created ?? false };
}

export async function createInviteLink(
  groupId: string,
  expiresAt: string | null,
  maxUses: number | null,
): Promise<InviteLink> {
  return await rpc(
    "create_invite_link",
    { p_group_id: groupId, p_expires_at: expiresAt ?? undefined, p_max_uses: maxUses ?? undefined },
    decodeInviteLink,
  );
}

export async function deactivateInviteLink(groupId: string): Promise<void> {
  await rpc("deactivate_invite_link", { p_group_id: groupId }, decodeGroupId);
}

export async function joinViaLink(token: string): Promise<MutationAck> {
  const ack = await rpc("join_via_link", { p_token: token }, decodeMutationAck);
  await refreshGroup(ack.groupId);
  notify(ack.eventId);
  return ack;
}

export async function updateProfile(input: {
  name?: string;
  handle?: string;
  notificationPreferences?: NotificationPreferences;
}): Promise<Me> {
  const me = await rpc(
    "update_profile",
    {
      p_name: input.name,
      p_handle: input.handle,
      p_notification_preferences: input.notificationPreferences,
    },
    decodeMe,
  );
  useAppStore.getState().patch(() => ({ me }));
  return me;
}

export async function lookupUserByHandle(handle: string): Promise<UserProfile | null> {
  return await rpc("lookup_user_by_handle", { p_handle: handle }, decodeUserProfileOrNull);
}

export async function createGuestClaimToken(guestId: string): Promise<GuestClaimToken> {
  return await rpc("create_guest_claim_token", { p_guest_id: guestId }, decodeGuestClaimToken);
}

export async function revokeGuestClaimToken(guestId: string): Promise<void> {
  await rpc("revoke_guest_claim_token", { p_guest_id: guestId }, decodeGuestId);
}

export async function claimGuest(token: string): Promise<MutationAck> {
  const ack = await rpc("claim_guest", { p_token: token }, decodeMutationAck);
  void refreshGroup(ack.groupId);
  notify(ack.eventId);
  return ack;
}

export async function recordVendorCharge(
  amountCents: number,
  description: string | null,
): Promise<VendorCharge> {
  return await rpc(
    "record_vendor_charge",
    { p_amount_cents: amountCents, p_description: description ?? undefined },
    decodeVendorCharge,
  );
}

export async function confirmVendorCharge(chargeId: string): Promise<VendorCharge> {
  return await rpc("confirm_vendor_charge", { p_charge_id: chargeId }, decodeVendorCharge);
}
export async function cancelVendorCharge(chargeId: string): Promise<void> {
  pendingVendorChargeCancellations.add(chargeId);
  await rpcVoid("cancel_vendor_charge", { p_charge_id: chargeId });
  pendingVendorChargeCancellations.delete(chargeId);
}

export async function retryPendingVendorChargeCancellations(): Promise<void> {
  for (const chargeId of pendingVendorChargeCancellations) {
    try {
      await rpcVoid("cancel_vendor_charge", { p_charge_id: chargeId });
      pendingVendorChargeCancellations.delete(chargeId);
    } catch {
      // Keep the work queued until a later explicit retry or session change.
    }
  }
}

export function clearPendingVendorChargeCancellations(): void {
  pendingVendorChargeCancellations.clear();
}

