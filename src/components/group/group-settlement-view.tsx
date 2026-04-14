"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Bell, CheckCheck, Info, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { DebtGraph } from "@/components/settlement/debt-graph";
import { SimplificationViewer } from "@/components/settlement/simplification-viewer";
import dynamic from "next/dynamic";
import { ModalLoadingSkeleton } from "@/components/shared/skeleton";
const PixQrModal = dynamic(
  () => import("@/components/settlement/pix-qr-modal").then((m) => ({ default: m.PixQrModal })),
  { ssr: false, loading: () => <ModalLoadingSkeleton /> },
);
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatBRL } from "@/lib/currency";
import { consolidateEdges, simplifyDebts } from "@/lib/simplify";
import type { DebtEdge } from "@/lib/simplify";
import {
  queryBalances,
  recordSettlement,
} from "@/lib/supabase/settlement-actions";
import { notifySettlementRecorded, notifyPaymentNudge } from "@/lib/push/push-notify";
import { useRealtimeBalances } from "@/hooks/use-realtime-balances";
import { createClient } from "@/lib/supabase/client";
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
  const [resolvedParticipants, setResolvedParticipants] = useState<User[]>(participants);
  const [simplificationResult, setSimplificationResult] = useState<SimplificationResult | null>(null);
  const [showSimplificationViewer, setShowSimplificationViewer] = useState(false);
  const [pixModal, setPixModal] = useState<{
    recipientId: string;
    recipientName: string;
    amountCents: number;
    mode: "pay" | "collect";
  } | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [nudgeSent, setNudgeSent] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    const stored = localStorage.getItem("nudge-cooldowns");
    if (!stored) return new Set();
    try {
      const parsed = JSON.parse(stored) as Record<string, number>;
      const now = Date.now();
      const active = new Set<string>();
      for (const [key, ts] of Object.entries(parsed)) {
        if (now - ts < 24 * 60 * 60 * 1000) active.add(key);
      }
      return active;
    } catch { return new Set(); }
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    const loadedBalances = await queryBalances(groupId);

    const balanceUserIds = new Set<string>();
    for (const b of loadedBalances) {
      balanceUserIds.add(b.userA);
      balanceUserIds.add(b.userB);
    }

    const knownIds = new Set(participants.map((p) => p.id));
    const missingIds = [...balanceUserIds].filter((id) => !knownIds.has(id));

    let allParticipants = participants;

    if (missingIds.length > 0) {
      const supabase = createClient();
      const { data: profiles } = await supabase
        .from("user_profiles")
        .select("id, handle, name, avatar_url")
        .in("id", missingIds);

      const extra: User[] = [];
      const fetched = new Set<string>();

      for (const p of profiles ?? []) {
        fetched.add(p.id);
        extra.push({
          id: p.id,
          name: p.name,
          handle: p.handle,
          email: "",
          pixKeyType: "email" as const,
          pixKeyHint: "",
          avatarUrl: p.avatar_url ?? undefined,
          onboarded: true,
          createdAt: "",
        });
      }

      for (const id of missingIds) {
        if (!fetched.has(id)) {
          extra.push({
            id,
            name: "Membro removido",
            handle: "",
            email: "",
            pixKeyType: "email" as const,
            pixKeyHint: "",
            onboarded: false,
            createdAt: "",
          });
        }
      }

      allParticipants = [...participants, ...extra];
    }

    setResolvedParticipants(allParticipants);
    setBalances(loadedBalances);

    const rawEdges = balancesToEdges(loadedBalances);
    if (rawEdges.length >= 2 && allParticipants.length >= 3) {
      setSimplificationResult(simplifyDebts(consolidateEdges(rawEdges), allParticipants));
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
      if (rawEdges.length >= 2 && resolvedParticipants.length >= 3) {
        setSimplificationResult(simplifyDebts(consolidateEdges(rawEdges), resolvedParticipants));
      } else {
        setSimplificationResult(null);
      }

      return filtered;
    });
  }, [resolvedParticipants]));

  const debtEdges = balancesToEdges(balances);
  const displayEdges = simplificationResult?.simplifiedEdges ?? debtEdges;

  const getParticipant = (id: string) =>
    resolvedParticipants.find((p) => p.id === id) ?? {
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
    notifySettlementRecorded(groupId, fromUserId, toUserId, amountCents).catch(() => {});
    setActing(null);
  }

  async function handleNudge(debtorId: string, amountCents: number) {
    const key = `${groupId}-${debtorId}`;
    if (nudgeSent.has(key)) return;

    // Optimistically mark as sent so repeated taps are ignored immediately.
    const next = new Set(nudgeSent);
    next.add(key);
    setNudgeSent(next);

    const stored = localStorage.getItem("nudge-cooldowns");
    const parsed: Record<string, number> = stored ? JSON.parse(stored) : {};
    parsed[key] = Date.now();
    localStorage.setItem("nudge-cooldowns", JSON.stringify(parsed));

    const debtorName = getParticipant(debtorId).name;
    const toastId = toast.loading(`Enviando lembrete…`);
    try {
      await notifyPaymentNudge(groupId, debtorId, amountCents);
      toast.success(`Lembrete enviado para ${debtorName}`, { id: toastId });
    } catch {
      toast.error("Erro ao enviar lembrete", { id: toastId });
      // Roll back the optimistic lockout so they can retry
      const rollback = new Set(next);
      rollback.delete(key);
      setNudgeSent(rollback);
      delete parsed[key];
      localStorage.setItem("nudge-cooldowns", JSON.stringify(parsed));
    }
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
      <div className="flex flex-col items-center py-12 text-center">
        <div className="rounded-2xl bg-success/10 p-3">
          <CheckCheck className="h-8 w-8 text-success" />
        </div>
        <p className="mt-3 text-base font-semibold text-foreground">Tudo liquidado!</p>
        <p className="mt-1 max-w-[240px] text-sm text-muted-foreground">
          Nenhuma dívida pendente no grupo. Quando uma conta for ativada, os saldos aparecem aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Net balance summary */}
      <div className="rounded-2xl border bg-card p-4">
        <h3 className="text-sm font-semibold mb-3">Saldo consolidado</h3>
        <div className="space-y-2">
          {resolvedParticipants.map((p) => {
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
          <DebtGraph participants={resolvedParticipants} edges={displayEdges} />
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
                      {isDebtor ? "Você deve" : isCreditor ? "Você recebe" : "Pendente"}
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
                    <>
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
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleNudge(edge.fromUserId, edge.amountCents)}
                        disabled={isActing || nudgeSent.has(`${groupId}-${edge.fromUserId}`)}
                        title={nudgeSent.has(`${groupId}-${edge.fromUserId}`) ? "Lembrete já enviado" : "Enviar lembrete"}
                      >
                        <Bell className="h-4 w-4" />
                      </Button>
                    </>
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
        <Dialog open={showSimplificationViewer} onOpenChange={setShowSimplificationViewer}>
          <DialogContent className="max-w-lg max-h-[85dvh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Simplificacao passo a passo</DialogTitle>
            </DialogHeader>
            <SimplificationViewer
              result={simplificationResult}
              participants={resolvedParticipants}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* Pix QR modal */}
      {pixModal && (
        <PixQrModal
          open
          onClose={() => setPixModal(null)}
          recipientName={pixModal.recipientName}
          amountCents={pixModal.amountCents}
          recipientUserId={pixModal.mode === "collect" ? currentUserId : pixModal.recipientId}
          groupId={groupId}
          mode={pixModal.mode}
          onMarkPaid={async (amountCents: number) => {
            if (pixModal.mode === "collect") {
              await handleRecordSettlement(pixModal.recipientId, currentUserId, amountCents);
            } else {
              await handleRecordSettlement(currentUserId, pixModal.recipientId, amountCents);
            }
          }}
          onSettlementComplete={() => {
            setPixModal(null);
            window.dispatchEvent(new CustomEvent("app-refresh"));
          }}
        />
      )}
    </div>
  );
}
