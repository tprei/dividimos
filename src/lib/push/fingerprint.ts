import "server-only";
import { createHmac } from "crypto";
import { encryptionKey } from "@/lib/crypto";

export type PushChannel = "web" | "fcm";

/** Stable identity of one physical delivery capability. Keyed HMAC so a
 *  leaked fingerprint cannot be reversed into an endpoint URL. */
export function pushFingerprint(channel: PushChannel, value: string): string {
  return createHmac("sha256", encryptionKey())
    .update(`${channel}:${value}`)
    .digest("hex");
}
