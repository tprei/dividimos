"use client";

import { motion } from "framer-motion";
import { Loader2, Receipt, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useShallow } from "zustand/react/shallow";
import { SwipeableBillCard } from "@/components/bill/swipeable-bill-card";
import { EmptyState } from "@/components/shared/empty-state";
import { BillCardSkeleton } from "@/components/shared/skeleton";
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
import { staggerContainer, staggerItem } from "@/lib/animations";
import { formatBRL } from "@/lib/currency";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { deleteExpense } from "@/lib/sync/mutations";
import { useMe } from "@/hooks/use-me";
import { useAppStore } from "@/stores/app-store";
import type { GroupSnapshot } from "@/types/ledger";

interface BillRow {
  id: string;
  title: string;
  merchantName: string | null;
  occurredOn: string;
  createdAt: string;
  totalCents: number;
  deleted: boolean;
  groupName: string;
}

function formatOccurredOn(occurredOn: string): string {
  const [year, month, day] = occurredOn.split("-");
  if (!year || !month || !day) return occurredOn;
  return `${day}/${month}/${year}`;
}

function groupNameOf(snapshot: GroupSnapshot | undefined, meId: string): string {
  if (!snapshot) return "";
  if (snapshot.group.kind === "dm") {
    const other = snapshot.members.find((m) => m.userId !== meId);
    if (other) return other.user.name;
  }
  return snapshot.group.name;
}

export function BillsListContent() {
  const me = useMe();
  const { hydrated, expenses, groups } = useAppStore(
    useShallow((s) => ({
      hydrated: s.hydrated,
      expenses: s.expenses,
      groups: s.groups,
    })),
  );
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const bills = useMemo<BillRow[]>(() => {
    if (!me) return [];
    return Object.values(expenses)
      .map((e) => ({
        id: e.id,
        title: e.title,
        merchantName: e.merchantName,
        occurredOn: e.occurredOn,
        createdAt: e.createdAt,
        totalCents: e.totalCents,
        deleted: e.status === "deleted",
        groupName: groupNameOf(groups[e.groupId], me.id),
      }))
      .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.createdAt.localeCompare(a.createdAt));
  }, [expenses, groups, me]);

  const filtered = bills.filter((bill) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return (
      bill.title.toLowerCase().includes(query) ||
      (bill.merchantName?.toLowerCase().includes(query) ?? false)
    );
  });

  if (!hydrated || !me) {
    return (
      <div className="mx-auto max-w-lg space-y-6 px-4 py-6">
        {[1, 2, 3].map((i) => (
          <BillCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteExpense(deleteTarget);
      setDeleteTarget(null);
    } catch (error) {
      toast.error(ledgerErrorMessage(error));
    } finally {
      setDeleting(false);
    }
  };

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
            placeholder="Buscar por título ou estabelecimento..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </motion.div>

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="mt-6 space-y-3"
      >
        {filtered.map((bill) => (
          <motion.div key={bill.id} variants={staggerItem}>
            <SwipeableBillCard enabled={!bill.deleted} onDelete={() => setDeleteTarget(bill.id)}>
              <Link href={`/app/bill/${bill.id}`}>
                <div className="group flex items-center gap-4 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/30">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
                    <Receipt className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{bill.title}</p>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{formatOccurredOn(bill.occurredOn)}</span>
                      <span>·</span>
                      <span className="truncate">{bill.groupName}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold tabular-nums">{formatBRL(bill.totalCents)}</p>
                    {bill.deleted && (
                      <span className="mt-0.5 inline-block rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-medium text-destructive">
                        Excluída
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            </SwipeableBillCard>
          </motion.div>
        ))}

        {filtered.length === 0 && (
          <EmptyState
            icon={Receipt}
            title="Nenhuma conta por aqui"
            description={
              search
                ? `Sem resultados para "${search}".`
                : "Cria uma conta pra rachar com a galera."
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
            <DialogTitle>Excluir conta?</DialogTitle>
            <DialogDescription>Essa ação não tem volta.</DialogDescription>
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
