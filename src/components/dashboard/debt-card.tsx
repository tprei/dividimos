"use client";

import { motion } from "framer-motion";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/currency";
import type { DebtSummary } from "@/types";

interface DebtCardProps {
  debt: DebtSummary;
  onPay: (debt: DebtSummary) => void;
  onCollect: (debt: DebtSummary) => void;
  onNavigate: (debt: DebtSummary) => void;
  isActing?: boolean;
}

export function DebtCard({ debt, onPay, onCollect, onNavigate, isActing }: DebtCardProps) {
  const isOwes = debt.direction === "owes";

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border bg-card p-4"
    >
      <button
        type="button"
        onClick={() => onNavigate(debt)}
        className="flex items-center gap-3 mb-3 w-full text-left"
      >
        <UserAvatar
          name={debt.counterpartyName}
          avatarUrl={debt.counterpartyAvatarUrl ?? undefined}
          size="sm"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">
            {debt.counterpartyName.split(" ")[0]}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {debt.groupName}
          </p>
        </div>
        <div className="text-right">
          <p className="font-semibold tabular-nums text-sm">
            {formatBRL(debt.amountCents)}
          </p>
          <p className={`text-xs ${isOwes ? "text-destructive" : "text-success"}`}>
            {isOwes ? "Você deve" : "Você recebe"}
          </p>
        </div>
      </button>

      <div className="flex gap-2">
        {isOwes ? (
          <Button
            className="flex-1"
            size="sm"
            onClick={() => onPay(debt)}
            disabled={isActing}
          >
            Pagar via Pix
          </Button>
        ) : (
          <Button
            variant="outline"
            className="flex-1"
            size="sm"
            onClick={() => onCollect(debt)}
            disabled={isActing}
          >
            Cobrar via Pix
          </Button>
        )}
      </div>
    </motion.div>
  );
}
