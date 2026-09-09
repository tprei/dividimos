"use client";

import { useCallback, useState } from "react";
import { signOut as requestSignOut, type SignOutResult } from "@/lib/sync/auth";

export interface UseSignOutResult {
  pending: boolean;
  error: string | null;
  signOut: () => Promise<SignOutResult>;
  retry: () => Promise<SignOutResult>;
}

export function useSignOut(): UseSignOutResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async (): Promise<SignOutResult> => {
    if (pending) {
      return { ok: false, error: new Error("Sign out already in progress") };
    }

    setPending(true);
    setError(null);
    try {
      const result = await requestSignOut();
      if (!result.ok) setError("Não foi possível sair");
      return result;
    } finally {
      setPending(false);
    }
  }, [pending]);

  return { pending, error, signOut: execute, retry: execute };
}
