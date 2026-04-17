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

    async function fetchProfile(userId: string) {
      const { data: profile } = await supabase
        .from("users")
        .select("*")
        .eq("id", userId)
        .single();

      if (profile) {
        const p = profile as UserRow;
        setUser({
          id: p.id,
          email: p.email ?? "",
          handle: p.handle ?? "",
          name: p.name,
          pixKeyType: p.pix_key_type,
          pixKeyHint: p.pix_key_hint,
          avatarUrl: p.avatar_url ?? undefined,
          onboarded: p.onboarded,
          createdAt: p.created_at,
          notificationPreferences: (p.notification_preferences ?? {}) as Record<string, boolean>,
        });
      }
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        lastAuthUserId.current = null;
        setUser(null);
        return;
      }

      if (event === "SIGNED_IN" || event === "USER_UPDATED") {
        const userId = session?.user?.id;
        if (!userId || userId === lastAuthUserId.current) return;
        lastAuthUserId.current = userId;
        fetchProfile(userId);
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
