"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/currency";
import type { DebtRow } from "@/lib/ledger/debt-rows";

interface DebtCardProps {
  debt: DebtRow;
  onPay: (debt: DebtRow) => void;
}

export function DebtCard({ debt, onPay }: DebtCardProps) {
  const isOwes = debt.direction === "owes";
  const isGuest = debt.counterpartyKind === "guest";

  const header = (
    <>
      <UserAvatar
        name={debt.counterpartyName}
        avatarUrl={debt.counterpartyAvatarUrl ?? undefined}
        size="sm"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-medium">
            {debt.counterpartyName.split(" ")[0]}
          </p>
          {isGuest && (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
              Convidado
            </span>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">{debt.groupName}</p>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold tabular-nums">
          {formatBRL(debt.amountCents)}
        </p>
        <p className={`text-xs ${isOwes ? "text-destructive" : "text-success"}`}>
          {isOwes ? "Você deve" : "Você recebe"}
        </p>
      </div>
    </>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border bg-card p-4"
    >
      {isGuest ? (
        <div className="mb-3 flex w-full items-center gap-3">{header}</div>
      ) : (
        <Link
          href={`/app/conversations/${debt.counterpartyId}`}
          className="mb-3 flex w-full items-center gap-3 text-left"
        >
          {header}
        </Link>
      )}

      {isOwes && !isGuest && (
        <Button className="w-full" size="sm" onClick={() => onPay(debt)}>
          Pagar via Pix
        </Button>
      )}
    </motion.div>
  );
}
