"use client";

import { motion } from "framer-motion";
import { Loader2, Receipt, Search, Zap } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { SwipeableBillCard } from "@/components/bill/swipeable-bill-card";
import { ChargeHistoryList } from "@/components/dashboard/charge-history-list";
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
import { LedgerError, ledgerErrorMessage } from "@/lib/sync/errors";
import { loadMyExpenses } from "@/lib/sync/refresh";
import { SyncErrorState } from "@/components/shared/sync-error-state";
import { deleteExpense } from "@/lib/sync/mutations";
import { useMe } from "@/hooks/use-me";
import { IDLE_READ, MY_EXPENSES_READ_KEY, useAppStore } from "@/stores/app-store";
import { selectMyExpenseRows } from "@/stores/app-selectors";
import { formatOccurredOn } from "@/components/dashboard/home-selectors";

export function BillsListContent() {
  const router = useRouter();
  const me = useMe();
  const hydrated = useAppStore((s) => s.hydrated);
  const bills = useAppStore(selectMyExpenseRows);
  const myExpenses = useAppStore((s) => s.myExpenses);
  const read = useAppStore((s) => s.reads[MY_EXPENSES_READ_KEY] ?? IDLE_READ);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"contas" | "cobrancas">("contas");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(() => {
    void loadMyExpenses().catch(() => {
      // Recorded as a failed read; the retry control renders it.
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleLoadMore = useCallback(async () => {
    const cursor = useAppStore.getState().myExpenses.cursor;
    if (cursor === null || loadingMore) return;
    setLoadingMore(true);
    try {
      await loadMyExpenses(cursor);
    } catch (error) {
      toast.error(ledgerErrorMessage(error));
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore]);

  const query = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      query
        ? bills.filter(
            (bill) =>
              bill.title.toLowerCase().includes(query) ||
              (bill.merchantName?.toLowerCase().includes(query) ?? false),
          )
        : bills,
    [bills, query],
  );

  // Cursor/total/complete record that a page was already read, so a cached
  // empty history renders as the empty state instead of flashing skeletons.
  const historyNeverLoaded =
    myExpenses.cursor === null && !myExpenses.complete && myExpenses.total === null;
  const readPending = read.status === "idle" || read.status === "loading";

  if (!hydrated || !me || (bills.length === 0 && readPending && historyNeverLoaded)) {
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
        {tab === "contas" && (
          <p className="mt-1 text-sm text-muted-foreground">
            {myExpenses.total === null
              ? `${bills.length} conta${bills.length !== 1 ? "s" : ""} carregada${bills.length !== 1 ? "s" : ""}`
              : `${myExpenses.total} conta${myExpenses.total !== 1 ? "s" : ""} no total`}
          </p>
        )}
      </motion.div>

      <div className="mt-5 grid grid-cols-2 gap-1 rounded-xl bg-muted p-1" role="tablist" aria-label="Tipo de histórico">
        <button
          type="button"
          role="tab"
          id="tab-contas"
          aria-selected={tab === "contas"}
          aria-controls="panel-contas"
          tabIndex={tab === "contas" ? 0 : -1}
          onClick={() => setTab("contas")}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
              e.preventDefault();
              setTab("cobrancas");
              document.getElementById("tab-cobrancas")?.focus();
            }
          }}
          className={`flex min-h-11 items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors ${tab === "contas" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
        >
          <Receipt className="size-4" />
          Contas
        </button>
        <button
          type="button"
          role="tab"
          id="tab-cobrancas"
          aria-selected={tab === "cobrancas"}
          aria-controls="panel-cobrancas"
          tabIndex={tab === "cobrancas" ? 0 : -1}
          onClick={() => setTab("cobrancas")}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
              e.preventDefault();
              setTab("contas");
              document.getElementById("tab-contas")?.focus();
            }
          }}
          className={`flex min-h-11 items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors ${tab === "cobrancas" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
        >
          <Zap className="size-4" />
          Cobranças
        </button>
      </div>

      <div
        role="tabpanel"
        id="panel-contas"
        aria-labelledby="tab-contas"
        hidden={tab !== "contas"}
      >
        {tab === "contas" && (
          <>
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

              {filtered.length === 0 && read.status === "error" && bills.length === 0 ? (
                <SyncErrorState
                  message={ledgerErrorMessage(new LedgerError(read.code))}
                  onRetry={load}
                />
              ) : filtered.length === 0 ? (
                <EmptyState
                  icon={Receipt}
                  title={query ? "Nenhum resultado" : "Nenhuma conta por aqui"}
                  description={
                    query
                      ? myExpenses.complete
                        ? `Sem resultados para "${search}".`
                        : `Sem resultados para "${search}" nas contas já carregadas. Carrega mais pra buscar no resto.`
                      : "Cria uma conta pra rachar com a galera."
                  }
                  actionLabel={query ? undefined : "Nova conta"}
                  onAction={query ? undefined : () => router.push("/app/bill/new")}
                />
              ) : null}

              {!myExpenses.complete && myExpenses.cursor !== null && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="w-full"
                >
                  {loadingMore ? "Carregando..." : "Carregar mais"}
                </Button>
              )}
            </motion.div>
          </>
        )}
      </div>

      <div
        role="tabpanel"
        id="panel-cobrancas"
        aria-labelledby="tab-cobrancas"
        hidden={tab !== "cobrancas"}
      >
        {tab === "cobrancas" && <ChargeHistoryList embedded />}
      </div>

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
