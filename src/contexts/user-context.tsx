"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@/types";
import type { Database } from "@/types/database";

type UserRow = Database["public"]["Tables"]["users"]["Row"];

interface UserContextValue {
  user: User | null;
}

const UserContext = createContext<UserContextValue>({ user: null });

export function UserProvider({
  initialUser,
  children,
}: {
  initialUser: User | null;
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<User | null>(initialUser);
  const lastAuthUserId = useRef<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    async function refreshUser() {
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();

      if (!authUser) {
        lastAuthUserId.current = null;
        setUser(null);
        return;
      }

      if (authUser.id === lastAuthUserId.current) {
        return;
      }

      lastAuthUserId.current = authUser.id;

      const { data: profile } = await supabase
        .from("users")
        .select("*")
        .eq("id", authUser.id)
        .single();

      if (profile) {
        const p = profile as UserRow;
        setUser({
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
        });
      }
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        refreshUser();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return <UserContext.Provider value={{ user }}>{children}</UserContext.Provider>;
}

export function useUser() {
  return useContext(UserContext).user;
}

export function useAuth(): { user: User | null; loading: boolean } {
  return { user: useContext(UserContext).user, loading: false };
}
