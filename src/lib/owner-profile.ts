import type {
  NotificationCategory,
  NotificationPreferences,
  User,
} from "@/types";
import { isPixKeyType } from "./type-guards";

const NOTIFICATION_CATEGORIES = [
  "expenses",
  "settlements",
  "nudges",
  "groups",
  "messages",
] as const;

function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNotificationPreferences(
  value: unknown,
): value is NotificationPreferences {
  if (!isPlainObject(value)) return false;
  for (const [key, val] of Object.entries(value)) {
    if (!NOTIFICATION_CATEGORIES.includes(key as NotificationCategory)) {
      return false;
    }
    if (typeof val !== "boolean") return false;
  }
  return true;
}

/**
 * Decode a single row from the owner-only `get_my_profile` RPC into a `User`.
 * Returns `null` for any row that is not a complete, well-formed self-profile
 * so a stale or malformed row can never become a partial identity.
 */
export function mapOwnerProfileRow(row: unknown): User | null {
  if (!isPlainObject(row)) return null;

  const {
    id,
    email,
    handle,
    name,
    avatar_url: avatarUrlRaw,
    onboarded,
    created_at: createdAt,
    notification_preferences: preferences,
    pix_key_type: pixKeyType,
    pix_key_hint: pixKeyHint,
  } = row;

  if (typeof id !== "string") return null;
  if (typeof name !== "string") return null;
  if (typeof pixKeyHint !== "string") return null;
  if (typeof createdAt !== "string") return null;

  if (email !== null && typeof email !== "string") return null;
  if (handle !== null && typeof handle !== "string") return null;
  if (avatarUrlRaw !== null && typeof avatarUrlRaw !== "string") return null;

  if (typeof onboarded !== "boolean") return null;
  if (!isPixKeyType(pixKeyType)) return null;
  if (!isNotificationPreferences(preferences)) return null;

  return {
    id,
    email: email ?? "",
    handle: handle ?? "",
    name,
    pixKeyType,
    pixKeyHint,
    avatarUrl: avatarUrlRaw ?? undefined,
    onboarded,
    createdAt,
    notificationPreferences: preferences,
  };
}
