"use client";

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface AiConsentSectionProps {
  granted: boolean;
  onRevoke: (anchor: HTMLButtonElement) => void;
}

export function AiConsentSection({ granted, onRevoke }: AiConsentSectionProps): React.JSX.Element {
  return (
    <section className="mt-6" aria-labelledby="ai-consent-heading">
      <h2 id="ai-consent-heading" className="mb-3 text-lg font-bold">Inteligência artificial</h2>
      <div className="space-y-3 rounded-2xl border bg-card p-4">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Sparkles aria-hidden="true" className="size-5" /></div>
          <div className="min-w-0 space-y-1"><p className="text-base font-semibold">{granted ? "Uso de IA permitido" : "Uso de IA não permitido"}</p><p className="text-sm leading-relaxed text-muted-foreground">{granted ? "Notas, voz e texto podem ser enviados para os serviços informados na sua permissão." : "Você pode preencher despesas manualmente. Vamos pedir sua permissão quando você escolher um recurso de IA."}</p></div>
        </div>
        {granted && <Button variant="outline" size="lg" className="w-full" onClick={(event) => onRevoke(event.currentTarget)}>Revogar permissão</Button>}
      </div>
    </section>
  );
}
