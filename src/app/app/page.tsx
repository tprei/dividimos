"use client";

import { motion } from "framer-motion";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Eye,
  EyeOff,
  Plus,
  Receipt,
  ScanLine,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Skeleton } from "@/components/shared/skeleton";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/currency";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { BillStatus } from "@/types";

interface RecentBill {
  id: string;
  title: string;
  date: string;
  total: number;
  participants: number;
  status: BillStatus;
  myBalance: number;
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

export default function AppHome() {
  const { user, loading: authLoading } = useAuth();
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [bills, setBills] = useState<RecentBill[]>([]);
  const [netBalance, setNetBalance] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const supabase = createClient();

    async function fetchDashboard() {
      const { data: myBills } = await supabase
        .from("bills")
        .select("id, title, status, total_amount, created_at")
        .order("created_at", { ascending: false })
        .limit(5);

      if (myBills) {
        const recent: RecentBill[] = [];
        for (const bill of myBills) {
          const { count } = await supabase
            .from("bill_participants")
            .select("*", { count: "exact", head: true })
            .eq("bill_id", bill.id);

          recent.push({
            id: bill.id,
            title: bill.title,
            date: new Date(bill.created_at).toLocaleDateString("pt-BR", {
              day: "2-digit",
              month: "short",
            }),
            total: bill.total_amount,
            participants: count ?? 0,
            status: bill.status,
            myBalance: 0,
          });
        }
        setBills(recent);
      }

      const { data: debtsOwed } = await supabase
        .from("ledger")
        .select("amount_cents")
        .eq("from_user_id", user!.id)
        .neq("status", "settled");

      const { data: debtsOwedToMe } = await supabase
        .from("ledger")
        .select("amount_cents")
        .eq("to_user_id", user!.id)
        .neq("status", "settled");

      const iOwe = (debtsOwed ?? []).reduce((s, d) => s + d.amount_cents, 0);
      const theyOweMe = (debtsOwedToMe ?? []).reduce((s, d) => s + d.amount_cents, 0);
      setNetBalance(theyOweMe - iOwe);

      setLoading(false);
    }

    fetchDashboard();
  }, [user]);

  if (authLoading || loading) {
    return (
      <div className="mx-auto max-w-lg px-4 py-6 space-y-4">
        <Skeleton className="h-12 w-48" />
        <Skeleton className="h-32 w-full rounded-2xl" />
        <div className="grid grid-cols-3 gap-3">
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
        </div>
      </div>
    );
  }

  const isPositive = netBalance >= 0;
  const firstName = user?.name.split(" ")[0] ?? "";

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
            <UserAvatar
              name={user?.name ?? ""}
              avatarUrl={user?.avatarUrl}
              size="md"
            />
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

        {bills.length === 0 && !loading && (
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
            return (
              <motion.div key={bill.id} variants={staggerItem}>
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
                        {formatBRL(bill.total)}
                      </p>
                      <span
                        className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${status.color}`}
                      >
                        {status.label}
                      </span>
                    </div>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </motion.div>
      </motion.div>
    </div>
  );
}
