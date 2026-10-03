import type { NotificationCategory, NotificationPreferences } from "@/types";
import type { Json } from "@/types/database";

const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  "expenses",
  "settlements",
  "nudges",
  "groups",
  "messages",
];

/** Decodes a stored `notification_preferences` JSON column; absent means on. */
export function readPreferences(json: Json | null): NotificationPreferences {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return {};
  }
  const prefs: NotificationPreferences = {};
  for (const category of NOTIFICATION_CATEGORIES) {
    const value = json[category];
    if (typeof value === "boolean") {
      prefs[category] = value;
    }
  }
  return prefs;
}
