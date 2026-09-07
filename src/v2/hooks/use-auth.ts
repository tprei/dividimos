"use client";

import { useMemo } from "react";
import { useAppStore } from "@/stores/app-store";
import type { User } from "@/types";
import type { Me } from "@/types/ledger";

export type AuthStatus =
  | "loading"
  | "authenticated"
  | "unauthenticated"
  | "error";

export type AuthIdentitySnapshot =
  | { status: "loading"; userId: string | null; generation: number; user: null }
  | {
      status: "authenticated";
      userId: string;
      generation: number;
      user: User;
    }
  | {
      status: "unauthenticated";
      userId: null;
      generation: number;
      user: null;
    }
  | { status: "error"; userId: string; generation: number; user: null };

export function meToLegacyUser(me: Me): User {
  return {
    id: me.id,
    email: me.email,
    handle: me.handle,
    name: me.name,
    pixKeyType: me.pixKeyType ?? "email",
    pixKeyHint: me.pixKeyHint ?? "",
    avatarUrl: me.avatarUrl ?? undefined,
    onboarded: me.onboarded,
    createdAt: "",
    notificationPreferences: me.notificationPreferences,
  };
}

export function useAuth(): AuthIdentitySnapshot {
  const hydrated = useAppStore((s) => s.hydrated);
  const me = useAppStore((s) => s.me);

  return useMemo<AuthIdentitySnapshot>(() => {
    if (!hydrated) {
      return {
        status: "loading",
        userId: me?.id ?? null,
        generation: 0,
        user: null,
      };
    }

    if (me) {
      return {
        status: "authenticated",
        userId: me.id,
        generation: 0,
        user: meToLegacyUser(me),
      };
    }

    return {
      status: "unauthenticated",
      userId: null,
      generation: 0,
      user: null,
    };
  }, [hydrated, me]);
}

export function useUser(): User | null {
  const auth = useAuth();
  return auth.user;
}
