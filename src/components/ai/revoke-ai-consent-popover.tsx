"use client";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverDescription } from "@/components/ui/popover";

export interface RevokeAiConsentPopoverProps {
  open: boolean;
  anchor: HTMLElement | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function RevokeAiConsentPopover({ open, anchor, onCancel, onConfirm }: RevokeAiConsentPopoverProps): React.JSX.Element | null {
  if (!anchor) return null;
  return (
    <Popover open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <PopoverContent anchor={anchor} finalFocus={() => anchor}>
        <PopoverTitle>Revogar permissão de IA?</PopoverTitle>
        <PopoverDescription className="leading-relaxed">Você não vai poder escanear notas nem usar voz ou texto com IA até permitir de novo. O preenchimento manual continua disponível.</PopoverDescription>
        <p className="text-sm font-medium">Revogar não desfaz envios que já aconteceram.</p>
        <div className="flex flex-col gap-2">
          <Button size="lg" onClick={onConfirm}>Revogar permissão</Button>
          <Button size="lg" variant="outline" onClick={onCancel}>Cancelar</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
