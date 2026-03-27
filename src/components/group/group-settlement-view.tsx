"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check, CheckCheck, Loader2 } from "lucide-react";
import { DebtGraph } from "@/components/settlement/debt-graph";
import { SimplificationToggle } from "@/components/settlement/simplification-toggle";
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
import { computeGroupNetStateFromEvents, computeSettlementEdges } from "@/lib/net-state";
import type { SettlementEdge } from "@/lib/net-state";
import { simplifyDebts } from "@/lib/simplify";
import { loadLedgerEntries } from "@/lib/supabase/ledger-actions";
import { recordPayment, confirmPaymentsForPair } from "@/lib/supabase/ledger-actions";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@/types";
import type { SimplificationResult } from "@/lib/simplify";

interface GroupSettlementViewProps {
  groupId: string;
  participants: User[];
  currentUserId: string;
}

export function GroupSettlementView({
  groupId,
  participants,
  currentUserId,
}: GroupSettlementViewProps) {
  const [loading, setLoading] = useState(true);
  const [settlements, setSettlements] = useState<SettlementEdge[]>([]);
  const [simplifyEnabled, setSimplifyEnabled] = useState(true);
  const [simplificationResult, setSimplificationResult] = useState<SimplificationResult | null>(null);
  const [showSimplificationViewer, setShowSimplificationViewer] = useState(false);
  const [pixModal, setPixModal] = useState<{
    fromUserId: string;
    toUserId: string;
    recipientId: string;
    recipientName: string;
    amountCents: number;
    unconfirmedCents: number;
    mode: "pay" | "collect";
  } | null>(null);
  const [settling, setSettling] = useState<string | null>(null);

  // Load ledger entries, compute settlement edges and simplification
  const reloadSettlements = useCallback(async () => {
    const entries = await loadLedgerEntries({ groupId });

    // Compute net edges for the debt graph / simplification
    const netEdges = computeGroupNetStateFromEvents(entries, participants);
    if (netEdges.length >= 2 && participants.length >= 3) {
      const result = simplifyDebts(netEdges, participants);
      setSimplificationResult(result);
    } else {
      setSimplificationResult(null);
    }

    // Compute settlement edges with payment status
    const edges = computeSettlementEdges(entries);
    setSettlements(edges.filter((e) => e.status !== "settled"));
  }, [groupId, participants]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await reloadSettlements();
      setLoading(false);
    })();
  }, [reloadSettlements]);

  const reloadRef = useRef(reloadSettlements);
  useEffect(() => { reloadRef.current = reloadSettlements; });

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`group-ledger:${groupId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ledger", filter: `group_id=eq.${groupId}` },
        () => reloadRef.current(),
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [groupId]);

  const displayEdges = simplifyEnabled && simplificationResult
    ? simplificationResult.simplifiedEdges
    : simplificationResult?.originalEdges ?? [];

  const myDebts = settlements.filter(
    (s) => s.fromUserId === currentUserId && s.status === "pending",
  );

  const getParticipant = (id: string) =>
    participants.find((p) => p.id === id) ?? { id, name: "?", handle: "", email: "", pixKeyType: "email" as const, pixKeyHint: "", onboarded: false, createdAt: "" };

  const edgeKey = (from: string, to: string) => `${from}->${to}`;

  async function handleMarkPaid(amountCents: number, fromUserId: string, toUserId: string) {
    setSettling(edgeKey(fromUserId, toUserId));
    await recordPayment(groupId, fromUserId, toUserId, amountCents);
    setPixModal(null);
    await reloadSettlements();
    setSettling(null);
  }

  async function handleConfirm(fromUserId: string, toUserId: string) {
    setSettling(edgeKey(fromUserId, toUserId));
    await confirmPaymentsForPair(groupId, fromUserId, toUserId, currentUserId);
    await reloadSettlements();
    setSettling(null);
  }

  async function handleSettleAll() {
    setSettling("all");
    await Promise.all(
      myDebts.map((s) =>
        recordPayment(groupId, s.fromUserId, s.toUserId, s.netAmountCents),
      ),
    );
    await reloadSettlements();
    setSettling(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (settlements.length === 0) {
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
            const totalOwed = settlements
              .filter((s) => s.fromUserId === p.id)
              .reduce((sum, s) => sum + s.netAmountCents, 0);
            const totalToReceive = settlements
              .filter((s) => s.toUserId === p.id)
              .reduce((sum, s) => sum + s.netAmountCents, 0);
            const net = totalToReceive - totalOwed;
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

      {/* Simplification toggle */}
      {simplificationResult && simplificationResult.originalCount > simplificationResult.simplifiedCount && (
        <SimplificationToggle
          originalCount={simplificationResult.originalCount}
          simplifiedCount={simplificationResult.simplifiedCount}
          enabled={simplifyEnabled}
          onToggle={setSimplifyEnabled}
          onViewSteps={() => setShowSimplificationViewer(true)}
        />
      )}

      {/* Settle all button */}
      {myDebts.length > 1 && (
        <Button
          variant="outline"
          className="w-full gap-2"
          onClick={handleSettleAll}
          disabled={settling === "all"}
        >
          {settling === "all" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCheck className="h-4 w-4" />
          )}
          Liquidar tudo ({myDebts.length} pagamentos)
        </Button>
      )}

      {/* Settlement cards */}
      <div className="space-y-3">
        {settlements.map((settlement) => {
          const from = getParticipant(settlement.fromUserId);
          const to = getParticipant(settlement.toUserId);
          const isDebtor = settlement.fromUserId === currentUserId;
          const isCreditor = settlement.toUserId === currentUserId;
          const isSettling = settling === edgeKey(settlement.fromUserId, settlement.toUserId);

          return (
            <motion.div
              key={edgeKey(settlement.fromUserId, settlement.toUserId)}
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
                  <p className="font-semibold tabular-nums text-sm">{formatBRL(settlement.netAmountCents)}</p>
                  {settlement.unconfirmedCents > 0 && settlement.unconfirmedCents < settlement.netAmountCents && (
                    <p className="text-[10px] text-muted-foreground tabular-nums">
                      Pago: {formatBRL(settlement.unconfirmedCents)}
                    </p>
                  )}
                  <span className={`text-[10px] font-medium rounded-full px-2 py-0.5 ${
                    settlement.status === "paid_unconfirmed"
                      ? "bg-warning/15 text-warning-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}>
                    {settlement.status === "paid_unconfirmed"
                      ? "Aguardando"
                      : "Pendente"}
                  </span>
                </div>
              </div>

              <div className="flex gap-2">
                {isDebtor && settlement.status === "pending" && (
                  <Button
                    className="flex-1"
                    size="sm"
                    onClick={() =>
                      setPixModal({
                        fromUserId: settlement.fromUserId,
                        toUserId: settlement.toUserId,
                        recipientId: settlement.toUserId,
                        recipientName: to.name,
                        amountCents: settlement.netAmountCents,
                        unconfirmedCents: settlement.unconfirmedCents,
                        mode: "pay",
                      })
                    }
                    disabled={isSettling}
                  >
                    Pagar via Pix
                  </Button>
                )}

                {isDebtor && settlement.status === "paid_unconfirmed" && (
                  <div className="flex flex-1 items-center gap-2 rounded-xl bg-muted/50 px-3 py-2">
                    <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" />
                    <p className="text-xs text-muted-foreground">
                      Aguardando {to.name.split(" ")[0]} confirmar
                    </p>
                  </div>
                )}

                {isCreditor && settlement.status === "pending" && (
                  <Button
                    variant="outline"
                    className="flex-1"
                    size="sm"
                    onClick={() =>
                      setPixModal({
                        fromUserId: settlement.fromUserId,
                        toUserId: settlement.toUserId,
                        recipientId: settlement.fromUserId,
                        recipientName: from.name,
                        amountCents: settlement.netAmountCents,
                        unconfirmedCents: settlement.unconfirmedCents,
                        mode: "collect",
                      })
                    }
                    disabled={isSettling}
                  >
                    Gerar cobranca
                  </Button>
                )}

                {isCreditor && settlement.status === "paid_unconfirmed" && (
                  <Button
                    className="flex-1"
                    size="sm"
                    onClick={() => handleConfirm(settlement.fromUserId, settlement.toUserId)}
                    disabled={isSettling}
                  >
                    {isSettling ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Check className="h-4 w-4 mr-1" />
                        Confirmar recebimento de {formatBRL(settlement.unconfirmedCents || settlement.netAmountCents)}
                      </>
                    )}
                  </Button>
                )}

                {!isDebtor && !isCreditor && (
                  <div className="flex-1 text-center text-xs text-muted-foreground py-2">
                    {settlement.status === "paid_unconfirmed"
                      ? `${from.name.split(" ")[0]} marcou como pago`
                      : "Aguardando pagamento"}
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Simplification viewer */}
      {simplificationResult && (
        <Sheet open={showSimplificationViewer} onOpenChange={setShowSimplificationViewer}>
          <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-3xl">
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
          paidAmountCents={pixModal.unconfirmedCents}
          recipientUserId={pixModal.recipientId}
          groupId={groupId}
          mode={pixModal.mode}
          onMarkPaid={async (amountCents: number) => {
            if (pixModal.mode === "collect") {
              await handleConfirm(pixModal.fromUserId, pixModal.toUserId);
            } else {
              await handleMarkPaid(amountCents, pixModal.fromUserId, pixModal.toUserId);
            }
          }}
        />
      )}
    </div>
  );
}
