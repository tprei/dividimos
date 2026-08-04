"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { NotificationPreferences } from "@/types";

const VALID_CATEGORIES = new Set([
  "expenses",
  "settlements",
  "nudges",
  "groups",
  "messages",
]);

/**
 * Save the caller's per-category notification preferences.
 *
 * `expectedUserId` is untrusted: a debounced save can be released after the
 * client has already changed accounts. Fresh server auth is compared before
 * the admin client is constructed, so a mismatched call performs no
 * privileged work, and the row written is the verified current user.
 */
export async function updateNotificationPreferences(
  expectedUserId: string,
  prefs: NotificationPreferences,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== expectedUserId) return { error: "Não autenticado" };

  const sanitized: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(prefs)) {
    if (VALID_CATEGORIES.has(key) && typeof value === "boolean") {
      sanitized[key] = value;
    }
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("users")
    .update({ notification_preferences: sanitized })
    .eq("id", user.id);

  if (error) return { error: "Erro ao salvar preferências" };
  return {};
}
