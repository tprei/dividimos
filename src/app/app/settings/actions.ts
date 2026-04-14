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

export async function updateNotificationPreferences(
  prefs: NotificationPreferences,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado" };

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
