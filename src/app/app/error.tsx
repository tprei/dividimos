"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { SyncErrorState } from "@/components/shared/sync-error-state";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[AppError]", error);
  }, [error]);

  return (
    <AppShell>
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
        <SyncErrorState
          title="Não foi possível carregar"
          message="Não foi possível carregar esta página. Tente novamente em instantes."
          onRetry={reset}
        />
        <Link
          href="/app"
          className={cn(buttonVariants({ variant: "outline" }), "mt-2 w-full max-w-xs min-h-11 rounded-lg")}
        >
          Voltar ao início
        </Link>
      </div>
    </AppShell>
  );
}
