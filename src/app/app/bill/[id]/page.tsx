"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Bell,
  Check,
  CheckCheck,
  Clock,
  QrCode,
  Receipt,
  Users,
} from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";
import { BillSummary } from "@/components/bill/bill-summary";
import { PixQrModal } from "@/components/settlement/pix-qr-modal";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/currency";
import { useBillStore } from "@/stores/bill-store";
import type { BillStatus, DebtStatus } from "@/types";

const debtStatusConfig: Record<
  DebtStatus,
  { label: string; icon: React.ElementType; color: string }
> = {
  pending: { label: "Pendente", icon: Clock, color: "text-warning-foreground bg-warning/15" },
  paid_unconfirmed: {
    label: "Pago (aguardando)",
    icon: Bell,
    color: "text-primary bg-primary/15",
  },
  settled: { label: "Liquidado", icon: CheckCheck, color: "text-success bg-success/15" },
};

const billStatusConfig: Record<BillStatus, { label: string; color: string }> = {
  draft: { label: "Rascunho", color: "bg-muted text-muted-foreground" },
  active: { label: "Pendente", color: "bg-warning/15 text-warning-foreground" },
  partially_settled: { label: "Parcial", color: "bg-primary/15 text-primary" },
  settled: { label: "Liquidado", color: "bg-success/15 text-success" },
};

export default function BillDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const store = useBillStore();
  const [pixModal, setPixModal] = useState<{
    open: boolean;
    entryId: string;
    pixKey: string;
    name: string;
    amount: number;
  }>({
    open: false,
    entryId: "",
    pixKey: "",
    name: "",
    amount: 0,
  });

  const { bill, participants, items, splits, ledger } = store;

  if (!bill) {
    return (
      <div className="mx-auto max-w-lg px-4 py-6">
        <div className="flex items-center gap-3">
          <Link
            href="/app"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="font-semibold">Conta</h1>
        </div>

        <div className="mt-20 text-center">
          <Receipt className="mx-auto h-12 w-12 text-muted-foreground/40" />
          <h2 className="mt-4 text-lg font-semibold">Nenhuma conta ativa</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Crie uma nova conta para comecar.
          </p>
          <Link href="/app/bill/new">
            <Button className="mt-6 gap-2">
              <Receipt className="h-4 w-4" />
              Nova conta
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const billStatus = billStatusConfig[bill.status];

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
          <h1 className="font-semibold">{bill.title}</h1>
          {bill.merchantName && (
            <p className="text-xs text-muted-foreground">{bill.merchantName}</p>
          )}
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${billStatus.color}`}
        >
          {billStatus.label}
        </span>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.4 }}
        className="mt-6"
      >
        <div className="rounded-2xl gradient-primary p-5 text-white shadow-lg shadow-primary/20">
          <p className="text-sm text-white/70">Total da conta</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">
            {formatBRL(
              items.reduce((s, i) => s + i.totalPriceCents, 0) +
                Math.round(
                  (items.reduce((s, i) => s + i.totalPriceCents, 0) *
                    bill.serviceFeePercent) /
                    100,
                ) +
                bill.fixedFees,
            )}
          </p>
          <div className="mt-2 flex gap-4 text-sm text-white/70">
            <span className="flex items-center gap-1">
              <Receipt className="h-3.5 w-3.5" />
              {items.length} itens
            </span>
            <span className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              {participants.length} pessoas
            </span>
          </div>
        </div>
      </motion.div>

      {ledger.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.4 }}
          className="mt-6"
        >
          <h2 className="mb-3 text-sm font-semibold">Cobranças</h2>
          <div className="space-y-3">
            {ledger.map((entry, idx) => {
              const payer = participants.find((p) => p.id === entry.fromUserId);
              const receiver = participants.find((p) => p.id === entry.toUserId);
              const status = debtStatusConfig[entry.status];
              const StatusIcon = status.icon;

              return (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.25 + idx * 0.06 }}
                  className="rounded-2xl border bg-card p-4"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
                        {payer?.name.charAt(0) || "?"}
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          {payer?.name.split(" ")[0] || "?"}{" "}
                          <span className="text-muted-foreground">→</span>{" "}
                          {receiver?.name.split(" ")[0] || "?"}
                        </p>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${status.color}`}
                        >
                          <StatusIcon className="h-3 w-3" />
                          {status.label}
                        </span>
                      </div>
                    </div>
                    <p className="text-lg font-bold tabular-nums">
                      {formatBRL(entry.amountCents)}
                    </p>
                  </div>

                  {entry.status === "pending" && (
                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1 gap-1.5"
                        onClick={() =>
                          setPixModal({
                            open: true,
                            entryId: entry.id,
                            pixKey: receiver?.pixKey || "",
                            name: receiver?.name || "",
                            amount: entry.amountCents,
                          })
                        }
                      >
                        <QrCode className="h-4 w-4" />
                        Pagar via Pix
                      </Button>
                    </div>
                  )}

                  {entry.status === "paid_unconfirmed" && (
                    <div className="mt-3">
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full gap-1.5"
                        onClick={() => store.confirmPayment(entry.id)}
                      >
                        <Check className="h-4 w-4" />
                        Confirmar recebimento
                      </Button>
                    </div>
                  )}

                  {entry.status === "settled" && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-success">
                      <CheckCheck className="h-3.5 w-3.5" />
                      Liquidado{" "}
                      {entry.confirmedAt &&
                        `em ${new Date(entry.confirmedAt).toLocaleString("pt-BR")}`}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35, duration: 0.4 }}
        className="mt-6"
      >
        <BillSummary
          bill={bill}
          items={items}
          splits={splits}
          participants={participants}
        />
      </motion.div>

      <PixQrModal
        open={pixModal.open}
        onClose={() => setPixModal({ ...pixModal, open: false })}
        pixKey={pixModal.pixKey}
        recipientName={pixModal.name}
        amountCents={pixModal.amount}
        onMarkPaid={() => {
          store.markPaid(pixModal.entryId);
          setPixModal({ ...pixModal, open: false });
        }}
      />
    </div>
  );
}
