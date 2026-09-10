"use client";

import { Bell, QrCode } from "lucide-react";
import Link from "next/link";
import { GuestBadge } from "@/components/shared/guest-avatar";
import { Money } from "@/components/shared/money";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBRL } from "@/lib/currency";
import type { DebtRow } from "@/lib/ledger/debt-rows";

export interface CounterpartyDialogProps {
  row: DebtRow;
  meId: string;
  open: boolean;
  onClose: () => void;
  onPay: (row: DebtRow) => void;
  onCollect: (row: DebtRow) => void;
  onNudge: (row: DebtRow) => void;
  onQuickCharge: () => void;
}

export function CounterpartyDialog({
  row,
  meId,
  open,
  onClose,
  onPay,
  onCollect,
  onNudge,
  onQuickCharge,
}: CounterpartyDialogProps) {
  const group = row.isDm ? "Conversa direta" : row.groupName;
  const direction = row.direction === "owes" ? "você deve" : "te deve";
  const isUserCounterparty = row.counterpartyKind === "user" && row.counterpartyId !== meId;

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      modal
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-3xl bg-card p-5">
        <DialogTitle className="pr-8 text-lg font-bold">{row.counterpartyName}</DialogTitle>
        <DialogDescription>
          {group} · {direction} {formatBRL(row.amountCents)}
        </DialogDescription>
        {row.counterpartyKind === "guest" ? (
          <GuestBadge />
        ) : (
          <div className="flex flex-col items-center">
            <Money cents={row.amountCents} className="text-3xl" />
            {isUserCounterparty && (
              <div className="mt-5 w-full space-y-2">
                {row.direction === "owes" ? (
                  <Button className="h-11 w-full" type="button" onClick={() => onPay(row)}>
                    <QrCode className="size-4" aria-hidden="true" />
                    Pagar via Pix
                  </Button>
                ) : (
                  <>
                    <Button className="h-11 w-full" type="button" onClick={() => onCollect(row)}>
                      <QrCode className="size-4" aria-hidden="true" />
                      Cobrar via Pix
                    </Button>
                    <Button
                      variant="outline"
                      className="h-11 w-full"
                      type="button"
                      onClick={() => onNudge(row)}
                    >
                      <Bell className="size-4" aria-hidden="true" />
                      Lembrar
                    </Button>
                    <Button
                      variant="ghost"
                      className="h-11 w-full"
                      type="button"
                      onClick={onQuickCharge}
                    >
                      Cobrar valor
                    </Button>
                  </>
                )}
                <Link
                  href={`/app/conversations/${row.counterpartyId}`}
                  className={buttonVariants({ variant: "outline", className: "h-11 w-full" })}
                >
                  Abrir conversa
                </Link>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
