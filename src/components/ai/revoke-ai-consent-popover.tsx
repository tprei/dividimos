"use client";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverDescription } from "@/components/ui/popover";

export interface RevokeAiConsentPopoverProps {
  open: boolean;
  anchor: HTMLElement | null;
  state: "idle" | "loading" | "error" | "success" | "empty";
  errorMessage: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function RevokeAiConsentPopover({ open, anchor, state, errorMessage, onCancel, onConfirm }: RevokeAiConsentPopoverProps): React.JSX.Element | null {
  const busy = state === "loading";
  if (!anchor || state === "empty" || state === "success") return null;
  return (
    <Popover open={open} dismissable={!busy} onOpenChange={(next) => { if (!next && !busy) onCancel(); }}>
      <PopoverContent anchor={anchor} finalFocus={() => anchor} aria-busy={busy}>
        <PopoverTitle>Revogar permissão de IA?</PopoverTitle>
        <PopoverDescription className="leading-relaxed">Você não vai poder escanear notas nem usar voz ou texto com IA até permitir de novo. O preenchimento manual continua disponível.</PopoverDescription>
        <p className="text-sm font-medium">Revogar não desfaz envios que já aconteceram.</p>
        {state === "error" && <p role="alert" className="text-sm text-destructive-text">{errorMessage}</p>}
        <div className="flex flex-col gap-2">
          <Button size="lg" disabled={busy} onClick={onConfirm}>{busy ? "Revogando…" : state === "error" ? "Tentar novamente" : "Revogar permissão"}</Button>
          <Button size="lg" variant="outline" disabled={busy} onClick={onCancel}>Cancelar</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
