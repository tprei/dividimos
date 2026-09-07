"use client";

import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { ModalLoadingSkeleton } from "@/components/shared/skeleton";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/currency";
import type { DebtRow } from "@/lib/ledger/debt-rows";
import { recordSettlement } from "@/lib/sync/mutations";

const PixQrModal = dynamic(
  () =>
    import("@/components/settlement/pix-qr-modal").then((m) => ({
      default: m.PixQrModal,
    })),
  { ssr: false, loading: () => <ModalLoadingSkeleton /> },
);

interface ConversationPayButtonProps {
  groupId: string;
  meId: string;
  counterpartyId: string;
  counterpartyName: string;
  rows: DebtRow[];
}

export function ConversationPayButton({
  groupId,
  meId,
  counterpartyId,
  counterpartyName,
  rows,
}: ConversationPayButtonProps) {
  const [showPix, setShowPix] = useState(false);

  const netCents = useMemo(
    () =>
      rows.reduce(
        (sum, row) => sum + (row.direction === "owed" ? row.amountCents : -row.amountCents),
        0,
      ),
    [rows],
  );

  if (netCents === 0) return null;

  const mode: "pay" | "collect" = netCents < 0 ? "pay" : "collect";
  const absAmount = Math.abs(netCents);
  const recipientUserId = mode === "pay" ? counterpartyId : meId;


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
          onClick={() => setShowPix(true)}
        >
          {mode === "pay" ? (
            <ArrowUpRight className="h-3.5 w-3.5" />
          ) : (
            <ArrowDownLeft className="h-3.5 w-3.5" />
          )}
          {mode === "pay" ? "Pagar" : "Cobrar"} {formatBRL(absAmount)}
        </Button>
      </motion.div>

      {showPix && (
        <PixQrModal
          open
          onClose={() => setShowPix(false)}
          recipientName={counterpartyName}
          amountCents={absAmount}
          recipientUserId={recipientUserId}
          groupId={groupId}
          mode={mode}
          onMarkPaid={async (amountCents: number) => {
            await recordSettlement({
              groupId,
              fromUserId: mode === "pay" ? meId : counterpartyId,
              toUserId: mode === "pay" ? counterpartyId : meId,
              amountCents,
            });
          }}
          onSettlementComplete={() => setShowPix(false)}
        />
      )}
    </>
  );
}
