"use client";

import { motion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/currency";
import type { DebtSummary } from "@/types";

interface DebtCardProps {
  debt: DebtSummary;
  onPay: (debt: DebtSummary) => void;
  onCollect: (debt: DebtSummary) => void;
  isActing?: boolean;
}

export function DebtCard({ debt, onPay, onCollect, isActing }: DebtCardProps) {
  const router = useRouter();
  const isOwes = debt.direction === "owes";

  const navigateToConversation = () => {
    router.push(`/app/conversations/${debt.counterpartyId}`);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border bg-card p-4 cursor-pointer transition-colors hover:bg-accent/50 active:bg-accent/70"
      onClick={navigateToConversation}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigateToConversation();
        }
      }}
    >
      <div className="flex items-center gap-3 mb-3">
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
        <div className="text-right flex items-center gap-2">
          <div>
            <p className="font-semibold tabular-nums text-sm">
              {formatBRL(debt.amountCents)}
            </p>
            <p className={`text-xs ${isOwes ? "text-destructive" : "text-success"}`}>
              {isOwes ? "Você deve" : "Você recebe"}
            </p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        </div>
      </div>

      <div className="flex gap-2">
        {isOwes ? (
          <Button
            className="flex-1"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onPay(debt);
            }}
            disabled={isActing}
          >
            Pagar via Pix
          </Button>
        ) : (
          <Button
            variant="outline"
            className="flex-1"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onCollect(debt);
            }}
            disabled={isActing}
          >
            Cobrar via Pix
          </Button>
        )}
      </div>
    </motion.div>
  );
}
