"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { Bell, QrCode, UserPlus } from "lucide-react";
import Link from "next/link";
import { GuestBadge } from "@/components/shared/guest-avatar";
import { GuestInviteDialog } from "@/components/expense/guest-invite-dialog";
import { Popover, PopoverContent, PopoverDescription, PopoverTitle } from "@/components/ui/popover";
import { Button, buttonVariants } from "@/components/ui/button";
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
  /** Row button the surface is anchored to. */
  anchor: HTMLElement | null;
  onClose: () => void;
  onPay: (row: DebtRow) => void;
  onCollect: (row: DebtRow) => void;
  onNudge: (row: DebtRow) => void;
}

export function CounterpartyDialog({
  row,
  meId,
  open,
  anchor,
  onClose,
  onPay,
  onCollect,
  onNudge,
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
      <Popover
        open={open && inviteTarget === null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) onClose();
        }}
      >
        <PopoverContent anchor={anchor} side="top" align="center">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <PopoverTitle className="truncate">{row.counterpartyName}</PopoverTitle>
              {row.counterpartyKind === "guest" && <GuestBadge />}
            </div>
            <PopoverDescription className="truncate">
              {group} · {direction} {formatBRL(row.amountCents)}
            </PopoverDescription>
          </div>
          <div className="grid gap-1.5">
            {row.counterpartyKind === "guest" ? (
              guestExpense && (
                <Button
                  variant="outline"
                  className="h-10 w-full"
                  type="button"
                  disabled={inviting}
                  onClick={() => void handleInvite()}
                >
                  <UserPlus className="size-4" aria-hidden="true" />
                  Convidar
                </Button>
              )
            ) : (
              isUserCounterparty && (
                <>
                  {row.direction === "owes" ? (
                    <Button
                      className="h-10 w-full"
                      type="button"
                      onClick={() => {
                        onClose();
                        onPay(row);
                      }}
                    >
                      <QrCode className="size-4" aria-hidden="true" />
                      Pagar via Pix
                    </Button>
                  ) : (
                    <>
                      <Button
                        className="h-10 w-full"
                        type="button"
                        onClick={() => {
                          onClose();
                          onCollect(row);
                        }}
                      >
                        <QrCode className="size-4" aria-hidden="true" />
                        Cobrar via Pix
                      </Button>
                      <Button
                        variant="outline"
                        className="h-10 w-full"
                        type="button"
                        onClick={() => onNudge(row)}
                      >
                        <Bell className="size-4" aria-hidden="true" />
                        Lembrar
                      </Button>
                    </>
                  )}
                  <Link
                    href={`/app/conversations/${row.counterpartyId}`}
                    onClick={onClose}
                    className={buttonVariants({ variant: "outline", className: "h-10 w-full" })}
                  >
                    Abrir conversa
                  </Link>
                </>
              )
            )}
          </div>
        </PopoverContent>
      </Popover>
      {inviteTarget && (
        <GuestInviteDialog
          open
          // The row button that opened the menu stays mounted in the list;
          // the invite surface must keep pointing at it after the menu closes.
          anchor={anchor}
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
