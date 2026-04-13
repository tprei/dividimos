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
  RefreshCw,
  ScanLine,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { UserAvatar } from "@/components/shared/user-avatar";
import { DebtCard } from "@/components/dashboard/debt-card";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { formatBRL } from "@/lib/currency";
import { useUser } from "@/hooks/use-auth";
import { OnboardingTour } from "@/components/onboarding/onboarding-tour";
import { recordSettlement } from "@/lib/supabase/settlement-actions";
import { notifySettlementRecorded, notifyPaymentNudge } from "@/lib/push/push-notify";
import { fetchUserDebts } from "@/lib/supabase/debt-actions";
import type { DebtSummary } from "@/types";

import { ModalLoadingSkeleton } from "@/components/shared/skeleton";

const PixQrModal = dynamic(
  () =>
    import("@/components/settlement/pix-qr-modal").then((m) => ({
      default: m.PixQrModal,
    })),
  { ssr: false, loading: () => <ModalLoadingSkeleton /> },
);

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

interface DashboardContentProps {
  initialDebts: DebtSummary[];
  initialNetBalance: number;
}

export function DashboardContent({
  initialDebts,
  initialNetBalance,
}: DashboardContentProps) {
  const user = useUser();
  const router = useRouter();
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [debts, setDebts] = useState<DebtSummary[]>(initialDebts);
  const [netBalance, setNetBalance] = useState(initialNetBalance);
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [activeTab, setActiveTab] = useState<"owes" | "owed">("owes");
  const [pixModal, setPixModal] = useState<{
    debt: DebtSummary;
    mode: "pay" | "collect";
  } | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [nudgeSent, setNudgeSent] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    const stored = localStorage.getItem("nudge-cooldowns");
    if (!stored) return new Set();
    try {
      const parsed = JSON.parse(stored) as Record<string, number>;
      const now = Date.now();
      const active = new Set<string>();
      for (const [key, ts] of Object.entries(parsed)) {
        if (now - ts < 24 * 60 * 60 * 1000) active.add(key);
      }
      return active;
    } catch { return new Set(); }
  });
  const touchStartY = useRef(0);
  const touchStartX = useRef(0);
  const touchStartTime = useRef(0);

  const owesCount = debts.filter((d) => d.direction === "owes").length;
  const owedCount = debts.filter((d) => d.direction === "owed").length;
  const filteredDebts = debts.filter((d) => d.direction === activeTab);

  const fetchDashboard = useCallback(async () => {
    if (!user) return;

    const refreshed = await fetchUserDebts(user.id);
    setDebts(refreshed);

    let net = 0;
    for (const d of refreshed) {
      net += d.direction === "owes" ? -d.amountCents : d.amountCents;
    }
    setNetBalance(net);
  }, [user]);

  const handleNavigate = useCallback(async (debt: DebtSummary) => {
    router.push(`/app/conversations/${debt.counterpartyId}`);
  }, [router]);

  const handleRecordSettlement = async (
    debt: DebtSummary,
    amountCents: number,
  ) => {
    const fromUserId =
      debt.direction === "owes" ? user!.id : debt.counterpartyId;
    const toUserId =
      debt.direction === "owes" ? debt.counterpartyId : user!.id;

    setActing(debt.groupId + debt.counterpartyId);
    await recordSettlement(debt.groupId, fromUserId, toUserId, amountCents);
    notifySettlementRecorded(debt.groupId, fromUserId, toUserId, amountCents).catch(() => {});
    setActing(null);
  };

  const handleNudge = useCallback((debt: DebtSummary) => {
    const key = `${debt.groupId}-${debt.counterpartyId}`;
    if (nudgeSent.has(key)) return;

    notifyPaymentNudge(debt.groupId, debt.counterpartyId, debt.amountCents).catch(() => {});

    const next = new Set(nudgeSent);
    next.add(key);
    setNudgeSent(next);

    const stored = localStorage.getItem("nudge-cooldowns");
    const parsed: Record<string, number> = stored ? JSON.parse(stored) : {};
    parsed[key] = Date.now();
    localStorage.setItem("nudge-cooldowns", JSON.stringify(parsed));
  }, [nudgeSent]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartTime.current = Date.now();
    if (window.scrollY === 0) {
      touchStartY.current = e.touches[0].clientY;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current > 0) {
      const distance = Math.max(0, e.touches[0].clientY - touchStartY.current);
      setPullDistance(Math.min(distance, 100));
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const deltaX = e.changedTouches[0].clientX - touchStartX.current;
    const deltaTime = Date.now() - touchStartTime.current;

    if (Math.abs(deltaX) > 50 && deltaTime < 400) {
      if (deltaX < 0 && activeTab === "owes") {
        setActiveTab("owed");
      } else if (deltaX > 0 && activeTab === "owed") {
        setActiveTab("owes");
      }
    }

    if (pullDistance > 60) {
      setRefreshing(true);
      fetchDashboard().finally(() => setRefreshing(false));
    }
    setPullDistance(0);
    touchStartY.current = 0;
    touchStartX.current = 0;
  };

  const isPositive = netBalance >= 0;
  const firstName = user?.name.split(" ")[0] ?? "";

  return (
    <div
      className="mx-auto max-w-lg px-4 py-6"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {pullDistance > 0 && (
        <div className="flex justify-center" style={{ height: pullDistance * 0.5 }}>
          <RefreshCw
            className={`h-5 w-5 text-muted-foreground ${pullDistance > 60 ? "text-primary" : ""}`}
            style={{ transform: `rotate(${pullDistance * 3}deg)` }}
          />
        </div>
      )}
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
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setRefreshing(true);
                fetchDashboard().finally(() => setRefreshing(false));
              }}
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
            >
              <RefreshCw
                className={`h-5 w-5 ${refreshing ? "animate-spin" : ""}`}
              />
            </button>
            <Link href="/app/profile">
              <UserAvatar name={user?.name ?? ""} avatarUrl={user?.avatarUrl} size="md" />
            </Link>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, duration: 0.4 }}
        className="mt-5"
      >
        <div
          data-tour="balance-card"
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
        data-tour="quick-actions"
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
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.4 }}
        className="mt-8"
      >
        <div data-tour="debt-tabs" className="flex items-center justify-between">
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
          {filteredDebts.map((debt) => {
            const debtKey = `${debt.groupId}-${debt.counterpartyId}`;
            const isActingOnThis = acting === debtKey;
            return (
              <motion.div key={debtKey} variants={staggerItem}>
                <DebtCard
                  debt={debt}
                  onPay={(d) => setPixModal({ debt: d, mode: "pay" })}
                  onCollect={(d) => setPixModal({ debt: d, mode: "collect" })}
                  onNudge={handleNudge}
                  onNavigate={handleNavigate}
                  isActing={isActingOnThis}
                  nudgeCooldown={nudgeSent.has(`${debt.groupId}-${debt.counterpartyId}`)}
                />
              </motion.div>
            );
          })}
        </motion.div>
      </motion.div>

      <OnboardingTour userId={user?.id} />

      {pixModal && (
        <PixQrModal
          open
          onClose={() => setPixModal(null)}
          recipientName={pixModal.debt.counterpartyName}
          amountCents={pixModal.debt.amountCents}
          recipientUserId={pixModal.debt.counterpartyId}
          groupId={pixModal.debt.groupId}
          mode={pixModal.mode}
          onMarkPaid={async (amountCents: number) => {
            await handleRecordSettlement(pixModal!.debt, amountCents);
          }}
          onSettlementComplete={() => {
            setPixModal(null);
            fetchDashboard();
          }}
        />
      )}
    </div>
  );
}
