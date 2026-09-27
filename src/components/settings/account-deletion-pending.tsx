"use client";

import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { BRAND } from "@/lib/brand";

export interface AccountDeletionPendingProps {
  busy: boolean;
  error: string | null;
  onRetry: () => void;
}

export function AccountDeletionPending({ busy, error, onRetry }: AccountDeletionPendingProps): React.JSX.Element {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center overflow-y-auto px-4 py-6" aria-busy={busy}>
      <div className="w-full max-w-sm space-y-6 rounded-2xl border bg-card p-6">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground"><ShieldCheck aria-hidden="true" className="size-6" /></div>
        <div className="space-y-3"><h1 className="text-2xl font-bold leading-tight">Falta encerrar o acesso</h1><p className="text-base leading-relaxed text-muted-foreground">Seus dados já foram apagados ou anonimizados. Vamos concluir a exclusão da sua conta do Dividimos.</p></div>
        {error && <p role="alert" className="text-sm leading-relaxed text-destructive-text">{error}</p>}
        <div className="space-y-2">
          <Button size="lg" className="w-full" disabled={busy} onClick={onRetry}>{busy ? "Encerrando o acesso…" : error ? "Tentar novamente" : "Concluir exclusão"}</Button>
          {busy && <p role="status" className="sr-only">Encerrando o acesso…</p>}
          {error && <a href={`mailto:${BRAND.contact}`} className={buttonVariants({ variant: "outline", size: "lg", className: "w-full" })}>Falar com o suporte</a>}
        </div>
      </div>
    </main>
  );
}
