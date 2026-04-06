"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, Pencil, Store, UserPlus } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBRL, sanitizeDecimalInput } from "@/lib/currency";
import type { VoiceExpenseResult } from "@/lib/voice-expense-parser";
import type { UserProfile } from "@/types";

export type ResolvedParticipant =
  | { type: "member"; userId: string; handle: string; name: string; avatarUrl?: string }
  | { type: "guest"; name: string };

interface VoiceExpenseModalProps {
  result: VoiceExpenseResult;
  groupMembers?: UserProfile[];
  onConfirm: (result: VoiceExpenseResult, resolvedParticipants: ResolvedParticipant[]) => void;
  onCancel: () => void;
}

export function VoiceExpenseModal({
  result,
  groupMembers = [],
  onConfirm,
  onCancel,
}: VoiceExpenseModalProps) {
  const [title, setTitle] = useState(result.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [amountInput, setAmountInput] = useState(
    result.amountCents > 0
      ? (result.amountCents / 100).toFixed(2).replace(".", ",")
      : "",
  );
  const [editingAmount, setEditingAmount] = useState(false);
  const [merchant, setMerchant] = useState(result.merchantName ?? "");
  const [resolved, setResolved] = useState<(ResolvedParticipant | null)[]>(() =>
    result.participants.map((p) => {
      if (p.matchedHandle && p.confidence === "high") {
        const member = groupMembers.find((m) => m.handle === p.matchedHandle);
        if (member) {
          return {
            type: "member",
            userId: member.id,
            handle: member.handle,
            name: member.name,
            avatarUrl: member.avatarUrl,
          };
        }
      }
      return null;
    }),
  );
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const handleConfirm = useCallback(() => {
    const amountCents = amountInput
      ? Math.round(parseFloat(amountInput.replace(",", ".")) * 100)
      : result.amountCents;
    const resolvedParticipants = resolved.filter(
      (r): r is ResolvedParticipant => r !== null,
    );
    onConfirm(
      {
        ...result,
        title: title || result.title,
        amountCents: Number.isFinite(amountCents) ? amountCents : result.amountCents,
        merchantName: merchant || result.merchantName,
      },
      resolvedParticipants,
    );
  }, [result, title, amountInput, merchant, resolved, onConfirm]);

  const needsAmount =
    result.amountCents === 0 &&
    result.expenseType === "single_amount" &&
    !amountInput;

  const hasUnresolved =
    result.participants.length > 0 && resolved.some((r) => r === null);

  const matchToMember = (idx: number, member: UserProfile) => {
    setResolved((prev) => {
      const next = [...prev];
      next[idx] = {
        type: "member",
        userId: member.id,
        handle: member.handle,
        name: member.name,
        avatarUrl: member.avatarUrl,
      };
      return next;
    });
    setExpandedIdx(null);
  };

  const matchAsGuest = (idx: number) => {
    setResolved((prev) => {
      const next = [...prev];
      next[idx] = { type: "guest", name: result.participants[idx].spokenName };
      return next;
    });
    setExpandedIdx(null);
  };

  const clearMatch = (idx: number) => {
    setResolved((prev) => {
      const next = [...prev];
      next[idx] = null;
      return next;
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <div>
        <h2 className="text-lg font-semibold">Confirmar despesa</h2>
        <p className="text-sm text-muted-foreground">
          Confira os dados e corrija se necessário.
        </p>
      </div>

      <div className="rounded-2xl border bg-card p-4">
        <span className="text-xs font-medium text-muted-foreground">Título</span>
        {editingTitle ? (
          <div className="mt-1.5 flex gap-2">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              className="flex-1"
            />
            <Button size="sm" onClick={() => setEditingTitle(false)}>
              <Check className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <div
            className="mt-1 flex cursor-pointer items-center gap-2"
            onClick={() => setEditingTitle(true)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter") setEditingTitle(true);
            }}
          >
            <p className="font-medium">{title || "Sem título"}</p>
            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border bg-card p-4">
          <span className="text-xs font-medium text-muted-foreground">Valor</span>
          {editingAmount ? (
            <div className="mt-1.5 flex gap-1">
              <span className="mt-1 text-sm font-medium">R$</span>
              <Input
                value={amountInput}
                onChange={(e) => setAmountInput(sanitizeDecimalInput(e.target.value))}
                autoFocus
                className="flex-1"
                inputMode="decimal"
                placeholder="0,00"
              />
              <Button size="sm" onClick={() => setEditingAmount(false)}>
                <Check className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <div
              className="mt-1 flex cursor-pointer items-center gap-2"
              onClick={() => setEditingAmount(true)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter") setEditingAmount(true);
              }}
            >
              <p className="text-lg font-bold tabular-nums">
                {result.amountCents > 0 ? formatBRL(result.amountCents) : "—"}
              </p>
              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
          )}
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <span className="text-xs font-medium text-muted-foreground">Tipo</span>
          <p className="mt-1 font-medium">
            {result.expenseType === "single_amount" ? "Valor único" : "Vários itens"}
          </p>
        </div>
      </div>

      {(result.merchantName || merchant) && (
        <div className="rounded-2xl border bg-card p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Store className="h-3.5 w-3.5" />
            Estabelecimento
          </div>
          <Input
            className="mt-1.5"
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            placeholder="Nome do local"
          />
        </div>
      )}

      {result.items.length > 0 && (
        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground">Itens</span>
          {result.items.map((item, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="flex items-center justify-between rounded-2xl border bg-card p-4"
            >
              <div>
                <p className="font-medium">{item.description}</p>
                {item.quantity > 1 && (
                  <p className="text-xs text-muted-foreground">
                    {item.quantity}x {formatBRL(item.unitPriceCents)} un.
                  </p>
                )}
              </div>
              <span className="text-sm font-bold tabular-nums">
                {formatBRL(item.totalCents)}
              </span>
            </motion.div>
          ))}
        </div>
      )}

      {result.participants.length > 0 && (
        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground">
            Participantes
          </span>
          {result.participants.map((p, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="rounded-2xl border bg-card p-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold ${
                      resolved[i]
                        ? "bg-success/15 text-success"
                        : p.confidence === "low"
                          ? "bg-muted text-muted-foreground"
                          : "bg-warning/15 text-warning-foreground"
                    }`}
                  >
                    {resolved[i] ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      p.spokenName.charAt(0).toUpperCase()
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{p.spokenName}</p>
                    {resolved[i] ? (
                      <p className="text-xs text-muted-foreground">
                        {resolved[i]!.type === "member"
                          ? `@${(resolved[i] as Extract<ResolvedParticipant, { type: "member" }>).handle}`
                          : "Convidado"}
                      </p>
                    ) : p.matchedHandle ? (
                      <p className="text-xs text-muted-foreground">
                        @{p.matchedHandle} ?
                      </p>
                    ) : (
                      <p className="text-xs text-warning-foreground">
                        Não identificado
                      </p>
                    )}
                  </div>
                </div>
                {resolved[i] ? (
                  <button
                    className="text-xs text-muted-foreground underline"
                    onClick={() => clearMatch(i)}
                  >
                    Alterar
                  </button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setExpandedIdx(expandedIdx === i ? null : i)
                    }
                  >
                    Atribuir
                  </Button>
                )}
              </div>

              <AnimatePresence>
                {expandedIdx === i && !resolved[i] && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-3 overflow-hidden border-t pt-3"
                  >
                    {groupMembers.length > 0 && (
                      <div className="space-y-1.5">
                        <span className="text-xs text-muted-foreground">
                          Membros do grupo
                        </span>
                        {groupMembers.map((m) => (
                          <button
                            key={m.id}
                            className="flex w-full items-center gap-2 rounded-lg p-2 text-left transition-colors hover:bg-muted"
                            onClick={() => matchToMember(i, m)}
                          >
                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                              {m.name.charAt(0)}
                            </div>
                            <div>
                              <p className="text-sm font-medium">{m.name}</p>
                              <p className="text-xs text-muted-foreground">
                                @{m.handle}
                              </p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    <button
                      className="mt-2 flex w-full items-center gap-2 rounded-lg border border-dashed p-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted"
                      onClick={() => matchAsGuest(i)}
                    >
                      <UserPlus className="h-4 w-4" />
                      Adicionar como convidado
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      )}

      {needsAmount && (
        <div className="flex items-center gap-2 rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning-foreground">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Informe o valor antes de confirmar
        </div>
      )}

      {hasUnresolved && (
        <div className="flex items-center gap-2 rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning-foreground">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Atribua todos os participantes antes de confirmar
        </div>
      )}

      <div className="flex gap-3">
        <Button variant="outline" className="flex-1" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          className="flex-1"
          onClick={handleConfirm}
          disabled={needsAmount || hasUnresolved}
        >
          Confirmar
        </Button>
      </div>
    </motion.div>
  );
}
