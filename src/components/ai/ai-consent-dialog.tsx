"use client";

import { useRef } from "react";
import { Mic, Receipt, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

export type AiConsentDialogState =
  | { status: "idle" }
  | { status: "loading"; operation: "bootstrap" | "grant" }
  | { status: "error"; message: string; operation: "bootstrap" | "grant" }
  | { status: "success" }
  | { status: "empty" };

export interface AiConsentDialogProps {
  open: boolean;
  state: AiConsentDialogState;
  onAccept: () => void;
  onDecline: () => void;
  onRetry: () => void;
  onClose: () => void;
}

const disclosures = [
  { icon: Receipt, text: "A imagem da nota fiscal vai para o Google (Gemini API)." },
  { icon: Mic, text: "Sua voz pode ser enviada como áudio ou transcrição para o Google (Gemini API). O áudio também pode ser processado pelo serviço de fala do celular ou navegador, do Google ou da Apple." },
  { icon: MessageSquare, text: "O texto que você digitar no modo IA e os nomes e @ dos participantes usados para entender a despesa vão para o Google (Gemini API)." },
];

export function AiConsentDialog({ open, state, onAccept, onDecline, onRetry, onClose }: AiConsentDialogProps): React.JSX.Element {
  const title = useRef<HTMLHeadingElement>(null);
  const saving = state.status === "loading" && state.operation === "grant";
  const finished = state.status === "success" || state.status === "empty";
  return (
    <Dialog open={open} dismissable={!saving} onOpenChange={(next) => { if (!next && !saving) { if (finished) onClose(); else onDecline(); } }}>
      <DialogContent showCloseButton={false} initialFocus={title} aria-busy={state.status === "loading"}>
        <DialogHeader>
          <DialogTitle ref={title} tabIndex={-1}>Usar IA no Dividimos?</DialogTitle>
          <DialogDescription>Para escanear notas e entender despesas por voz ou texto, o Dividimos precisa enviar alguns dados para serviços de IA.</DialogDescription>
        </DialogHeader>
        {finished ? (
          <p role="status" className="rounded-xl bg-muted p-4 text-sm leading-relaxed">{state.status === "success" ? "Permissão salva. Toque de novo no recurso para continuar." : "Entre na sua conta do Dividimos para escolher se quer usar IA."}</p>
        ) : (
          <>
            <ul className="divide-y rounded-xl border bg-background">
              {disclosures.map(({ icon: Icon, text }) => <li key={text} className="flex gap-3 p-3"><Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" /><p className="text-sm leading-relaxed">{text}</p></li>)}
            </ul>
            <p className="text-sm leading-relaxed">Esses dados são usados para ler a nota e sugerir uma despesa para você revisar.</p>
            <p className="text-sm leading-relaxed text-muted-foreground">Você pode continuar preenchendo tudo manualmente e revogar esta permissão em Configurações.</p>
            {state.status === "loading" && <p role="status" className="text-sm text-muted-foreground">{saving ? "Salvando permissão…" : "Verificando sua permissão…"}</p>}
            {state.status === "error" && <p role="alert" className="text-sm text-destructive-text">{state.message}</p>}
          </>
        )}
        <DialogFooter className="sm:flex-col-reverse">
          {finished ? <Button size="lg" className="w-full" onClick={onClose}>Voltar</Button> : <>
            <Button size="lg" variant="outline" className="w-full" disabled={saving} onClick={onDecline}>Continuar sem IA</Button>
            <Button size="lg" className="w-full" disabled={state.status === "loading"} onClick={state.status === "error" ? onRetry : onAccept}>{state.status === "error" ? "Tentar novamente" : saving ? "Salvando permissão…" : "Permitir uso de IA"}</Button>
          </>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
