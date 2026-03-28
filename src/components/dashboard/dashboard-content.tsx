"use client";

import { motion } from "framer-motion";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Receipt,
  RefreshCw,
  ScanLine,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UserAvatar } from "@/components/shared/user-avatar";
import { SwipeableBillCard } from "@/components/bill/swipeable-bill-card";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBRL } from "@/lib/currency";
import { useBillInvites } from "@/hooks/use-bill-invites";
import { createClient } from "@/lib/supabase/client";
import { deleteDraftFromSupabase } from "@/lib/supabase/delete-draft";
import { useUser } from "@/hooks/use-auth";
import type { BillStatus } from "@/types";

interface RecentBill {
  id: string;
  title: string;
  date: string;
  total: number;
  participants: number;
  status: BillStatus;
  myBalance: number;
  creatorId: string;
}

const statusConfig: Record<BillStatus, { label: string; color: string }> = {
  draft: { label: "Rascunho", color: "bg-muted text-muted-foreground" },
  active: { label: "Pendente", color: "bg-warning/15 text-warning-foreground" },
  partially_settled: { label: "Parcial", color: "bg-primary/15 text-primary" },
  settled: { label: "Liquidado", color: "bg-success/15 text-success" },
};

function QuickAction({
  icon: Icon,
  label,
  href,
}: {
  icon: React.ElementType;
  label: string;
  href: string;
}) {
  return (
    <Link href={href} className="flex-1">
      <motion.div
        whileTap={{ scale: 0.95 }}
        className="flex flex-col items-center gap-1.5 rounded-2xl border bg-card p-3 transition-colors hover:border-primary/30"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <span className="text-xs font-medium">{label}</span>
      </motion.div>
    </Link>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

interface DashboardContentProps {
  initialBills: RecentBill[];
  initialNetBalance: number;
}

export function DashboardContent({ initialBills, initialNetBalance }: DashboardContentProps) {
  const router = useRouter();
  const user = useUser();
  const { invites: billInvites, loading: invitesLoading } = useBillInvites();
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [bills, setBills] = useState<RecentBill[]>(initialBills);
  const [netBalance, setNetBalance] = useState(initialNetBalance);
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const touchStartY = useRef(0);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const targetId = deleteTarget;
    const removed = bills.find((b) => b.id === targetId);
    setBills((prev) => prev.filter((b) => b.id !== targetId));
    setDeleteTarget(null);
    const result = await deleteDraftFromSupabase(targetId);
    if (result.error && removed) {
      setBills((prev) => [...prev, removed]);
    }
    setDeleting(false);
  };

  const fetchDashboard = useCallback(async () => {
    if (!user) return;
    const supabase = createClient();

    const [billsResult, debtOwedResult, debtToMeResult] = await Promise.all([
      supabase
        .from("bills")
        .select("id, title, status, total_amount, created_at, creator_id")
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("ledger")
        .select("amount_cents")
        .eq("from_user_id", user.id)
        .neq("status", "settled"),
      supabase
        .from("ledger")
        .select("amount_cents")
        .eq("to_user_id", user.id)
        .neq("status", "settled"),
    ]);

    const myBills = billsResult.data ?? [];

    if (myBills.length > 0) {
      const billIds = myBills.map((b) => b.id);
      const { data: participantRows } = await supabase
        .from("bill_participants")
        .select("bill_id")
        .in("bill_id", billIds);

      const countMap = new Map<string, number>();
      for (const row of participantRows ?? []) {
        countMap.set(row.bill_id, (countMap.get(row.bill_id) ?? 0) + 1);
      }

      setBills(
        myBills.map((bill) => ({
          id: bill.id,
          title: bill.title,
          date: new Date(bill.created_at).toLocaleDateString("pt-BR", {
            day: "2-digit",
            month: "short",
          }),
          total: bill.total_amount,
          participants: countMap.get(bill.id) ?? 0,
          status: bill.status,
          myBalance: 0,
          creatorId: bill.creator_id,
        })),
      );
    } else {
      setBills([]);
    }

    const iOwe = (debtOwedResult.data ?? []).reduce((s, d) => s + d.amount_cents, 0);
    const theyOweMe = (debtToMeResult.data ?? []).reduce((s, d) => s + d.amount_cents, 0);
    setNetBalance(theyOweMe - iOwe);
  }, [user]);

  const handleTouchStart = (e: React.TouchEvent) => {
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

  const handleTouchEnd = () => {
    if (pullDistance > 60) {
      setRefreshing(true);
      fetchDashboard().finally(() => setRefreshing(false));
    }
    setPullDistance(0);
    touchStartY.current = 0;
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
              onClick={() => { setRefreshing(true); fetchDashboard().finally(() => setRefreshing(false)); }}
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
            >
              <RefreshCw className={`h-5 w-5 ${refreshing ? "animate-spin" : ""}`} />
            </button>
            <Link href="/app/profile">
              <UserAvatar
                name={user?.name ?? ""}
                avatarUrl={user?.avatarUrl}
                size="md"
              />
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
            {bills.filter((b) => b.status === "active").length} conta
            {bills.filter((b) => b.status === "active").length !== 1 ? "s" : ""}{" "}
            pendente{bills.filter((b) => b.status === "active").length !== 1 ? "s" : ""}
          </p>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.14, duration: 0.4 }}
        className="mt-4 grid grid-cols-3 gap-3"
      >
        <QuickAction icon={Plus} label="Nova conta" href="/app/bill/new" />
        <QuickAction icon={ScanLine} label="Escanear" href="/app/bill/new" />
        <QuickAction icon={Users} label="Grupos" href="/app/groups" />
      </motion.div>

      {!invitesLoading && billInvites.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18, duration: 0.4 }}
          className="mt-6"
        >
          <h2 className="mb-3 text-sm font-semibold flex items-center gap-2">
            <Receipt className="h-4 w-4 text-primary" />
            Convites de conta
          </h2>
          <div className="space-y-2">
            {billInvites.map((invite) => (
              <Link key={invite.billId} href={`/app/bill/${invite.billId}/invite`}>
                <div className="flex items-center justify-between rounded-2xl border border-primary/20 bg-primary/5 p-4 transition-colors hover:border-primary/40">
                  <div>
                    <p className="font-medium">{invite.billTitle}</p>
                    <p className="text-xs text-muted-foreground">
                      Convidado por {invite.invitedByName} · {invite.totalAmount > 0 ? formatBRL(invite.totalAmount) : "Em criação"}
                    </p>
                  </div>
                  <Button size="sm" className="shrink-0">Ver</Button>
                </div>
              </Link>
            ))}
          </div>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.4 }}
        className="mt-8"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Contas recentes</h2>
          <Link
            href="/app/bills"
            className="flex items-center gap-1 text-sm font-medium text-primary"
          >
            Ver todas
          </Link>
        </div>

        {bills.length === 0 && (
          <div className="mt-6 rounded-2xl border border-dashed p-8 text-center">
            <Receipt className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-2 text-sm text-muted-foreground">
              Nenhuma conta ainda
            </p>
            <Link href="/app/bill/new">
              <Button size="sm" className="mt-3">
                Criar primeira conta
              </Button>
            </Link>
          </div>
        )}

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="mt-4 space-y-3"
        >
          {bills.map((bill) => {
            const status = statusConfig[bill.status];
            const isDraft = bill.status === "draft" && bill.creatorId === user?.id;
            return (
              <motion.div key={bill.id} variants={staggerItem}>
                <SwipeableBillCard
                  enabled={isDraft}
                  onEdit={() => router.push(`/app/bill/new?draft=${bill.id}`)}
                  onDelete={() => setDeleteTarget(bill.id)}
                >
                  <Link href={`/app/bill/${bill.id}`}>
                    <div className="group flex items-center gap-4 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/30">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
                        <Receipt className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{bill.title}</p>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{bill.date}</span>
                          <span>·</span>
                          <span>{bill.participants} pessoas</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold tabular-nums">
                          {bill.total > 0 ? formatBRL(bill.total) : bill.status === "draft" ? "Em criação" : formatBRL(bill.total)}
                        </p>
                        <span
                          className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${status.color}`}
                        >
                          {status.label}
                        </span>
                      </div>
                    </div>
                  </Link>
                </SwipeableBillCard>
              </motion.div>
            );
          })}
        </motion.div>
      </motion.div>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Excluir rascunho?</DialogTitle>
            <DialogDescription>
              Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose
              render={<Button variant="outline" />}
              disabled={deleting}
            >
              Cancelar
            </DialogClose>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Excluir"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
