"use client";

import { motion } from "framer-motion";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCheck,
  Eye,
  EyeOff,
  Plus,
  QrCode,
  ScanLine,
  Zap,
} from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useState } from "react";
import toast from "react-hot-toast";
import { DebtCard } from "@/components/dashboard/debt-card";
import { UserAvatar } from "@/components/shared/user-avatar";
import {
  DashboardSkeleton,
  ModalLoadingSkeleton,
} from "@/components/shared/skeleton";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { formatBRL } from "@/lib/currency";
import { selectDebtRows } from "@/lib/ledger/debt-rows";
import type { DebtRow } from "@/lib/ledger/debt-rows";
import { LedgerError, ledgerErrorMessage } from "@/lib/sync/errors";
import { recordSettlement } from "@/lib/sync/mutations";
import { sendNudge } from "@/lib/sync/mutations-group";
import { useMe } from "@/hooks/use-me";
import { useAppStore } from "@/stores/app-store";

const PixQrModal = dynamic(
  () =>
    import("@/components/settlement/pix-qr-modal").then((m) => ({
      default: m.PixQrModal,
    })),
  { ssr: false, loading: () => <ModalLoadingSkeleton /> },
);

const QuickChargeModal = dynamic(
  () =>
    import("@/components/dashboard/quick-charge-modal").then((m) => ({
      default: m.QuickChargeModal,
    })),
  { ssr: false, loading: () => <ModalLoadingSkeleton /> },
);

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

export function DashboardContent() {
  const me = useMe();
  const hydrated = useAppStore((s) => s.hydrated);
  const debtRows = useAppStore(selectDebtRows);
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [activeTab, setActiveTab] = useState<"owes" | "owed">("owes");
  const [pixTarget, setPixTarget] = useState<{
    debt: DebtRow;
    mode: "pay" | "collect";
  } | null>(null);
  const [quickChargeOpen, setQuickChargeOpen] = useState(false);

  if (!hydrated || !me) {
    return (
      <div className="px-4 py-6">
        <DashboardSkeleton />
      </div>
    );
  }

  const firstName = me.name.split(" ")[0];
  const owesCount = debtRows.filter((row) => row.direction === "owes").length;
  const owedCount = debtRows.length - owesCount;
  const netBalance = debtRows.reduce(
    (sum, row) => sum + (row.direction === "owed" ? row.amountCents : -row.amountCents),
    0,
  );
  const isPositive = netBalance >= 0;
  const filteredDebts = debtRows.filter((row) => row.direction === activeTab);
  const handleMarkPaid = async (amountCents: number) => {
    if (!me || !pixTarget) throw new LedgerError("unauthenticated");
    const { debt, mode } = pixTarget;
    await recordSettlement({
      groupId: debt.groupId,
      fromUserId: mode === "pay" ? me.id : debt.counterpartyId,
      toUserId: mode === "pay" ? debt.counterpartyId : me.id,
      amountCents,
    });
  };
  const handleNudge = async (groupId: string, counterpartyId: string) => {
    try {
      await sendNudge(groupId, counterpartyId);
      toast.success("Lembrete enviado");
    } catch (error) {
      toast.error(ledgerErrorMessage(error));
    }
  };

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{getGreeting()}</p>
            <h1 className="text-2xl font-bold">{firstName}</h1>
          </div>
          <Link href="/app/profile">
            <UserAvatar name={me.name} avatarUrl={me.avatarUrl} size="md" priority />
          </Link>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, duration: 0.4 }}
        className="mt-5"
      >
        <div
          className={`rounded-2xl p-5 text-white shadow-lg ${
            isPositive
              ? "gradient-income shadow-income/20"
              : "gradient-primary shadow-primary/20"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isPositive ? (
                <ArrowDownLeft className="h-4 w-4 text-white/70" />
              ) : (
                <ArrowUpRight className="h-4 w-4 text-white/70" />
              )}
              <p className="text-sm text-white/70">
                {isPositive ? "A receber" : "A pagar"}
              </p>
            </div>
            <button
              onClick={() => setBalanceVisible(!balanceVisible)}
              className="rounded-lg p-1.5 text-white/60 transition-colors hover:text-white/90"
            >
              {balanceVisible ? (
                <Eye className="h-5 w-5" />
              ) : (
                <EyeOff className="h-5 w-5" />
              )}
            </button>
          </div>
          <motion.p
            key={`${netBalance}-${balanceVisible}`}
            initial={{ y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="mt-1 text-3xl font-bold tabular-nums"
          >
            {balanceVisible ? formatBRL(Math.abs(netBalance)) : "R$ ••••••"}
          </motion.p>
          <p className="mt-1 text-sm text-white/60">
            {owesCount} conta
            {owesCount !== 1 ? "s" : ""} pendente
            {owesCount !== 1 ? "s" : ""}
          </p>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.14, duration: 0.4 }}
        className="mt-3 flex gap-2"
      >
        <Link
          href="/app/bill/new?scan=true"
          className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
        >
          <ScanLine className="h-3.5 w-3.5" />
          Escanear notinha
        </Link>
        <Link
          href="/app/scan-invite"
          className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
        >
          <QrCode className="h-3.5 w-3.5" />
          Ler convite
        </Link>
        {me.pixKeyHint && (
          <button
            onClick={() => setQuickChargeOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/5 px-3 py-1.5 text-xs font-medium text-success transition-colors hover:bg-success/10"
          >
            <Zap className="h-3.5 w-3.5" />
            Cobrar rápido
          </button>
        )}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.23, duration: 0.4 }}
        className="mt-8"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Quem deve o quê</h2>
          <Link
            href="/app/groups"
            className="flex items-center gap-1 text-sm font-medium text-primary"
          >
            Ver tudo
          </Link>
        </div>

        <div className="mt-3 flex gap-2">
          <button
            onClick={() => setActiveTab("owes")}
            className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === "owes"
                ? "bg-destructive/10 text-destructive"
                : "bg-muted text-muted-foreground"
            }`}
          >
            Você deve{" "}
            <span
              className={`ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold ${
                activeTab === "owes"
                  ? "bg-destructive/20 text-destructive"
                  : "bg-muted-foreground/15 text-muted-foreground"
              }`}
            >
              {owesCount}
            </span>
          </button>
          <button
            onClick={() => setActiveTab("owed")}
            className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === "owed"
                ? "bg-success/10 text-success"
                : "bg-muted text-muted-foreground"
            }`}
          >
            Você recebe{" "}
            <span
              className={`ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold ${
                activeTab === "owed"
                  ? "bg-success/20 text-success"
                  : "bg-muted-foreground/15 text-muted-foreground"
              }`}
            >
              {owedCount}
            </span>
          </button>
        </div>

        {filteredDebts.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="mt-6 flex flex-col items-center rounded-2xl border border-dashed p-8 text-center"
          >
            <div className="rounded-2xl bg-success/10 p-3">
              <CheckCheck className="h-7 w-7 text-success" />
            </div>
            <p className="mt-3 text-sm font-semibold text-foreground">
              {activeTab === "owes"
                ? "Tudo certo por aqui!"
                : "Ninguém te deve nada"}
            </p>
            <p className="mt-1 max-w-[240px] text-sm text-muted-foreground">
              {activeTab === "owes"
                ? "Você não tem nenhuma conta pendente. Cria uma conta nova pra rachar com a galera."
                : "Quando alguém te dever, aparece aqui."}
            </p>
            {activeTab === "owes" && (
              <Link
                href="/app/bill/new"
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" />
                Nova conta
              </Link>
            )}
          </motion.div>
        )}

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="mt-4 space-y-3"
        >
          {filteredDebts.map((debt) => (
            <motion.div
              key={`${debt.groupId}-${debt.counterpartyId}`}
              variants={staggerItem}
            >
              <DebtCard
                debt={debt}
                onPay={(row) => setPixTarget({ debt: row, mode: "pay" })}
                onCharge={
                  debt.direction === "owed" && debt.counterpartyKind === "user"
                    ? () => setPixTarget({ debt, mode: "collect" })
                    : undefined
                }
                onNudge={
                  debt.direction === "owed" && debt.counterpartyKind === "user"
                    ? () => handleNudge(debt.groupId, debt.counterpartyId)
                    : undefined
                }
              />
            </motion.div>
          ))}
        </motion.div>
      </motion.div>

      {quickChargeOpen && (
        <QuickChargeModal
          open
          onClose={() => setQuickChargeOpen(false)}
        />
      )}

      {pixTarget && (
        <PixQrModal
          open
          onClose={() => setPixTarget(null)}
          recipientName={pixTarget.debt.counterpartyName}
          amountCents={pixTarget.debt.amountCents}
          recipientUserId={
            pixTarget.mode === "pay" ? pixTarget.debt.counterpartyId : me.id
          }
          groupId={pixTarget.debt.groupId}
          mode={pixTarget.mode}
          onMarkPaid={handleMarkPaid}
        />
      )}
    </div>
  );
}
