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
import { useState } from "react";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/currency";
import type { BillStatus } from "@/types";

const recentBills = [
  {
    id: "1",
    title: "Churrascaria Fogo de Chao",
    date: "Hoje, 21:30",
    total: 34500,
    participants: 4,
    status: "active" as BillStatus,
    settledCount: 1,
    totalDebts: 3,
  },
  {
    id: "2",
    title: "Bar do Zeca",
    date: "Ontem, 23:15",
    total: 18700,
    participants: 3,
    status: "settled" as BillStatus,
    settledCount: 2,
    totalDebts: 2,
  },
  {
    id: "3",
    title: "Padaria Brasileira",
    date: "20 Mar, 08:45",
    total: 6400,
    participants: 2,
    status: "partially_settled" as BillStatus,
    settledCount: 0,
    totalDebts: 1,
  },
];

const statusConfig: Record<BillStatus, { label: string; color: string }> = {
  draft: { label: "Rascunho", color: "bg-muted text-muted-foreground" },
  active: { label: "Pendente", color: "bg-warning/15 text-warning-foreground" },
  partially_settled: { label: "Parcial", color: "bg-primary/15 text-primary" },
  settled: { label: "Liquidado", color: "bg-success/15 text-success" },
};

function SettlementRing({
  settled,
  total,
  size = 40,
}: {
  settled: number;
  total: number;
  size?: number;
}) {
  const r = (size - 6) / 2;
  const circumference = 2 * Math.PI * r;
  const progress = total > 0 ? settled / total : 0;
  const offset = circumference * (1 - progress);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          className="text-muted"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          className={progress === 1 ? "text-success" : "text-primary"}
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <Receipt className="h-4 w-4 text-muted-foreground" />
      </div>
    </div>
  );
}

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
  const [balanceVisible, setBalanceVisible] = useState(true);
  const netBalance = -34500;
  const isPositive = netBalance >= 0;

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
            <h1 className="text-2xl font-bold">Pedro</h1>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
            PR
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
            1 conta pendente · 3 contas este mes
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
        <QuickAction icon={Users} label="Amigos" href="/app/bills" />
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
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="mt-4 space-y-3"
        >
          {recentBills.map((bill) => {
            const status = statusConfig[bill.status];
            return (
              <motion.div key={bill.id} variants={staggerItem}>
                <Link href={`/app/bill/${bill.id}`}>
                  <div className="group flex items-center gap-4 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/30">
                    <SettlementRing
                      settled={bill.settledCount}
                      total={bill.totalDebts}
                    />
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
