"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Money } from "@/components/shared/money";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTitle } from "@/components/ui/popover";
import { haptics } from "@/hooks/use-haptics";

export interface VoidSettlementDialogProps {
  open: boolean;
  anchor: HTMLElement | null;
  amountCents: number;
  payerName: string;
  recipientName: string;
  payerAvatarUrl?: string | null;
  recipientAvatarUrl?: string | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onSkipFutureConfirmations?: () => void;
}

export function VoidSettlementDialog({
  open,
  anchor,
  amountCents,
  payerName,
  recipientName,
  payerAvatarUrl,
  recipientAvatarUrl,
  busy,
  onCancel,
  onConfirm,
  onSkipFutureConfirmations,
}: VoidSettlementDialogProps) {
  const [skip, setSkip] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setSkip(false);
    }
  }

  return (
    <Popover
      open={open}
      dismissable={!busy}
      onOpenChange={(o) => {
        if (!o && !busy) onCancel();
      }}
    >
      <PopoverContent anchor={anchor}>
        <PopoverTitle>
          Desfazer pagamento de <Money cents={amountCents} />?
        </PopoverTitle>

        <div className="rounded-xl border bg-card p-3">
          <div className="flex items-center justify-center gap-2">
            <UserAvatar name={payerName} avatarUrl={payerAvatarUrl} size="sm" />
            <span title={payerName} className="min-w-0 truncate text-sm font-semibold">{payerName}</span>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            <UserAvatar name={recipientName} avatarUrl={recipientAvatarUrl} size="sm" />
            <span title={recipientName} className="min-w-0 truncate text-sm font-semibold">{recipientName}</span>
          </div>
        </div>


        {onSkipFutureConfirmations && (
          <label className="flex min-h-11 items-center gap-3 text-sm cursor-pointer">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={skip}
              onChange={(e) => { setSkip(e.target.checked); haptics.selectionChanged(); }}
            />
            Não perguntar de novo
          </label>
        )}

        <div>
          <Button
            variant="destructive"
            onClick={() => {
              haptics.tap();
              if (skip) {
                onSkipFutureConfirmations?.();
              }
              onConfirm();
            }}
            disabled={busy}
            className="min-h-11 w-full rounded-lg"
          >
            {busy ? "Desfazendo…" : "Desfazer"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
