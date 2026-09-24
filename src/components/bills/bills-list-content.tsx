"use client";

import { motion } from "framer-motion";
import { Loader2, Receipt, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { SwipeableBillCard } from "@/components/bill/swipeable-bill-card";
import { ChargeHistoryList } from "@/components/dashboard/charge-history-list";
import { EmptyState } from "@/components/shared/empty-state";
import { BillCardSkeleton } from "@/components/shared/skeleton";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ListRow } from "@/components/ui/list-row";
import { SectionCard } from "@/components/ui/section-card";
import { Money } from "@/components/shared/money";
import { GroupAvatar } from "@/components/shared/group-avatar";
import { haptics } from "@/hooks/use-haptics";
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
import { LedgerError, ledgerErrorMessage } from "@/lib/sync/errors";
import { loadMyExpenses } from "@/lib/sync/refresh";
import { SyncErrorState } from "@/components/shared/sync-error-state";
import { deleteExpense } from "@/lib/sync/mutations";
import { useMe } from "@/hooks/use-me";
import { IDLE_READ, MY_EXPENSES_READ_KEY, useAppStore } from "@/stores/app-store";
import { formatOccurredOn, selectMyExpenseRows } from "@/stores/app-selectors";

function BillAvatar({ id, name }: { id: string; name: string }) {
  const groupId = useAppStore((s) => s.expenses[id]?.groupId);
  const avatar = useAppStore((s) => groupId ? s.groups[groupId]?.overview?.avatar : undefined);
  return <GroupAvatar name={name} groupId={groupId ?? id} avatar={avatar} size="sm" />;
}

function BillAmount({ id }: { id: string }) {
  const expense = useAppStore((s) => s.expenses[id]);
  if (!expense) return null;
  return (
    <span className="flex flex-col items-end text-right">
      <span className="text-sm font-semibold leading-5 text-foreground">
        <Money cents={expense.totalCents} size="sm" />
      </span>
      <span className="text-xs leading-4 text-muted-foreground">
        {expense.status === "deleted" ? (
          "Excluída"
        ) : (
          <>
            Sua parte <Money cents={expense.myShareCents} className="text-xs" tone={expense.myPaidCents >= expense.myShareCents ? "positive" : "negative"} />
          </>
        )}
      </span>
    </span>
  );
}

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
      haptics.error();
    } catch (error) {
      toast.error(ledgerErrorMessage(error));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg px-4 pb-6 md:max-w-2xl">
      <SegmentedControl
        aria-label="Tipo de histórico"
        value={tab}
        onChange={(value) => setTab(value === "contas" ? "contas" : "cobrancas")}
        options={[{ value: "contas", label: "Contas" }, { value: "cobrancas", label: "Cobranças" }]}
      />
      {tab === "contas" && myExpenses.total !== null && <p className="mt-3 text-sm text-muted-foreground">{myExpenses.total} conta{myExpenses.total === 1 ? "" : "s"} no total</p>}

      <div
        aria-label="Contas"
        hidden={tab !== "contas"}
      >
        {tab === "contas" && (
          <>
            <div className="mt-6">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Buscar contas"
                  placeholder="Buscar contas"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 pr-12"
                />
                {search && <Button variant="ghost" size="icon" aria-label="Limpar busca" className="absolute right-0 top-0" onClick={() => setSearch("")}><X className="size-4" /></Button>}
              </div>
            </div>

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
                      : `Sem resultados para "${search}" nas contas carregadas.`
                    : "As contas divididas ficam aqui."
                }
                actionLabel={query ? undefined : "Nova conta"}
                onAction={query ? undefined : () => router.push("/app/bill/new")}
              />
            ) : (
              <motion.div
                variants={staggerContainer}
                initial="hidden"
                animate="visible"
                className="mt-6 space-y-4"
              >
                <SectionCard className="divide-y divide-border">
                  {filtered.map((bill, index) => (
                    <motion.div key={bill.id} variants={index < 6 ? staggerItem : undefined}>
                      <SwipeableBillCard enabled={!bill.deleted} onDelete={() => setDeleteTarget(bill.id)}>
                        <ListRow
                          href={`/app/bill/${bill.id}`}
                          leading={<BillAvatar name={bill.groupName} id={bill.id} />}
                          title={bill.title}
                          subtitle={`${formatOccurredOn(bill.occurredOn)} · ${bill.groupName}`}
                          trailing={<BillAmount id={bill.id} />}
                        />
                      </SwipeableBillCard>
                    </motion.div>
                  ))}
                </SectionCard>

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
            )}
          </>
        )}
      </div>

      <div
        aria-label="Cobranças"
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
            <DialogDescription>A conta sai dos saldos. Você pode restaurá-la pelo histórico.</DialogDescription>
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
