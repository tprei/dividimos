"use client";

import { motion } from "framer-motion";
import { ArrowLeft, CheckCircle2, Clock, Zap } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Money } from "@/components/shared/money";
import { EmptyState } from "@/components/shared/empty-state";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { loadVendorCharges } from "@/lib/sync/refresh";
import { retryPendingVendorChargeCancellations } from "@/lib/sync/mutations-group";
import toast from "react-hot-toast";
import { LedgerError, ledgerErrorMessage } from "@/lib/sync/errors";
import { SyncErrorState } from "@/components/shared/sync-error-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/shared/skeleton";
import { CHARGES_READ_KEY, IDLE_READ, useAppStore } from "@/stores/app-store";

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `${diffMin}min atrás`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h atrás`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "ontem";
  if (diffDays < 7) return `${diffDays} dias atrás`;

  return new Date(dateStr).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
}

function ChargeHistorySkeleton() {
  return (
    <div className="mt-8 space-y-3" aria-label="Carregando cobranças">
      {[1, 2, 3].map((item) => (
        <div key={item} className="rounded-xl border bg-card p-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-4 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

export interface ChargeHistoryListProps {
  embedded?: boolean;
}

export function ChargeHistoryList({ embedded = false }: ChargeHistoryListProps = {}) {
  const charges = useAppStore((state) => state.vendorCharges);
  const summary = useAppStore((state) => state.chargeSummary);
  const read = useAppStore((state) => state.reads[CHARGES_READ_KEY] ?? IDLE_READ);
  const [loadingMore, setLoadingMore] = useState(false);
  const load = useCallback(async () => {
    await retryPendingVendorChargeCancellations();
    await loadVendorCharges();
  }, []);

  useEffect(() => {
    void load().catch(() => {
      // The store records the failure; the retry control renders it.
    });
  }, [load]);
  const handleLoadMore = useCallback(async () => {
    const cursor = useAppStore.getState().chargeSummary.cursor;
    if (cursor === null || loadingMore) return;
    setLoadingMore(true);
    try {
      await loadVendorCharges(cursor);
    } catch (error) {
      toast.error(ledgerErrorMessage(error));
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore]);

  // Totals come from the server: summing the loaded page would undercount and
  // a local midnight would use the device's timezone instead of Sao Paulo's.
  const total = summary.receivedTodayCents ?? 0;
  const receivedCount = summary.receivedCount ?? 0;
  const chargeCount = summary.total ?? charges.length;
  const isInitialLoad =
    charges.length === 0 && summary.total === null && !summary.complete && (read.status === "idle" || read.status === "loading");
  return (
    <div className={embedded ? "mt-5" : "mx-auto max-w-lg px-4 py-6"}>
      {!embedded && (
        <div className="flex items-center gap-3">
          <Link
            href="/app"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-xl font-bold">Cobranças recebidas</h1>
        </div>
      )}

      {!isInitialLoad && total > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 rounded-2xl bg-success/10 p-4"
        >
          <p className="text-sm text-success-text">Recebido hoje</p>
          <Money cents={total} size="lg" tone="positive" />
        </motion.div>
      )}

      {isInitialLoad ? (
        <ChargeHistorySkeleton />
      ) : charges.length === 0 && read.status === "error" ? (
        <SyncErrorState
          message={ledgerErrorMessage(new LedgerError(read.code))}
          onRetry={load}
        />
      ) : charges.length === 0 ? (
        <EmptyState icon={Zap} title="Nenhuma cobrança ainda" description="Seus recebimentos por Pix ficam aqui." actionLabel="Ir para início" onAction={() => { window.location.href = "/app"; }} />
      ) : (
        <>
          <p className="mt-4 text-sm text-muted-foreground">
            {receivedCount} recebida{receivedCount !== 1 ? "s" : ""} de{" "}
            {chargeCount} cobrança{chargeCount !== 1 ? "s" : ""}
          </p>
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
            className="mt-3 space-y-2"
          >
            {charges.map((charge, index) => (
              <motion.div
                key={charge.id}
                variants={index < 6 ? staggerItem : undefined}
                className="flex items-center gap-3 rounded-xl border bg-card p-3"
              >
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-full ${
                    charge.status === "received"
                      ? "bg-success/10 text-success"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {charge.status === "received" ? (
                    <CheckCircle2 className="h-4.5 w-4.5" />
                  ) : (
                    <Clock className="h-4.5 w-4.5" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <Money cents={charge.amountCents} size="sm" />
                  {charge.description && (
                    <p className="text-xs text-muted-foreground truncate">
                      {charge.description}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <span
                    className={`text-xs font-semibold ${
                      charge.status === "received"
                        ? "text-success-text"
                        : "text-muted-foreground"
                    }`}
                  >
                    {charge.status === "received" ? "Recebido" : "Pendente"}
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {formatRelativeTime(charge.createdAt)}
                  </p>
                </div>
              </motion.div>
            ))}
          </motion.div>
          {!summary.complete && summary.cursor !== null && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="mt-3 w-full"
            >
              {loadingMore ? "Carregando..." : "Carregar mais"}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
