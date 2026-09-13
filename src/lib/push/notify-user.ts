import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptPixKey as decrypt } from "@/lib/crypto";
import { sendPushNotification, type PushPayload } from "./web-push";
import { sendFcmNotification, isFcmConfigured } from "./fcm";

/**
 * Decrypt a push subscription stored in the DB.
 * Push subscriptions are encrypted with the same AES-256-GCM scheme as Pix keys.
 */
function decryptSubscription(encrypted: string): string {
  return decrypt(encrypted);
}

type SubscriptionChannel = "web" | "fcm";

/** What one dispatch achieved. `failed` devices are worth retrying later. */
export interface DispatchOutcome {
  sent: number;
  cleaned: number;
  failed: number;
}

type DeviceOutcome = "sent" | "stale" | "failed";

/**
 * Send a push notification to all of a user's registered devices.
 * Routes to Web Push or FCM based on the subscription's channel.
 *
 * Every device settles independently: one rejecting provider can neither
 * abort its siblings nor skip stale-row cleanup, and the returned counts
 * always describe what actually happened.
 */
export async function notifyUser(
  userId: string,
  payload: PushPayload,
): Promise<DispatchOutcome> {
  const admin = createAdminClient();

  const { data: rows, error } = await admin
    .from("push_subscriptions")
    .select("id, subscription_encrypted, channel")
    .eq("user_id", userId);

  if (error !== null) return { sent: 0, cleaned: 0, failed: 1 };
  if (!rows || rows.length === 0) return { sent: 0, cleaned: 0, failed: 0 };

  // Defense-in-depth: cap concurrent sends even if the DB-level
  // subscription cap is somehow bypassed.
  const capped = rows.slice(0, 10);

  const settled = await Promise.allSettled(
    capped.map(async (row): Promise<DeviceOutcome> => {
      const channel = (row.channel ?? "web") as SubscriptionChannel;

      let decrypted: string;
      try {
        decrypted = decryptSubscription(row.subscription_encrypted);
      } catch {
        // An undecryptable row can never be delivered to again.
        return "stale";
      }

      if (channel === "fcm") {
        // No provider credentials is a dispatch failure, not a silent success.
        if (!isFcmConfigured()) return "failed";
        return (await sendFcmNotification(decrypted, payload)) ? "sent" : "stale";
      }

      const outcome = await sendPushNotification(decrypted, payload);
      if (outcome.status === "accepted") return "sent";
      return outcome.status === "stale" ? "stale" : "failed";
    }),
  );

  let sent = 0;
  let failed = 0;
  const staleIds: string[] = [];

  settled.forEach((result, index) => {
    if (result.status === "rejected") {
      failed++;
      return;
    }
    if (result.value === "sent") sent++;
    else if (result.value === "failed") failed++;
    else staleIds.push(capped[index]!.id);
  });

  let cleaned = 0;
  if (staleIds.length > 0) {
    const { error: deleteError } = await admin
      .from("push_subscriptions")
      .delete()
      .in("id", staleIds);
    if (deleteError === null) cleaned = staleIds.length;
  }

  return { sent, cleaned, failed };
}
