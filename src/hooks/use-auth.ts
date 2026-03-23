"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@/types";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    async function getUser() {
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();

      if (!authUser) {
        setUser(null);
        setLoading(false);
        return;
      }

      const { data: profile } = await supabase
        .from("users")
        .select("*")
        .eq("id", authUser.id)
        .single();

      if (profile) {
        setUser({
          id: profile.id,
          email: profile.email ?? "",
          handle: profile.handle ?? "",
          name: profile.name,
          phone: profile.phone ?? undefined,
          pixKeyType: profile.pix_key_type,
          pixKeyHint: profile.pix_key_hint,
          avatarUrl: profile.avatar_url ?? undefined,
          onboarded: profile.onboarded,
          createdAt: profile.created_at,
        });
      }

      setLoading(false);
    }

    getUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      getUser();
    });

    return () => subscription.unsubscribe();
  }, []);

  return { user, loading };
}
