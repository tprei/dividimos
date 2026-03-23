"use client";

import { motion } from "framer-motion";
import {
  ArrowUpRight,
  Clock,
  Plus,
  Receipt,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/currency";

const recentBills = [
  {
    id: "1",
    title: "Churrascaria Fogo de Chao",
    date: "Hoje, 21:30",
    total: 34500,
    participants: 4,
    status: "active" as const,
    settled: 2,
  },
  {
    id: "2",
    title: "Bar do Zeca",
    date: "Ontem, 23:15",
    total: 18700,
    participants: 3,
    status: "settled" as const,
    settled: 3,
  },
  {
    id: "3",
    title: "Padaria Brasileira",
    date: "20 Mar, 08:45",
    total: 6400,
    participants: 2,
    status: "partially_settled" as const,
    settled: 1,
  },
];

const statusConfig = {
  draft: { label: "Rascunho", color: "bg-muted text-muted-foreground" },
  active: { label: "Pendente", color: "bg-warning/15 text-warning-foreground" },
  partially_settled: { label: "Parcial", color: "bg-primary/15 text-primary" },
  settled: { label: "Liquidado", color: "bg-success/15 text-success" },
};

export default function AppHome() {
  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Boa noite</p>
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
        transition={{ delay: 0.1, duration: 0.4 }}
        className="mt-6 grid grid-cols-2 gap-3"
      >
        <div className="rounded-2xl border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span className="text-xs font-medium">Pendente</span>
          </div>
          <p className="mt-2 text-xl font-bold tabular-nums">
            {formatBRL(34500)}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">1 conta aberta</p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <TrendingUp className="h-4 w-4" />
            <span className="text-xs font-medium">Este mes</span>
          </div>
          <p className="mt-2 text-xl font-bold tabular-nums">
            {formatBRL(59600)}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">3 contas</p>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.4 }}
        className="mt-6"
      >
        <Link href="/app/bill/new">
          <Button className="w-full gap-2 text-base" size="lg">
            <Plus className="h-5 w-5" />
            Nova conta
          </Button>
        </Link>
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

        <div className="mt-4 space-y-3">
          {recentBills.map((bill, idx) => {
            const status = statusConfig[bill.status];
            return (
              <motion.div
                key={bill.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 + idx * 0.08, duration: 0.4 }}
              >
                <Link href={`/app/bill/${bill.id}`}>
                  <div className="group flex items-center gap-4 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/30">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Receipt className="h-5 w-5" />
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
        </div>
      </motion.div>
    </div>
  );
}
