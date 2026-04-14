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

/**
 * Send a push notification to all of a user's registered devices.
 * Routes to Web Push or FCM based on the subscription's channel.
 * Automatically cleans up stale subscriptions (expired/unsubscribed).
 */
export async function notifyUser(
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number; cleaned: number }> {
  const admin = createAdminClient();

  const { data: rows, error } = await admin
    .from("push_subscriptions")
    .select("id, subscription, channel")
    .eq("user_id", userId);

  if (error || !rows || rows.length === 0) {
    return { sent: 0, cleaned: 0 };
  }

  let sent = 0;
  let cleaned = 0;
  const staleIds: string[] = [];

  await Promise.all(
    rows.map(async (row) => {
      const channel = (row.channel ?? "web") as SubscriptionChannel;

      let decrypted: string;
      try {
        decrypted = decryptSubscription(row.subscription);
      } catch {
        staleIds.push(row.id);
        return;
      }

      let delivered: boolean;
      if (channel === "fcm") {
        if (!isFcmConfigured()) return;
        delivered = await sendFcmNotification(decrypted, payload);
      } else {
        delivered = await sendPushNotification(decrypted, payload);
      }

      if (delivered) {
        sent++;
      } else {
        staleIds.push(row.id);
      }
    }),
  );

  if (staleIds.length > 0) {
    await admin.from("push_subscriptions").delete().in("id", staleIds);
    cleaned = staleIds.length;
  }

  return { sent, cleaned };
}
