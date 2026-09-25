"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, Mic, Pencil, Store, UserPlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { formatBRL } from "@/lib/currency";
import { formatExpenseQuantity, type ExpenseQuantity } from "@/lib/expense-quantity";
import type { VoiceExpenseResult } from "@/lib/voice-expense-parser";
import type { UserProfile } from "@/types";
import { Money } from "@/components/shared/money";
import { UserAvatar } from "@/components/shared/user-avatar";
import { popIn } from "@/lib/animations";
import { haptics } from "@/hooks/use-haptics";
import { DiscardDraftDialog } from "@/components/bill/wizard/discard-draft-dialog";
import { useBackHandler } from "@/hooks/use-back-handler";

export type ResolvedParticipant =
  | { type: "member"; userId: string; handle: string; name: string; avatarUrl?: string | null }
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
  const [amountCents, setAmountCents] = useState(result.amountCents);
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
  const [dirty, setDirty] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const requestBack = () => dirty ? setDiscardOpen(true) : onCancel();
  useBackHandler(dirty && !discardOpen, requestBack);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const handleConfirm = useCallback(() => {
    haptics.success();
    const finalAmountCents = amountCents > 0 ? amountCents : result.amountCents;
    const resolvedParticipants = resolved.filter(
      (r): r is ResolvedParticipant => r !== null,
    );
    onConfirm(
      {
        ...result,
        title: title || result.title,
        amountCents: finalAmountCents,
        merchantName: merchant || result.merchantName,
      },
      resolvedParticipants,
    );
  }, [result, title, amountCents, merchant, resolved, onConfirm]);

  const needsAmount =
    result.amountCents === 0 &&
    result.expenseType === "single_amount" &&
    amountCents === 0;

  const hasUnresolved =
    result.participants.length > 0 && resolved.some((r) => r === null);

  const matchToMember = (idx: number, member: UserProfile) => {
    setDirty(true);
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
    setDirty(true);
    setResolved((prev) => {
      const next = [...prev];
      next[idx] = { type: "guest", name: result.participants[idx].spokenName };
      return next;
    });
    setExpandedIdx(null);
  };

  const clearMatch = (idx: number) => {
    setDirty(true);
    setResolved((prev) => {
      const next = [...prev];
      next[idx] = null;
      return next;
    });
  };

  return (
    <motion.div
      variants={popIn} initial="hidden" animate="visible"
      className="space-y-3"
      onChangeCapture={() => setDirty(true)}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Confirmar despesa</h2>
        <Button variant="ghost" size="sm" onClick={requestBack}>Voltar</Button>
      </div>

      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center gap-3 border-b border-border bg-primary/5 px-4 py-3">
          <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-[0.75rem] bg-primary/15 text-primary-text">
            <Mic className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            {editingTitle ? (
              <div className="flex gap-2">
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  aria-label="Nome da despesa"
                  autoFocus
                  className="flex-1"
                />
                <Button size="icon" aria-label="Concluir nome" onClick={() => setEditingTitle(false)}>
                  <Check className="size-4" />
                </Button>
              </div>
            ) : (
              <div
                className="flex min-h-11 cursor-pointer items-center gap-2"
                onClick={() => setEditingTitle(true)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditingTitle(true); }
                }}
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold">{title || "Sem título"}</p>
                  <p className="text-xs text-muted-foreground">
                    {result.expenseType === "single_amount" ? "Valor único" : "Vários itens"}
                  </p>
                </div>
                <Pencil className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              </div>
            )}
          </div>
        </div>

        <div className="px-4 py-3">
          <span className="text-xs text-muted-foreground">Total</span>
          {editingAmount ? (
            <div className="mt-1 flex items-center gap-2">
              <span className="text-lg leading-6 font-semibold text-muted-foreground">R$</span>
              <CurrencyInput
                valueCents={amountCents}
                onChangeCents={setAmountCents}
                aria-label="Valor total"
                autoFocus
                className="min-w-0 flex-1 text-left text-lg md:text-lg"
              />
              <Button size="icon" aria-label="Concluir valor" onClick={() => setEditingAmount(false)}>
                <Check className="size-4" />
              </Button>
            </div>
          ) : (
            <div
              className="flex min-h-11 cursor-pointer items-center gap-2"
              onClick={() => setEditingAmount(true)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditingAmount(true); }
              }}
            >
              <Money cents={amountCents} className="text-3xl font-bold" />
              <Pencil className="size-3.5 text-muted-foreground" aria-hidden="true" />
            </div>
          )}
        </div>

        {(result.merchantName || merchant) && (
          <div className="flex items-center gap-3 border-t border-border px-4 py-2">
            <Store className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <Input
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              placeholder="Nome do local"
              aria-label="Estabelecimento"
              className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
            />
          </div>
        )}

        {result.items.length > 0 && (
          <div className="border-t border-border">
            <p className="px-4 pt-2 text-xs text-muted-foreground">Itens</p>
            <ul className="divide-y divide-border">
              {result.items.map((item, i) => (
                <li key={i} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.description}</p>
                    {item.quantity > 1000 && (
                      <p className="text-xs text-muted-foreground">
                        {formatExpenseQuantity(item.quantity as ExpenseQuantity)}x {formatBRL(item.unitPriceCents)} un.
                      </p>
                    )}
                  </div>
                  <Money cents={item.totalCents} className="text-sm font-semibold" />
                </li>
              ))}
            </ul>
          </div>
        )}

        {result.participants.length > 0 && (
          <div className="border-t border-border">
            <p className="px-4 pt-2 text-xs text-muted-foreground">Participantes</p>
            <ul className="divide-y divide-border">
              {result.participants.map((p, i) => (
                <li key={i}>
                  <div className="flex min-h-11 items-center gap-3 px-4 py-2">
                    <span
                      aria-hidden="true"
                      className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        resolved[i]
                          ? "bg-success/15 text-success-text"
                          : p.confidence === "low"
                            ? "bg-muted text-muted-foreground"
                            : "bg-warning/15 text-warning-foreground dark:text-warning"
                      }`}
                    >
                      {resolved[i] ? <Check className="size-4" /> : p.spokenName.charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.spokenName}</p>
                      {resolved[i] ? (
                        <p className="text-xs text-muted-foreground">
                          {resolved[i]!.type === "member"
                            ? `@${(resolved[i] as Extract<ResolvedParticipant, { type: "member" }>).handle}`
                            : "Convidado"}
                        </p>
                      ) : p.matchedHandle ? (
                        <p className="text-xs text-muted-foreground">@{p.matchedHandle} ?</p>
                      ) : (
                        <p className="text-xs text-warning-foreground dark:text-warning">Não identificado</p>
                      )}
                    </div>
                    {resolved[i] ? (
                      <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => clearMatch(i)}>
                        Alterar
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                      >
                        Atribuir
                      </Button>
                    )}
                  </div>

                  <AnimatePresence>
                    {expandedIdx === i && !resolved[i] && (
                      <motion.div
                        variants={popIn} initial="hidden" animate="visible" exit="exit"
                        className="space-y-1 overflow-hidden px-3 pb-3"
                      >
                        {groupMembers.length > 0 && (
                          <>
                            <span className="px-1 text-xs text-muted-foreground">Membros do grupo</span>
                            {groupMembers.map((m) => (
                              <button
                                key={m.id}
                                className="flex min-h-11 w-full items-center gap-2 rounded-[0.75rem] px-2 py-1.5 text-left transition-colors hover:bg-muted"
                                onClick={() => matchToMember(i, m)}
                              >
                                <UserAvatar id={m.id} name={m.name} avatarUrl={m.avatarUrl} size="sm" />
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-medium">{m.name}</span>
                                  <span className="block text-xs text-muted-foreground">@{m.handle}</span>
                                </span>
                              </button>
                            ))}
                          </>
                        )}
                        <button
                          className="flex min-h-11 w-full items-center gap-2 rounded-[0.75rem] border border-dashed px-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted"
                          onClick={() => matchAsGuest(i)}
                        >
                          <UserPlus className="size-4" />
                          Adicionar como convidado
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {needsAmount && (
        <p className="flex items-center gap-2 rounded-[0.75rem] bg-warning/10 px-3 py-2 text-sm text-warning-foreground dark:text-warning">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          Informe o valor antes de confirmar
        </p>
      )}

      {hasUnresolved && (
        <p className="flex items-center gap-2 rounded-[0.75rem] bg-warning/10 px-3 py-2 text-sm text-warning-foreground dark:text-warning">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          Atribua todos os participantes antes de confirmar
        </p>
      )}

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={() => { setEditingTitle(true); setEditingAmount(true); }}>
          Editar
        </Button>
        <Button
          className="flex-1"
          onClick={handleConfirm}
          disabled={needsAmount || hasUnresolved}
        >
          Confirmar
        </Button>
      </div>
      <DiscardDraftDialog open={discardOpen} draftTitle={title} itemCount={result.items.length} totalCents={amountCents} mode="banner-discard" onKeep={() => setDiscardOpen(false)} onDiscard={onCancel} />
    </motion.div>
  );
}
