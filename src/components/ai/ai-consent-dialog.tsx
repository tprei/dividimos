"use client";

import { useRef } from "react";
import { Mic, Receipt, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

export interface AiConsentDialogProps {
  open: boolean;
  error: string | null;
  onAccept: () => void;
  onDecline: () => void;
}

const disclosures = [
  { icon: Receipt, text: "A imagem da nota fiscal vai para o Google (Gemini API)." },
  { icon: Mic, text: "Sua voz pode ser enviada como áudio ou transcrição para o Google (Gemini API). O áudio também pode ser processado pelo serviço de fala do celular ou navegador, do Google ou da Apple." },
  { icon: MessageSquare, text: "O texto que você digitar no modo IA e os nomes e @ dos participantes usados para entender a despesa vão para o Google (Gemini API)." },
];

export function AiConsentDialog({ open, error, onAccept, onDecline }: AiConsentDialogProps): React.JSX.Element {
  const title = useRef<HTMLHeadingElement>(null);
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onDecline(); }}>
      <DialogContent showCloseButton={false} initialFocus={title}>
        <DialogHeader>
          <DialogTitle ref={title} tabIndex={-1}>Usar IA no Dividimos?</DialogTitle>
          <DialogDescription>Para escanear notas e entender despesas por voz ou texto, o Dividimos precisa enviar alguns dados para serviços de IA.</DialogDescription>
        </DialogHeader>
        <ul className="divide-y rounded-xl border bg-background">
          {disclosures.map(({ icon: Icon, text }) => <li key={text} className="flex gap-3 p-3"><Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" /><p className="text-sm leading-relaxed">{text}</p></li>)}
        </ul>
        <p className="text-sm leading-relaxed">Esses dados são usados para ler a nota e sugerir uma despesa para você revisar.</p>
        <p className="text-sm leading-relaxed text-muted-foreground">Você pode continuar preenchendo tudo manualmente e revogar esta permissão em Configurações.</p>
        {error && <p role="alert" className="text-sm text-destructive-text">{error}</p>}
        <DialogFooter className="sm:flex-col-reverse">
          <Button size="lg" variant="outline" className="w-full" onClick={onDecline}>Continuar sem IA</Button>
          <Button size="lg" className="w-full" onClick={onAccept}>{error ? "Tentar novamente" : "Permitir uso de IA"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
