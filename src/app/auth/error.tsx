"use client";

import { useEffect } from "react";
import Link from "next/link";
import { SyncErrorState } from "@/components/shared/sync-error-state";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[AuthError]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
      <SyncErrorState
        message="Não foi possível carregar esta página. Tente novamente em instantes."
        onRetry={reset}
      />
      <Link
        href="/"
        className={cn(buttonVariants({ variant: "outline" }), "mt-2 w-full max-w-xs min-h-11 rounded-lg")}
      >
        Voltar ao início
      </Link>
    </div>
  );
}
