"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { CheckCheck } from "lucide-react";
import dynamic from "next/dynamic";
import { ModalLoadingSkeleton } from "@/components/shared/skeleton";
const PixQrModal = dynamic(
  () => import("@/components/settlement/pix-qr-modal").then((m) => ({ default: m.PixQrModal })),
  { ssr: false, loading: () => <ModalLoadingSkeleton /> },
);
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/currency";
import type { DebtRow } from "@/lib/ledger/debt-rows";
import { recordSettlement } from "@/lib/sync/mutations";

interface GroupSettlementViewProps {
  groupId: string;
  rows: DebtRow[];
  meId: string;
}

interface PixTarget {
  counterpartyId: string;
  recipientName: string;
  amountCents: number;
}

export function GroupSettlementView({ groupId, rows }: GroupSettlementViewProps) {
  const [pixTarget, setPixTarget] = useState<PixTarget | null>(null);

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center py-12 text-center">
        <div className="rounded-2xl bg-success/10 p-3">
          <CheckCheck className="h-8 w-8 text-success" />
        </div>
        <p className="mt-3 text-base font-semibold text-foreground">Tudo liquidado!</p>
        <p className="mt-1 max-w-[240px] text-sm text-muted-foreground">
          Nenhuma dívida pendente no grupo. Quando uma conta for ativada, os saldos aparecem aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const isUser = row.counterpartyKind === "user";
        const iOwe = row.direction === "owes";
        const firstName = row.counterpartyName.split(" ")[0];
        const rowKey = `${row.counterpartyId}-${row.direction}`;
        return (
          <motion.div
            key={rowKey}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border bg-card p-4"
          >
            <div className="mb-3 flex items-center gap-3">
              <UserAvatar
                name={row.counterpartyName}
                avatarUrl={row.counterpartyAvatarUrl}
                size="sm"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {iOwe ? `Você → ${firstName}` : `${firstName} → Você`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {iOwe ? "Você deve" : "Você recebe"}
                  {!isUser && " · Convidado"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold tabular-nums">
                  {formatBRL(row.amountCents)}
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              {isUser && iOwe && (
                <Button
                  className="flex-1"
                  size="sm"
                  onClick={() =>
                    setPixTarget({
                      counterpartyId: row.counterpartyId,
                      recipientName: row.counterpartyName,
                      amountCents: row.amountCents,
                    })
                  }
                >
                  Pagar via Pix
                </Button>
              )}
              {isUser && !iOwe && (
                <div className="flex-1 py-2 text-center text-xs text-muted-foreground">
                  Aguardando pagamento
                </div>
              )}
              {!isUser && (
                <div className="flex-1 py-2 text-center text-xs text-muted-foreground">
                  Participante convidado
                </div>
              )}
            </div>
          </motion.div>
        );
      })}

      {pixTarget && (
        <PixQrModal
          open
          onClose={() => setPixTarget(null)}
          recipientName={pixTarget.recipientName}
          amountCents={pixTarget.amountCents}
          recipientUserId={pixTarget.counterpartyId}
          groupId={groupId}
          mode="pay"
          onMarkPaid={(amountCents: number) =>
            recordSettlement({
              groupId,
              toUserId: pixTarget.counterpartyId,
              amountCents,
            }).then(() => undefined)
          }
        />
      )}
    </div>
  );
}
