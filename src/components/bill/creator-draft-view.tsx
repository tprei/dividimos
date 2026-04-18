"use client";

import { motion } from "framer-motion";
import { ArrowLeft, Check, Loader2, Pencil, QrCode, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { GuestClaimShareModal } from "@/components/bill/guest-claim-share-modal";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/currency";
import { loadExpense } from "@/lib/supabase/expense-actions";
import { activateExpense } from "@/lib/supabase/expense-rpc";
import { notifyExpenseActivated } from "@/lib/push/push-notify";
import { useBillStore } from "@/stores/bill-store";
import { haptics } from "@/hooks/use-haptics";
import toast from "react-hot-toast";
import type { Expense, ExpenseItem, UserProfile } from "@/types";

const STATUS_CONFIG = { label: "Rascunho", color: "bg-muted text-muted-foreground" };

export function CreatorDraftView({
  expense,
  participants,
  items,
  shares,
  guests,
}: {
  expense: Expense;
  participants: UserProfile[];
  items: ExpenseItem[];
  shares: { userId: string; shareAmountCents: number }[];
  guests: { id: string; displayName: string; claimToken: string; share?: { shareAmountCents: number } }[];
}) {
  const [finalizing, setFinalizing] = useState(false);
  const [guestShareModal, setGuestShareModal] = useState<{
    open: boolean;
    guestName: string;
    shareAmountCents?: number;
    claimToken: string;
  }>({ open: false, guestName: "", claimToken: "" });

  const hasContent = shares.length > 0 || items.length > 0;

  const handleFinalize = async () => {
    setFinalizing(true);
    const result = await activateExpense({ expense_id: expense.id });
    if ("error" in result) {
      haptics.error();
      toast.error(result.error);
      setFinalizing(false);
      return;
    }
    haptics.success();
    notifyExpenseActivated(expense.id).catch(() => {});
    const fresh = await loadExpense(expense.id);
    if (fresh) {
      useBillStore.setState({
        expense: {
          id: fresh.id,
          groupId: fresh.groupId,
          creatorId: fresh.creatorId,
          title: fresh.title,
          merchantName: fresh.merchantName,
          expenseType: fresh.expenseType,
          totalAmount: fresh.totalAmount,
          serviceFeePercent: fresh.serviceFeePercent,
          fixedFees: fresh.fixedFees,
          status: fresh.status,
          createdAt: fresh.createdAt,
          updatedAt: fresh.updatedAt,
        },
      });
    }
    setFinalizing(false);
  };

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <div className="flex items-center gap-3">
        <Link
          href="/app"
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <h1 className="font-semibold">{expense.title}</h1>
          {expense.merchantName && (
            <p className="text-xs text-muted-foreground">{expense.merchantName}</p>
          )}
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_CONFIG.color}`}>
          {STATUS_CONFIG.label}
        </span>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.4 }}
        className="mt-6"
      >
        <div className="rounded-2xl gradient-primary p-5 text-white shadow-lg shadow-primary/20">
          <p className="text-sm text-white/70">Total da despesa</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">
            {formatBRL(expense.totalAmount)}
          </p>
          <div className="mt-2 flex gap-4 text-sm text-white/70">
            <span className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              {participants.length} pessoas
            </span>
          </div>
        </div>
      </motion.div>

      {participants.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.4 }}
          className="mt-5"
        >
          <h2 className="mb-3 text-sm font-semibold">Participantes</h2>
          <div className="space-y-2">
            {participants.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3"
              >
                <UserAvatar name={p.name} avatarUrl={p.avatarUrl} size="sm" />
                <span className="flex-1 text-sm font-medium">{p.name}</span>
                {p.id === expense.creatorId && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    Criador
                  </span>
                )}
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {guests.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.4 }}
          className="mt-5"
        >
          <h2 className="mb-3 text-sm font-semibold">Convidados</h2>
          <div className="space-y-2">
            {guests.map((guest) => (
              <div
                key={guest.id}
                className="flex items-center justify-between rounded-xl border border-dashed bg-card px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                    {guest.displayName.charAt(0)}
                  </span>
                  <span className="text-sm font-medium">{guest.displayName}</span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-xs"
                  onClick={() =>
                    setGuestShareModal({
                      open: true,
                      guestName: guest.displayName,
                      shareAmountCents: guest.share?.shareAmountCents,
                      claimToken: guest.claimToken,
                    })
                  }
                >
                  <QrCode className="h-3.5 w-3.5" />
                  Convidar
                </Button>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.4 }}
        className="mt-6 space-y-3"
      >
        {hasContent && (
          <Button
            onClick={handleFinalize}
            disabled={finalizing}
            className="w-full gap-2"
          >
            {finalizing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Finalizar despesa
          </Button>
        )}
        <Link href={`/app/bill/new?draft=${expense.id}`}>
          <Button variant="outline" className="w-full gap-2">
            <Pencil className="h-4 w-4" />
            Editar rascunho
          </Button>
        </Link>
      </motion.div>

      <GuestClaimShareModal
        open={guestShareModal.open}
        onClose={() => setGuestShareModal({ ...guestShareModal, open: false })}
        guestName={guestShareModal.guestName}
        shareAmountCents={guestShareModal.shareAmountCents}
        claimToken={guestShareModal.claimToken}
        expenseTitle={expense.title}
      />
    </div>
  );
}
