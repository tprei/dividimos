"use client";

import Link from "next/link";
import { Receipt } from "lucide-react";
import { UserAvatar } from "@/components/shared/user-avatar";
import { formatBRL } from "@/lib/currency";
import type { Expense, UserProfile, ExpenseStatus } from "@/types";

const statusConfig: Record<ExpenseStatus, { label: string; color: string }> = {
  draft: { label: "Rascunho", color: "bg-muted text-muted-foreground" },
  active: { label: "Pendente", color: "bg-warning/15 text-warning-foreground" },
  settled: { label: "Quitada", color: "bg-success/15 text-success" },
};

export interface SystemExpenseCardProps {
  expense: Expense;
  creator: UserProfile;
}

export function SystemExpenseCard({ expense, creator }: SystemExpenseCardProps) {
  const cfg = statusConfig[expense.status];

  return (
    <div className="mx-auto w-full max-w-xs">
      <p className="mb-1 text-center text-[11px] text-muted-foreground">
        {creator.name.split(" ")[0]} adicionou uma conta
      </p>
      <Link href={`/app/bill/${expense.id}`}>
        <div className="rounded-2xl border bg-card p-3 transition-colors hover:bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted">
              <Receipt className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{expense.title}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(expense.createdAt).toLocaleDateString("pt-BR")}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="text-sm font-semibold tabular-nums">
                {expense.status === "draft"
                  ? "Em criação..."
                  : formatBRL(expense.totalAmount)}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${cfg.color}`}
              >
                {cfg.label}
              </span>
            </div>
          </div>
          {expense.merchantName && (
            <p className="mt-1.5 truncate pl-12 text-xs text-muted-foreground">
              {expense.merchantName}
            </p>
          )}
        </div>
      </Link>
      <div className="mt-1 flex justify-center">
        <UserAvatar
          name={creator.name}
          avatarUrl={creator.avatarUrl}
          size="xs"
        />
      </div>
    </div>
  );
}
