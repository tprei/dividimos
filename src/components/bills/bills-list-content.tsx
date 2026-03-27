"use client";

import { motion } from "framer-motion";
import { Loader2, Receipt, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { SwipeableBillCard } from "@/components/bill/swipeable-bill-card";
import { EmptyState } from "@/components/shared/empty-state";
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
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/lib/currency";
import { deleteDraftFromSupabase } from "@/lib/supabase/delete-draft";
import { useUser } from "@/hooks/use-auth";
import type { BillStatus } from "@/types";

interface BillEntry {
  id: string;
  title: string;
  date: string;
  total: number;
  participants: number;
  status: BillStatus;
  creatorId: string;
}

const statusConfig: Record<BillStatus, { label: string; color: string }> = {
  draft: { label: "Rascunho", color: "bg-muted text-muted-foreground" },
  active: { label: "Pendente", color: "bg-warning/15 text-warning-foreground" },
  partially_settled: { label: "Parcial", color: "bg-primary/15 text-primary" },
  settled: { label: "Liquidado", color: "bg-success/15 text-success" },
};

type FilterType = "all" | BillStatus;

const filters: { key: FilterType; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "active", label: "Pendentes" },
  { key: "partially_settled", label: "Parciais" },
  { key: "settled", label: "Liquidadas" },
];

interface BillsListContentProps {
  initialBills: BillEntry[];
}

export function BillsListContent({ initialBills }: BillsListContentProps) {
  const router = useRouter();
  const user = useUser();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [bills, setBills] = useState<BillEntry[]>(initialBills);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const result = await deleteDraftFromSupabase(deleteTarget);
    if (!result.error) {
      setBills((prev) => prev.filter((b) => b.id !== deleteTarget));
    }
    setDeleting(false);
    setDeleteTarget(null);
  };

  const filtered = bills.filter((bill) => {
    const matchesSearch = bill.title.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === "all" || bill.status === filter;
    return matchesSearch && matchesFilter;
  });

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
              </SwipeableBillCard>
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
