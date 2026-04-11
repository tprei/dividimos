"use client";

import { ArrowRight, CheckCheck, Clock } from "lucide-react";
import { UserAvatar } from "@/components/shared/user-avatar";
import { formatBRL } from "@/lib/currency";
import type { Settlement, UserProfile, SettlementStatus } from "@/types";

const statusConfig: Record<SettlementStatus, { label: string; color: string; icon: "check" | "clock" }> = {
  pending: { label: "Pendente", color: "bg-warning/15 text-warning-foreground", icon: "clock" },
  confirmed: { label: "Confirmado", color: "bg-success/15 text-success", icon: "check" },
};

export interface SystemSettlementCardProps {
  settlement: Settlement;
  fromUser: UserProfile;
  toUser: UserProfile;
}

export function SystemSettlementCard({
  settlement,
  fromUser,
  toUser,
}: SystemSettlementCardProps) {
  const cfg = statusConfig[settlement.status];

  return (
    <div className="mx-auto w-full max-w-xs">
      <p className="mb-1 text-center text-[11px] text-muted-foreground">
        {settlement.status === "confirmed" ? "Pagamento confirmado" : "Pagamento registrado"}
      </p>
      <div className="rounded-2xl border bg-card p-3">
        <div className="flex items-center gap-2">
          <UserAvatar
            name={fromUser.name}
            avatarUrl={fromUser.avatarUrl}
            size="sm"
          />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1 truncate text-sm font-medium">
              {fromUser.name.split(" ")[0]}
              <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
              {toUser.name.split(" ")[0]}
            </p>
            <div className="flex items-center gap-1.5">
              <p className="text-xs text-muted-foreground">
                {new Date(settlement.createdAt).toLocaleDateString("pt-BR")}
              </p>
              {cfg.icon === "check" ? (
                <CheckCheck className="h-3 w-3 text-success" />
              ) : (
                <Clock className="h-3 w-3 text-warning-foreground" />
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="text-sm font-semibold tabular-nums">
              {formatBRL(settlement.amountCents)}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${cfg.color}`}
            >
              {cfg.label}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
