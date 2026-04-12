"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { PixQrModal } from "@/components/settlement/pix-qr-modal";
import { recordSettlement } from "@/lib/supabase/settlement-actions";
import { formatBRL } from "@/lib/currency";
import type { GroupDebt } from "@/lib/supabase/cross-group-settlement";

interface SettlementRoutingSheetProps {
  open: boolean;
  onClose: () => void;
  fromUserId: string;
  toUserId: string;
  toUserName: string;
  toUserPixKey?: string;
  debts: GroupDebt[];
  onSettled?: () => void;
}

interface PixTarget {
  amountCents: number;
  groupId: string;
  groupIds?: string[];
}

export function SettlementRoutingSheet({
  open,
  onClose,
  fromUserId,
  toUserId,
  toUserName,
  toUserPixKey,
  debts,
  onSettled,
}: SettlementRoutingSheetProps) {
  const [pixTarget, setPixTarget] = useState<PixTarget | null>(null);
  const [settling, setSettling] = useState(false);

  const owedDebts = debts.filter((d) => d.amountCents < 0);
  const totalOwedCents = owedDebts.reduce((sum, d) => sum + Math.abs(d.amountCents), 0);

  const handlePayGroup = (debt: GroupDebt) => {
    setPixTarget({
      amountCents: Math.abs(debt.amountCents),
      groupId: debt.groupId,
    });
  };

  const handlePayAll = () => {
    setPixTarget({
      amountCents: totalOwedCents,
      groupId: owedDebts[0].groupId,
      groupIds: owedDebts.map((d) => d.groupId),
    });
  };

  const handleMarkPaid = async (paidCents: number) => {
    if (!pixTarget || settling) return;
    setSettling(true);
    try {
      if (pixTarget.groupIds && pixTarget.groupIds.length > 1) {
        await Promise.all(
          owedDebts.map((d) =>
            recordSettlement(d.groupId, fromUserId, toUserId, Math.abs(d.amountCents)),
          ),
        );
      } else {
        await recordSettlement(pixTarget.groupId, fromUserId, toUserId, paidCents);
      }
      setPixTarget(null);
      onClose();
      onSettled?.();
    } finally {
      setSettling(false);
    }
  };

  if (pixTarget) {
    return (
      <PixQrModal
        open
        onClose={() => setPixTarget(null)}
        recipientName={toUserName}
        amountCents={pixTarget.amountCents}
        recipientUserId={toUserId}
        pixKey={toUserPixKey}
        groupId={pixTarget.groupId}
        onMarkPaid={handleMarkPaid}
        mode="pay"
      />
    );
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="bottom" showCloseButton={false}>
        <SheetHeader>
          <SheetTitle>Pagar {toUserName}</SheetTitle>
          <SheetDescription>
            Você deve {formatBRL(totalOwedCents)} no total
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-2 space-y-2">
          {owedDebts.map((debt) => (
            <div
              key={debt.groupId}
              className="flex items-center justify-between rounded-xl border bg-card p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{debt.groupName}</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {formatBRL(Math.abs(debt.amountCents))}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handlePayGroup(debt)}
              >
                Pagar {formatBRL(Math.abs(debt.amountCents))}
              </Button>
            </div>
          ))}
        </div>

        {owedDebts.length > 1 && (
          <div className="px-4 pb-4">
            <Button
              className="w-full"
              size="lg"
              onClick={handlePayAll}
            >
              Pagar tudo {formatBRL(totalOwedCents)}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
