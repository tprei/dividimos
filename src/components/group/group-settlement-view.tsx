"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CheckCheck, Info, Loader2 } from "lucide-react";
import { DebtGraph } from "@/components/settlement/debt-graph";
import { SimplificationViewer } from "@/components/settlement/simplification-viewer";
import dynamic from "next/dynamic";
const PixQrModal = dynamic(
  () => import("@/components/settlement/pix-qr-modal").then((m) => ({ default: m.PixQrModal })),
  { ssr: false },
);
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatBRL } from "@/lib/currency";
import { consolidateEdges, simplifyDebts } from "@/lib/simplify";
import type { DebtEdge } from "@/lib/simplify";
import {
  queryBalances,
  recordSettlement,
} from "@/lib/supabase/settlement-actions";
import { useRealtimeBalances } from "@/hooks/use-realtime-balances";
import type { Balance, User } from "@/types";
import type { SimplificationResult } from "@/lib/simplify";

interface GroupSettlementViewProps {
  groupId: string;
  participants: User[];
  currentUserId: string;
}

/**
 * Convert Balance[] (canonical userA < userB ordering) to directed DebtEdge[].
 * Positive amountCents = userA owes userB.
 * Negative amountCents = userB owes userA.
 */
function balancesToEdges(balances: Balance[]): DebtEdge[] {
  const edges: DebtEdge[] = [];
  for (const b of balances) {
    if (b.amountCents > 0) {
      edges.push({ fromUserId: b.userA, toUserId: b.userB, amountCents: b.amountCents });
    } else if (b.amountCents < 0) {
      edges.push({ fromUserId: b.userB, toUserId: b.userA, amountCents: Math.abs(b.amountCents) });
    }
  }
  return edges;
}

export function GroupSettlementView({
  groupId,
  participants,
  currentUserId,
}: GroupSettlementViewProps) {
  const [loading, setLoading] = useState(true);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [simplificationResult, setSimplificationResult] = useState<SimplificationResult | null>(null);
  const [showSimplificationViewer, setShowSimplificationViewer] = useState(false);
  const [pixModal, setPixModal] = useState<{
    recipientId: string;
    recipientName: string;
    amountCents: number;
    mode: "pay" | "collect";
  } | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const loadedBalances = await queryBalances(groupId);

    setBalances(loadedBalances);

    const rawEdges = balancesToEdges(loadedBalances);
    if (rawEdges.length >= 2 && participants.length >= 3) {
      setSimplificationResult(simplifyDebts(consolidateEdges(rawEdges), participants));
    } else {
      setSimplificationResult(null);
    }

    setLoading(false);
  }, [groupId, participants]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const handleRefresh = () => loadData();
    window.addEventListener("app-refresh", handleRefresh);
    return () => window.removeEventListener("app-refresh", handleRefresh);
  }, [loadData]);

  // Realtime: patch balances locally
  useRealtimeBalances(groupId, useCallback((updatedBalance: Balance) => {
    setBalances((prev) => {
      const idx = prev.findIndex(
        (b) => b.userA === updatedBalance.userA && b.userB === updatedBalance.userB,
      );
      const next = idx >= 0
        ? prev.map((b, i) => (i === idx ? updatedBalance : b))
        : [...prev, updatedBalance];

      // Filter out zero balances
      const filtered = next.filter((b) => b.amountCents !== 0);

      // Recompute simplification
      const rawEdges = balancesToEdges(filtered);
      if (rawEdges.length >= 2 && participants.length >= 3) {
        setSimplificationResult(simplifyDebts(consolidateEdges(rawEdges), participants));
      } else {
        setSimplificationResult(null);
      }

      return filtered;
    });
  }, [participants]));

  const debtEdges = balancesToEdges(balances);
  const displayEdges = simplificationResult?.simplifiedEdges ?? debtEdges;

  const getParticipant = (id: string) =>
    participants.find((p) => p.id === id) ?? {
      id,
      name: "?",
      handle: "",
      email: "",
      pixKeyType: "email" as const,
      pixKeyHint: "",
      onboarded: false,
      createdAt: "",
    };

  // Compute per-user net balance from debt edges
  const userNetBalances = new Map<string, number>();
  for (const edge of debtEdges) {
    userNetBalances.set(edge.fromUserId, (userNetBalances.get(edge.fromUserId) ?? 0) - edge.amountCents);
    userNetBalances.set(edge.toUserId, (userNetBalances.get(edge.toUserId) ?? 0) + edge.amountCents);
  }

  async function handleRecordSettlement(
    fromUserId: string,
    toUserId: string,
    amountCents: number,
  ) {
    setActing(`${fromUserId}-${toUserId}`);
    await recordSettlement(groupId, fromUserId, toUserId, amountCents);
    setPixModal(null);
    setActing(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (debtEdges.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        <CheckCheck className="mx-auto h-10 w-10 opacity-40 text-success" />
        <p className="mt-3 font-medium text-foreground">Tudo liquidado!</p>
        <p className="text-sm mt-1">Nenhuma divida pendente no grupo</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Net balance summary */}
      <div className="rounded-2xl border bg-card p-4">
        <h3 className="text-sm font-semibold mb-3">Saldo consolidado</h3>
        <div className="space-y-2">
          {participants.map((p) => {
            const net = userNetBalances.get(p.id) ?? 0;
            if (Math.abs(net) < 2) return null;
            return (
              <div key={p.id} className="flex items-center gap-3">
                <UserAvatar name={p.name} avatarUrl={p.avatarUrl} size="xs" />
                <span className="flex-1 text-sm font-medium">{p.name.split(" ")[0]}</span>
                <span className={`text-sm font-semibold tabular-nums ${net > 0 ? "text-success" : "text-destructive"}`}>
                  {net > 0 ? "+" : ""}{formatBRL(Math.abs(net))}
                </span>
                <span className="text-xs text-muted-foreground">
                  {net > 0 ? "a receber" : "a pagar"}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Debt graph */}
      {displayEdges.length > 0 && (
        <div className="rounded-2xl border bg-card overflow-hidden">
          <DebtGraph participants={participants} edges={displayEdges} />
        </div>
      )}

      {simplificationResult && simplificationResult.steps.length > 0 && (
        <button
          onClick={() => setShowSimplificationViewer(true)}
          className="flex w-full items-center gap-2 rounded-xl border bg-card px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/30"
        >
          <Info className="h-4 w-4 shrink-0" />
          <span>
            {simplificationResult.originalCount} transacoes simplificadas para {simplificationResult.simplifiedCount}
          </span>
        </button>
      )}

      {/* Debt cards (balance-derived — who owes whom) */}
      {displayEdges.length > 0 && (
        <div className="space-y-3">
          {displayEdges.map((edge) => {
            const from = getParticipant(edge.fromUserId);
            const to = getParticipant(edge.toUserId);
            const isDebtor = edge.fromUserId === currentUserId;
            const isCreditor = edge.toUserId === currentUserId;
            const edgeKey = `${edge.fromUserId}-${edge.toUserId}`;
            const isActing = acting === edgeKey;

            return (
              <motion.div
                key={edgeKey}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border bg-card p-4"
              >
                <div className="flex items-center gap-3 mb-3">
                  <UserAvatar name={from.name} avatarUrl={from.avatarUrl} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">
                      {from.name.split(" ")[0]} → {to.name.split(" ")[0]}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {isDebtor ? "Voce deve" : isCreditor ? "Voce recebe" : "Pendente"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold tabular-nums text-sm">{formatBRL(edge.amountCents)}</p>
                  </div>
                </div>

                <div className="flex gap-2">
                  {isDebtor && (
                    <Button
                      className="flex-1"
                      size="sm"
                      onClick={() =>
                        setPixModal({
                          recipientId: edge.toUserId,
                          recipientName: to.name,
                          amountCents: edge.amountCents,
                          mode: "pay",
                        })
                      }
                      disabled={isActing}
                    >
                      Pagar via Pix
                    </Button>
                  )}

                  {isCreditor && (
                    <Button
                      variant="outline"
                      className="flex-1"
                      size="sm"
                      onClick={() =>
                        setPixModal({
                          recipientId: edge.fromUserId,
                          recipientName: from.name,
                          amountCents: edge.amountCents,
                          mode: "collect",
                        })
                      }
                      disabled={isActing}
                    >
                      Gerar cobranca
                    </Button>
                  )}

                  {!isDebtor && !isCreditor && (
                    <div className="flex-1 text-center text-xs text-muted-foreground py-2">
                      Aguardando pagamento
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Simplification viewer */}
      {simplificationResult && (
        <Sheet open={showSimplificationViewer} onOpenChange={setShowSimplificationViewer}>
          <SheetContent side="bottom" className="h-[100dvh] overflow-y-auto rounded-t-3xl">
            <SheetHeader>
              <SheetTitle>Simplificacao passo a passo</SheetTitle>
            </SheetHeader>
            <div className="mt-4 pb-8">
              <SimplificationViewer
                result={simplificationResult}
                participants={participants}
              />
            </div>
          </SheetContent>
        </Sheet>
      )}

      {/* Pix QR modal */}
      {pixModal && (
        <PixQrModal
          open
          onClose={() => setPixModal(null)}
          recipientName={pixModal.recipientName}
          amountCents={pixModal.amountCents}
          recipientUserId={pixModal.recipientId}
          groupId={groupId}
          mode={pixModal.mode}
          onMarkPaid={async (amountCents: number) => {
            if (pixModal.mode === "collect") {
              // Creditor recording: debtor=recipientId, creditor=currentUserId
              await handleRecordSettlement(pixModal.recipientId, currentUserId, amountCents);
            } else {
              // Debtor recording: debtor=currentUserId, creditor=recipientId
              await handleRecordSettlement(currentUserId, pixModal.recipientId, amountCents);
            }
          }}
        />
      )}
    </div>
  );
}
