"use client";

import { motion } from "framer-motion";
import { ArrowLeft, CheckCircle2, Clock, Zap } from "lucide-react";
import Link from "next/link";
import { formatBRL } from "@/lib/currency";
import { staggerContainer, staggerItem } from "@/lib/animations";
import type { VendorCharge } from "@/types";

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

function todayTotal(charges: VendorCharge[]): number {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  return charges
    .filter(
      (c) =>
        c.status === "received" &&
        new Date(c.createdAt).getTime() >= todayStart.getTime(),
    )
    .reduce((sum, c) => sum + c.amountCents, 0);
}

interface ChargeHistoryListProps {
  initialCharges: VendorCharge[];
}

export function ChargeHistoryList({ initialCharges }: ChargeHistoryListProps) {
  const total = todayTotal(initialCharges);
  const receivedCount = initialCharges.filter(
    (c) => c.status === "received",
  ).length;

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <div className="flex items-center gap-3">
        <Link
          href="/app"
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-xl font-bold">Cobranças recebidas</h1>
      </div>

      {total > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 rounded-2xl bg-success/10 p-4"
        >
          <p className="text-sm text-success/70">Recebido hoje</p>
          <p className="text-2xl font-bold tabular-nums text-success">
            {formatBRL(total)}
          </p>
        </motion.div>
      )}

      {initialCharges.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-12 flex flex-col items-center text-center"
        >
          <div className="rounded-2xl bg-muted/50 p-4">
            <Zap className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="mt-4 text-sm font-semibold text-foreground">
            Nenhuma cobrança ainda
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Use o &quot;Cobrar rápido&quot; na tela inicial para gerar QR codes.
          </p>
        </motion.div>
      ) : (
        <>
          <p className="mt-4 text-sm text-muted-foreground">
            {receivedCount} recebida{receivedCount !== 1 ? "s" : ""} de{" "}
            {initialCharges.length} cobrança{initialCharges.length !== 1 ? "s" : ""}
          </p>
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
            className="mt-3 space-y-2"
          >
            {initialCharges.map((charge) => (
              <motion.div
                key={charge.id}
                variants={staggerItem}
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
                  <p className="text-sm font-semibold tabular-nums">
                    {formatBRL(charge.amountCents)}
                  </p>
                  {charge.description && (
                    <p className="text-xs text-muted-foreground truncate">
                      {charge.description}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <span
                    className={`text-[11px] font-medium ${
                      charge.status === "received"
                        ? "text-success"
                        : "text-muted-foreground"
                    }`}
                  >
                    {charge.status === "received" ? "Recebido" : "Pendente"}
                  </span>
                  <p className="text-[11px] text-muted-foreground">
                    {formatRelativeTime(charge.createdAt)}
                  </p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </>
      )}
    </div>
  );
}
