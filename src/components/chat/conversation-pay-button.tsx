"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, ArrowDownLeft, Loader2 } from "lucide-react";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/currency";
import {
  queryBalancesBetweenUsers,
  recordSettlement,
} from "@/lib/supabase/settlement-actions";
import { notifySettlementRecorded } from "@/lib/push/push-notify";
import { haptics } from "@/hooks/use-haptics";
import { computeGroupDebts } from "./group-settlement-sheet";
import type { Balance } from "@/types";

const PixQrModal = dynamic(
  () =>
    import("@/components/settlement/pix-qr-modal").then((m) => ({
      default: m.PixQrModal,
    })),
  { ssr: false },
);

const GroupSettlementSheet = dynamic(
  () =>
    import("./group-settlement-sheet").then((m) => ({
      default: m.GroupSettlementSheet,
    })),
  { ssr: false },
);

interface ConversationPayButtonProps {
  currentUserId: string;
  counterpartyId: string;
  counterpartyName: string;
}

/**
 * Distribute a settlement amount across multiple group balances,
 * settling the largest debts first. Returns the list of
 * (groupId, fromUserId, toUserId, amountCents) to record.
 */
export function distributeSettlement(
  balances: Balance[],
  currentUserId: string,
  counterpartyId: string,
  totalCents: number,
  direction: "pay" | "collect",
): { groupId: string; fromUserId: string; toUserId: string; amountCents: number }[] {
  const directedDebts: { groupId: string; debtCents: number }[] = [];

  for (const b of balances) {
    let debtFromCurrentUser: number;
    if (currentUserId === b.userA) {
      // positive amountCents = userA owes userB → currentUser owes counterparty
      debtFromCurrentUser = b.amountCents;
    } else {
      // positive amountCents = userA owes userB → counterparty owes currentUser → negative debt from current user
      debtFromCurrentUser = -b.amountCents;
    }

    if (direction === "pay" && debtFromCurrentUser > 0) {
      directedDebts.push({ groupId: b.groupId, debtCents: debtFromCurrentUser });
    } else if (direction === "collect" && debtFromCurrentUser < 0) {
      directedDebts.push({ groupId: b.groupId, debtCents: Math.abs(debtFromCurrentUser) });
    }
  }

  // Sort largest debt first
  directedDebts.sort((a, b) => b.debtCents - a.debtCents);

  const settlements: { groupId: string; fromUserId: string; toUserId: string; amountCents: number }[] = [];
  let remaining = totalCents;

  for (const debt of directedDebts) {
    if (remaining <= 0) break;
    const amount = Math.min(remaining, debt.debtCents);

    const fromUserId = direction === "pay" ? currentUserId : counterpartyId;
    const toUserId = direction === "pay" ? counterpartyId : currentUserId;

    settlements.push({ groupId: debt.groupId, fromUserId, toUserId, amountCents: amount });
    remaining -= amount;
  }

  return settlements;
}

export function ConversationPayButton({
  currentUserId,
  counterpartyId,
  counterpartyName,
}: ConversationPayButtonProps) {
  const [netCents, setNetCents] = useState(0);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [loading, setLoading] = useState(true);
  const [showGroupSheet, setShowGroupSheet] = useState(false);
  const [showPix, setShowPix] = useState(false);
  const [selectedBalances, setSelectedBalances] = useState<Balance[]>([]);
  const [settling, setSettling] = useState(false);

  const fetchBalances = useCallback(async () => {
    try {
      const result = await queryBalancesBetweenUsers(currentUserId, counterpartyId);
      setNetCents(result.netCents);
      setBalances(result.balances);
    } catch {
      // Balance fetch is best-effort for the button
    } finally {
      setLoading(false);
    }
  }, [currentUserId, counterpartyId]);

  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  useEffect(() => {
    const handleRefresh = () => fetchBalances();
    window.addEventListener("app-refresh", handleRefresh);
    return () => window.removeEventListener("app-refresh", handleRefresh);
  }, [fetchBalances]);

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg bg-muted/50 px-3 py-1.5">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // No balance → no button
  if (netCents === 0) return null;

  // netCents > 0 means counterparty owes current user (collect mode)
  // netCents < 0 means current user owes counterparty (pay mode)
  const mode: "pay" | "collect" = netCents < 0 ? "pay" : "collect";
  const absAmount = Math.abs(netCents);

  const relevantGroupCount = computeGroupDebts(balances, currentUserId, mode).length;

  const handleButtonClick = () => {
    if (relevantGroupCount > 1) {
      setShowGroupSheet(true);
    } else {
      setSelectedBalances(balances);
      setShowPix(true);
    }
  };

  const handleGroupConfirm = (filtered: Balance[]) => {
    setSelectedBalances(filtered);
    setShowGroupSheet(false);
    setShowPix(true);
  };

  const selectedTotal = computeGroupDebts(
    selectedBalances.length > 0 ? selectedBalances : balances,
    currentUserId,
    mode,
  ).reduce((sum, g) => sum + g.debtCents, 0);

  const handleMarkPaid = async (amountCents: number) => {
    setSettling(true);
    try {
      const source = selectedBalances.length > 0 ? selectedBalances : balances;
      const settlements = distributeSettlement(
        source,
        currentUserId,
        counterpartyId,
        amountCents,
        mode,
      );

      for (const s of settlements) {
        await recordSettlement(s.groupId, s.fromUserId, s.toUserId, s.amountCents);
        notifySettlementRecorded(s.groupId, s.fromUserId, s.toUserId, s.amountCents).catch(() => {});
      }

      haptics.success();
      setShowPix(false);
      setSelectedBalances([]);
      window.dispatchEvent(new CustomEvent("app-refresh"));
    } catch {
      haptics.error();
    } finally {
      setSettling(false);
    }
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
      >
        <Button
          variant={mode === "pay" ? "default" : "outline"}
          size="sm"
          className="gap-1.5 rounded-full text-xs"
          onClick={handleButtonClick}
          disabled={settling}
        >
          {mode === "pay" ? (
            <ArrowUpRight className="h-3.5 w-3.5" />
          ) : (
            <ArrowDownLeft className="h-3.5 w-3.5" />
          )}
          {mode === "pay" ? "Pagar" : "Cobrar"} {formatBRL(absAmount)}
        </Button>
      </motion.div>

      {showGroupSheet && (
        <GroupSettlementSheet
          open
          onClose={() => setShowGroupSheet(false)}
          balances={balances}
          currentUserId={currentUserId}
          counterpartyId={counterpartyId}
          counterpartyName={counterpartyName}
          mode={mode}
          totalCents={absAmount}
          onConfirm={handleGroupConfirm}
        />
      )}

      {showPix && (
        <PixQrModal
          open
          onClose={() => {
            setShowPix(false);
            setSelectedBalances([]);
          }}
          recipientName={counterpartyName}
          amountCents={selectedTotal || absAmount}
          recipientUserId={mode === "pay" ? counterpartyId : currentUserId}
          mode={mode}
          onMarkPaid={handleMarkPaid}
        />
      )}
    </>
  );
}
