"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, ArrowDownLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/currency";
import { createClient } from "@/lib/supabase/client";
import type { Balance } from "@/types";

export interface GroupDebtRow {
  groupId: string;
  groupName: string;
  debtCents: number;
}

interface GroupSettlementSheetProps {
  open: boolean;
  onClose: () => void;
  balances: Balance[];
  currentUserId: string;
  counterpartyId: string;
  counterpartyName: string;
  mode: "pay" | "collect";
  totalCents: number;
  onConfirm: (selectedBalances: Balance[]) => void;
}

/**
 * Compute per-group directed debts from raw balance rows.
 * Returns only groups where the debt flows in the given direction.
 */
export function computeGroupDebts(
  balances: Balance[],
  currentUserId: string,
  direction: "pay" | "collect",
): GroupDebtRow[] {
  const rows: GroupDebtRow[] = [];

  for (const b of balances) {
    let debtFromCurrentUser: number;
    if (currentUserId === b.userA) {
      debtFromCurrentUser = b.amountCents;
    } else {
      debtFromCurrentUser = -b.amountCents;
    }

    if (direction === "pay" && debtFromCurrentUser > 0) {
      rows.push({ groupId: b.groupId, groupName: "", debtCents: debtFromCurrentUser });
    } else if (direction === "collect" && debtFromCurrentUser < 0) {
      rows.push({ groupId: b.groupId, groupName: "", debtCents: Math.abs(debtFromCurrentUser) });
    }
  }

  rows.sort((a, b) => b.debtCents - a.debtCents);
  return rows;
}

export function GroupSettlementSheet({
  open,
  onClose,
  balances,
  currentUserId,
  counterpartyName,
  mode,
  totalCents,
  onConfirm,
}: GroupSettlementSheetProps) {
  const [groupNames, setGroupNames] = useState<Map<string, string>>(new Map());
  const [loadingNames, setLoadingNames] = useState(true);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());

  const groupDebts = useMemo(
    () => computeGroupDebts(balances, currentUserId, mode),
    [balances, currentUserId, mode],
  );

  const groupIds = useMemo(
    () => groupDebts.map((g) => g.groupId),
    [groupDebts],
  );

  useEffect(() => {
    if (!open) return;

    setSelectedGroupIds(new Set(groupIds));

    if (groupIds.length === 0) {
      setLoadingNames(false);
      return;
    }

    setLoadingNames(true);
    const supabase = createClient();
    supabase
      .from("groups")
      .select("id, name")
      .in("id", groupIds)
      .then(({ data }) => {
        const map = new Map<string, string>();
        for (const row of (data ?? []) as { id: string; name: string }[]) {
          map.set(row.id, row.name);
        }
        setGroupNames(map);
        setLoadingNames(false);
      });
  }, [open, groupIds]);

  const selectedTotal = groupDebts
    .filter((g) => selectedGroupIds.has(g.groupId))
    .reduce((sum, g) => sum + g.debtCents, 0);

  const toggleGroup = (groupId: string) => {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const handleConfirm = () => {
    const filtered = balances.filter((b) => selectedGroupIds.has(b.groupId));
    onConfirm(filtered);
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-end justify-center backdrop-blur-sm bg-black/40 sm:items-center"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          drag="y"
          dragConstraints={{ top: 0 }}
          dragElastic={0.2}
          onDragEnd={(_, info) => {
            if (info.offset.y > 100 || info.velocity.y > 500) {
              onClose();
            }
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md rounded-t-3xl bg-card p-6 pb-24 sm:pb-6 sm:rounded-3xl"
        >
          <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-muted/80 sm:hidden" />

          <div className="text-center mb-5">
            <h2 className="text-lg font-bold">
              {mode === "pay" ? "Pagar" : "Cobrar"} {counterpartyName}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {mode === "pay" ? "Você deve" : "Te devem"}{" "}
              <span className="font-semibold text-foreground">{formatBRL(totalCents)}</span>
              {" "}em {groupDebts.length} grupos
            </p>
          </div>

          {loadingNames ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {groupDebts.map((debt) => {
                const isSelected = selectedGroupIds.has(debt.groupId);
                const name = groupNames.get(debt.groupId) ?? "Grupo";
                return (
                  <button
                    key={debt.groupId}
                    type="button"
                    onClick={() => toggleGroup(debt.groupId)}
                    className={`w-full flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                      isSelected
                        ? "border-primary/40 bg-primary/5"
                        : "border-border bg-card opacity-60"
                    }`}
                  >
                    <div
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors ${
                        isSelected
                          ? "border-primary bg-primary"
                          : "border-muted-foreground/40 bg-transparent"
                      }`}
                    >
                      {isSelected && (
                        <motion.svg
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className="h-3 w-3 text-primary-foreground"
                          viewBox="0 0 12 12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2.5}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M2 6l3 3 5-5" />
                        </motion.svg>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{name}</p>
                    </div>

                    <span className={`text-sm font-semibold tabular-nums ${
                      mode === "pay" ? "text-destructive" : "text-success"
                    }`}>
                      {formatBRL(debt.debtCents)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-5 space-y-2.5">
            <Button
              onClick={handleConfirm}
              className="w-full gap-2"
              size="lg"
              disabled={selectedGroupIds.size === 0}
            >
              {mode === "pay" ? (
                <ArrowUpRight className="h-4 w-4" />
              ) : (
                <ArrowDownLeft className="h-4 w-4" />
              )}
              {mode === "pay" ? "Pagar" : "Cobrar"} {formatBRL(selectedTotal)}
              <ChevronRight className="h-4 w-4 ml-auto" />
            </Button>

            <Button
              onClick={onClose}
              variant="ghost"
              className="w-full"
              size="lg"
            >
              Cancelar
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
