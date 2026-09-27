"use client";

import type { UserProfile } from "@/types/ledger";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverDescription } from "@/components/ui/popover";

export interface UserBlockConfirmationProps {
  open: boolean;
  anchor: HTMLElement | null;
  target: UserProfile;
  action: "block" | "unblock";
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function UserBlockConfirmation({ open, anchor, target, action, busy, error, onCancel, onConfirm }: UserBlockConfirmationProps): React.JSX.Element {
  const block = action === "block";
  return (
    <Popover open={open && anchor !== null} dismissable={!busy} onOpenChange={(next) => { if (!next && !busy) onCancel(); }}>
      <PopoverContent anchor={anchor} finalFocus={() => anchor} aria-busy={busy}>
        <PopoverTitle className="break-words">{block ? "Bloquear" : "Desbloquear"} @{target.handle}?</PopoverTitle>
        <div className="flex min-w-0 items-center gap-3"><UserAvatar id={target.id} name={target.name} avatarUrl={target.avatarUrl} /><p className="min-w-0 truncate text-sm font-semibold" title={target.name}>{target.name}</p></div>
        <PopoverDescription className="leading-relaxed">{block ? "Vocês não vão poder conversar direto, mandar convites ou lembretes, nem incluir um ao outro em novas divisões. As mensagens dessa pessoa ficam ocultas pra você nos grupos. Despesas e saldos não mudam. Ela não recebe um aviso." : "As mensagens dessa pessoa voltam a aparecer. Conversas e convites podem continuar indisponíveis se algum convite anterior foi recusado."}</PopoverDescription>
        {error && <p role="alert" className="text-sm text-destructive-text">{error}</p>}
        <div className="flex flex-col gap-2">
          <Button size="lg" variant={block ? "destructive" : "default"} disabled={busy} onClick={onConfirm}>{busy ? block ? "Bloqueando..." : "Desbloqueando..." : error ? "Tentar novamente" : block ? "Bloquear pessoa" : "Desbloquear"}</Button>
          <Button size="lg" variant="outline" disabled={busy} onClick={onCancel}>Cancelar</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
