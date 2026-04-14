import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export const getAuthUser = cache(async () => {
  const supabase = await createClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) return null;

  const { data: profile } = await supabase
    .from("users")
    .select("*")
    .eq("id", authUser.id)
    .single();

  if (!profile) return null;

  return {
    id: profile.id,
    email: profile.email ?? "",
    handle: profile.handle ?? "",
    name: profile.name,
    pixKeyType: profile.pix_key_type,
    pixKeyHint: profile.pix_key_hint,
    avatarUrl: profile.avatar_url ?? undefined,
    onboarded: profile.onboarded,
    createdAt: profile.created_at,
  };
});
