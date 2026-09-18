"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GlobalError]", error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body className="bg-background font-sans text-foreground">
        <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col items-center justify-center px-6 text-center">
          <h1 className="text-xl font-bold">Não foi possível carregar</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Não foi possível carregar esta página. Tente novamente em instantes.
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-5 min-h-11 w-full max-w-xs rounded-lg border border-border bg-card px-4 text-sm font-medium"
          >
            Tentar novamente
          </button>
        </main>
      </body>
    </html>
  );
}
