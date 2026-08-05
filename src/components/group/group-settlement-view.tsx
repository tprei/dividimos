"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Bell, CheckCheck } from "lucide-react";
import toast from "react-hot-toast";
import { DebtGraph } from "@/components/settlement/debt-graph";
import dynamic from "next/dynamic";
import { ModalLoadingSkeleton } from "@/components/shared/skeleton";
const PixQrModal = dynamic(
  () => import("@/components/settlement/pix-qr-modal").then((m) => ({ default: m.PixQrModal })),
  { ssr: false, loading: () => <ModalLoadingSkeleton /> },
);
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/currency";
import type { DebtEdge } from "@/lib/simplify";
import { notifyPaymentNudge } from "@/lib/push/push-notify";
import {
  settlementEdgeKey,
  useSettlementSubmission,
} from "@/contexts/settlement-submission-context";
import type { Balance, User } from "@/types";

interface GroupSettlementViewProps {
  groupId: string;
  balances: Balance[];
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
  balances,
  participants,
  currentUserId,
}: GroupSettlementViewProps) {
  const [pixModal, setPixModal] = useState<{
    recipientId: string;
    recipientName: string;
    amountCents: number;
    mode: "pay" | "collect";
  } | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const submission = useSettlementSubmission();
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

  const debtEdges = balancesToEdges(balances);

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
    const edgeKey = settlementEdgeKey({ groupId, fromUserId, toUserId });
    setActing(edgeKey);
    try {
      return await submission.submit([{
        groupId,
        fromUserId,
        toUserId,
        amountCents,
      }]);
    } finally {
      setActing(null);
    }
  }

  async function handleNudge(debtorId: string) {
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
      await notifyPaymentNudge(groupId, debtorId);
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
      {debtEdges.length > 0 && (
        <div className="rounded-2xl border bg-card overflow-hidden">
          <DebtGraph participants={participants} edges={debtEdges} />
        </div>
      )}


      {/* Debt cards (balance-derived — who owes whom) */}
      {debtEdges.length > 0 && (
        <div className="space-y-3">
          {debtEdges.map((edge) => {
            const from = getParticipant(edge.fromUserId);
            const to = getParticipant(edge.toUserId);
            const isDebtor = edge.fromUserId === currentUserId;
            const isCreditor = edge.toUserId === currentUserId;
            const edgeKey = settlementEdgeKey({
              groupId,
              fromUserId: edge.fromUserId,
              toUserId: edge.toUserId,
            });
            const isActing =
              acting === edgeKey || submission.reservedEdgeKeys.has(edgeKey);

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
                      onClick={() => {
                        if (!submission.ready || isActing) return;
                        setPixModal({
                          recipientId: edge.toUserId,
                          recipientName: to.name,
                          amountCents: edge.amountCents,
                          mode: "pay",
                        });
                      }}
                      disabled={!submission.ready || isActing}
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
                        onClick={() => {
                          if (!submission.ready || isActing) return;
                          setPixModal({
                            recipientId: edge.fromUserId,
                            recipientName: from.name,
                            amountCents: edge.amountCents,
                            mode: "collect",
                          });
                        }}
                        disabled={!submission.ready || isActing}
                      >
                        Gerar cobranca
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleNudge(edge.fromUserId)}
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
          onMarkPaid={(amountCents: number) => {
            if (pixModal.mode === "collect") {
              return handleRecordSettlement(
                pixModal.recipientId,
                currentUserId,
                amountCents,
              );
            }
            return handleRecordSettlement(
              currentUserId,
              pixModal.recipientId,
              amountCents,
            );
          }}
          onSettlementComplete={() => {
            setPixModal(null);
            window.dispatchEvent(new CustomEvent("app-refresh"));
          }}
          submission={submission}
        />
      )}
    </div>
  );
}
