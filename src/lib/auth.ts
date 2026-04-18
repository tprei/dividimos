import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type UserRow = Database["public"]["Tables"]["users"]["Row"];

export const getAuthUser = cache(async () => {
  const supabase = await createClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) return null;

  const [profileResult, prefsResult] = await Promise.all([
    supabase
      .from("users")
      .select("*")
      .eq("id", authUser.id)
      .single(),
    supabase
      .from("notification_preferences")
      .select("preferences")
      .eq("user_id", authUser.id)
      .single(),
  ]);

  if (!profileResult.data) return null;

  const p = profileResult.data as UserRow;
  const prefs = (prefsResult.data?.preferences ?? {}) as Record<string, boolean>;
  return {
    id: p.id,
    email: p.email ?? "",
    handle: p.handle ?? "",
    name: p.name,
    pixKeyType: p.pix_key_type,
    pixKeyHint: p.pix_key_hint,
    avatarUrl: p.avatar_url ?? undefined,
    onboarded: p.onboarded,
    createdAt: p.created_at,
    notificationPreferences: prefs,
  };
});
