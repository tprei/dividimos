import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { User } from "@/types";
import type { Database } from "@/types/database";

type UserRow = Database["public"]["Tables"]["users"]["Row"];

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

  const p = profile as UserRow;
  return {
    id: p.id,
    email: p.email ?? "",
    handle: p.handle ?? "",
    name: p.name,
    phone: p.phone ?? undefined,
    pixKeyType: p.pix_key_type,
    pixKeyHint: p.pix_key_hint,
    avatarUrl: p.avatar_url ?? undefined,
    onboarded: p.onboarded,
    createdAt: p.created_at,
  };
});
