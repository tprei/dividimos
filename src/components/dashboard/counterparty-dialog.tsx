"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { Bell, QrCode, UserPlus } from "lucide-react";
import Link from "next/link";
import { GuestBadge } from "@/components/shared/guest-avatar";
import { GuestInviteDialog } from "@/components/expense/guest-invite-dialog";
import { Money } from "@/components/shared/money";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBRL } from "@/lib/currency";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { refreshExpense } from "@/lib/sync/refresh";
import { useAppStore } from "@/stores/app-store";
import type { DebtRow } from "@/lib/ledger/debt-rows";
import type { GuestParticipant } from "@/types/ledger";

interface GuestInviteTarget {
  guest: GuestParticipant;
  shareCents: number;
  expenseTitle: string;
  expenseId: string;
}

export interface CounterpartyDialogProps {
  row: DebtRow;
  meId: string;
  open: boolean;
  onClose: () => void;
  onPay: (row: DebtRow) => void;
  onCollect: (row: DebtRow) => void;
  onNudge: (row: DebtRow) => void;
  onQuickCharge: () => void;
  canQuickCharge: boolean;
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
  canQuickCharge,
}: CounterpartyDialogProps) {
  const snapshot = useAppStore((s) => s.groups[row.groupId]);
  const guestExpense =
    row.counterpartyKind === "guest"
      ? snapshot?.guests.find((guest) => guest.id === row.counterpartyId) ?? null
      : null;
  const [inviteTarget, setInviteTarget] = useState<GuestInviteTarget | null>(null);
  const [inviting, setInviting] = useState(false);

  const group = row.isDm ? "Conversa direta" : row.groupName;
  const direction = row.direction === "owes" ? "você deve" : "te deve";
  const isUserCounterparty = row.counterpartyKind === "user" && row.counterpartyId !== meId;

  async function handleInvite() {
    if (!guestExpense || inviting) return;
    setInviting(true);
    try {
      await refreshExpense(guestExpense.expenseId);
      const detail = useAppStore.getState().expenseDetails[guestExpense.expenseId];
      const participant = detail?.participants.find(
        (p) => p.kind === "guest" && p.guest?.id === row.counterpartyId,
      );
      if (!detail || !participant?.guest) {
        toast.error("Não foi possível abrir o convite");
        return;
      }
      setInviteTarget({
        guest: participant.guest,
        shareCents: participant.shareCents,
        expenseTitle: detail.current.title,
        expenseId: guestExpense.expenseId,
      });
    } catch (error) {
      toast.error(ledgerErrorMessage(error));
    } finally {
      setInviting(false);
    }
  }

  return (
    <>
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
            <div className="flex flex-col items-center">
              <GuestBadge />
              {guestExpense && (
                <div className="mt-5 w-full">
                  <Button
                    variant="outline"
                    className="h-11 w-full"
                    type="button"
                    disabled={inviting}
                    onClick={() => void handleInvite()}
                  >
                    <UserPlus className="size-4" aria-hidden="true" />
                    Convidar
                  </Button>
                </div>
              )}
            </div>
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
                      {canQuickCharge && (
                        <Button
                          variant="ghost"
                          className="h-11 w-full"
                          type="button"
                          onClick={onQuickCharge}
                        >
                          Cobrar valor
                        </Button>
                      )}
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
      {inviteTarget && (
        <GuestInviteDialog
          open
          onOpenChange={(isOpen) => {
            if (!isOpen) setInviteTarget(null);
          }}
          guest={inviteTarget.guest}
          shareCents={inviteTarget.shareCents}
          expenseTitle={inviteTarget.expenseTitle}
          expenseId={inviteTarget.expenseId}
        />
      )}
    </>
  );
}
