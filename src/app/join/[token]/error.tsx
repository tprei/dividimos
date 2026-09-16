"use client";

import { useEffect } from "react";
import { SyncErrorState } from "@/components/shared/sync-error-state";

export default function JoinError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[JoinError]", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <SyncErrorState
        title="Não conseguimos carregar o convite"
        message="Pode ser a conexão."
        onRetry={reset}
      />
    </div>
  );
}
