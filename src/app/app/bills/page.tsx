"use client";

import { motion } from "framer-motion";
import { Receipt, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/lib/currency";
import type { BillStatus } from "@/types";

interface BillEntry {
  id: string;
  title: string;
  date: string;
  total: number;
  participants: number;
  status: BillStatus;
  settledCount: number;
  totalDebts: number;
}

const allBills: BillEntry[] = [
  {
    id: "1",
    title: "Churrascaria Fogo de Chao",
    date: "23 Mar 2026",
    total: 34500,
    participants: 4,
    status: "active",
    settledCount: 1,
    totalDebts: 3,
  },
  {
    id: "2",
    title: "Bar do Zeca",
    date: "22 Mar 2026",
    total: 18700,
    participants: 3,
    status: "settled",
    settledCount: 2,
    totalDebts: 2,
  },
  {
    id: "3",
    title: "Padaria Brasileira",
    date: "20 Mar 2026",
    total: 6400,
    participants: 2,
    status: "partially_settled",
    settledCount: 0,
    totalDebts: 1,
  },
  {
    id: "4",
    title: "Restaurante Sakura",
    date: "15 Mar 2026",
    total: 42300,
    participants: 5,
    status: "settled",
    settledCount: 4,
    totalDebts: 4,
  },
  {
    id: "5",
    title: "Pizza da Maria",
    date: "12 Mar 2026",
    total: 11200,
    participants: 2,
    status: "settled",
    settledCount: 1,
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
  size = 42,
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

type FilterType = "all" | BillStatus;

export default function BillsPage() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");

  const filtered = allBills.filter((bill) => {
    const matchesSearch = bill.title
      .toLowerCase()
      .includes(search.toLowerCase());
    const matchesFilter = filter === "all" || bill.status === filter;
    return matchesSearch && matchesFilter;
  });

  const filters: { key: FilterType; label: string }[] = [
    { key: "all", label: "Todas" },
    { key: "active", label: "Pendentes" },
    { key: "partially_settled", label: "Parciais" },
    { key: "settled", label: "Liquidadas" },
  ];

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-2xl font-bold">Contas</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {allBills.length} contas no total
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05, duration: 0.4 }}
        className="mt-5"
      >
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar conta..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.4 }}
        className="mt-3 flex gap-2 overflow-x-auto pb-1"
      >
        {filters.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={filter === f.key ? "default" : "outline"}
            onClick={() => setFilter(f.key)}
            className="shrink-0 text-xs"
          >
            {f.label}
          </Button>
        ))}
      </motion.div>

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="mt-6 space-y-3"
      >
        {filtered.map((bill) => {
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

        {filtered.length === 0 && (
          <EmptyState
            icon={Receipt}
            title="Nenhuma conta encontrada"
            description={
              search
                ? `Sem resultados para "${search}".`
                : "Crie sua primeira conta para dividir com amigos."
            }
            actionLabel={!search ? "Nova conta" : undefined}
            onAction={!search ? () => {} : undefined}
          />
        )}
      </motion.div>
    </div>
  );
}
