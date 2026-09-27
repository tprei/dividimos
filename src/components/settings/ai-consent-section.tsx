"use client";

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/shared/skeleton";

export interface AiConsentSectionProps {
  granted: boolean;
  status: "idle" | "loading" | "error" | "success" | "empty";
  errorMessage: string | null;
  onRevoke: (anchor: HTMLButtonElement) => void;
}

export function AiConsentSection({ granted, status, errorMessage, onRevoke }: AiConsentSectionProps): React.JSX.Element {
  const allowed = granted && status !== "success";
  return (
    <section className="mt-6" aria-labelledby="ai-consent-heading">
      <h2 id="ai-consent-heading" className="mb-3 text-lg font-bold">Inteligência artificial</h2>
      <div className="space-y-3 rounded-2xl border bg-card p-4" aria-busy={status === "loading" || status === "empty"}>
        {status === "empty" ? <div role="status" aria-label="Carregando sua permissão…" className="space-y-2"><Skeleton className="h-5 w-48" /><Skeleton className="h-10 w-full" /></div> : <>
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Sparkles aria-hidden="true" className="size-5" /></div>
            <div className="min-w-0 space-y-1"><p className="text-base font-semibold">{allowed ? "Uso de IA permitido" : "Uso de IA não permitido"}</p><p className="text-sm leading-relaxed text-muted-foreground">{allowed ? "Notas, voz e texto podem ser enviados para os serviços informados na sua permissão." : "Você pode preencher despesas manualmente. Vamos pedir sua permissão quando você escolher um recurso de IA."}</p></div>
          </div>
          {status === "error" && <p role="alert" className="text-sm text-destructive-text">{errorMessage}</p>}
          {status === "success" && <p role="status" className="text-sm">Permissão de IA revogada.</p>}
          {allowed && <Button variant="outline" size="lg" className="w-full" disabled={status === "loading"} onClick={(event) => onRevoke(event.currentTarget)}>{status === "loading" ? "Revogando…" : "Revogar permissão"}</Button>}
        </>}
      </div>
    </section>
  );
}
