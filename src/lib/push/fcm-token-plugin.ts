import { registerPlugin } from "@capacitor/core";

/**
 * iOS-only companion to `@capacitor/push-notifications`: the native
 * AppDelegate maps APNs to an FCM registration token, and `deleteToken()`
 * invalidates that registration at Firebase. Android's own
 * `PushNotifications.unregister()` already deletes its FCM token natively,
 * so this plugin ships only on iOS — callers must gate on
 * `Capacitor.isPluginAvailable("FcmToken")`.
 */
export interface FcmTokenPlugin {
  deleteToken(): Promise<void>;
}

export const FcmToken = registerPlugin<FcmTokenPlugin>("FcmToken");
