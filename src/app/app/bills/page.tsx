"use client";

import { motion } from "framer-motion";
import { Receipt, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton } from "@/components/shared/skeleton";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/lib/currency";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { BillStatus } from "@/types";

interface BillEntry {
  id: string;
  title: string;
  date: string;
  total: number;
  participants: number;
  status: BillStatus;
}

const statusConfig: Record<BillStatus, { label: string; color: string }> = {
  draft: { label: "Rascunho", color: "bg-muted text-muted-foreground" },
  active: { label: "Pendente", color: "bg-warning/15 text-warning-foreground" },
  partially_settled: { label: "Parcial", color: "bg-primary/15 text-primary" },
  settled: { label: "Liquidado", color: "bg-success/15 text-success" },
};

type FilterType = "all" | BillStatus;

export default function BillsPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [bills, setBills] = useState<BillEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const supabase = createClient();

    async function fetchBills() {
      const { data } = await supabase
        .from("bills")
        .select("id, title, status, total_amount, created_at")
        .order("created_at", { ascending: false });

      if (data && data.length > 0) {
        const billIds = data.map((b) => b.id);
        const { data: participantRows } = await supabase
          .from("bill_participants")
          .select("bill_id")
          .in("bill_id", billIds);

        const countMap = new Map<string, number>();
        for (const row of participantRows ?? []) {
          countMap.set(row.bill_id, (countMap.get(row.bill_id) ?? 0) + 1);
        }

        setBills(
          data.map((bill) => ({
            id: bill.id,
            title: bill.title,
            date: new Date(bill.created_at).toLocaleDateString("pt-BR", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            }),
            total: bill.total_amount,
            participants: countMap.get(bill.id) ?? 0,
            status: bill.status,
          })),
        );
      }
      setLoading(false);
    }

    fetchBills();
  }, [user]);

  const filtered = bills.filter((bill) => {
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

  if (loading) {
    return (
      <div className="mx-auto max-w-lg px-4 py-6 space-y-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-2xl" />
        <Skeleton className="h-20 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-2xl font-bold">Suas contas</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {bills.length} conta{bills.length !== 1 ? "s" : ""} no total
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
