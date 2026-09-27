"use client";

import { useRef } from "react";
import { Flag, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent, PopoverTitle } from "@/components/ui/popover";

export interface ReportActionMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReport: () => void;
}

export function ReportActionMenu({ open, onOpenChange, onReport }: ReportActionMenuProps): React.JSX.Element {
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger ref={trigger} render={<Button variant="ghost" size="icon-lg" aria-label="Opções da mensagem" />}><MoreHorizontal aria-hidden="true" /></PopoverTrigger>
      <PopoverContent align="end">
        <PopoverTitle className="sr-only">Opções da mensagem</PopoverTitle>
        <Button variant="ghost" size="lg" className="w-full justify-start" onClick={() => { onOpenChange(false); trigger.current?.focus(); onReport(); }}><Flag aria-hidden="true" />Denunciar mensagem</Button>
      </PopoverContent>
    </Popover>
  );
}
