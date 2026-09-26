"use client";

import { motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, UserPlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Row, VoiceBillTicket } from "@/components/bill/voice-bill-preview";
import { DiscardDraftDialog } from "@/components/bill/wizard/discard-draft-dialog";
import { Money } from "@/components/shared/money";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { useBackHandler } from "@/hooks/use-back-handler";
import { haptics } from "@/hooks/use-haptics";
import { fade, popIn } from "@/lib/animations";
import { formatBRL } from "@/lib/currency";
import { formatExpenseQuantity, type ExpenseQuantity } from "@/lib/expense-quantity";
import { cn } from "@/lib/utils";
import type { VoiceExpenseResult } from "@/lib/voice-expense-parser";
import type { UserProfile } from "@/types";

export type ResolvedParticipant =
  | { type: "member"; userId: string; handle: string; name: string; avatarUrl?: string | null }
  | { type: "guest"; name: string };

export interface VoiceBillReviewProps {
  result: VoiceExpenseResult;
  groupMembers?: UserProfile[];
  onConfirm: (result: VoiceExpenseResult, resolvedParticipants: ResolvedParticipant[]) => void;
  onCancel: () => void;
}

const editableValue = "min-h-11 min-w-0 max-w-full rounded-lg px-2 text-right underline decoration-muted-foreground/50 decoration-dotted underline-offset-4 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function VoiceBillReview({ result, groupMembers = [], onConfirm, onCancel }: VoiceBillReviewProps) {
  const reduceMotion = useReducedMotion();
  const [title, setTitle] = useState(result.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [amountCents, setAmountCents] = useState(result.amountCents);
  const [editingAmount, setEditingAmount] = useState(false);
  const [merchant, setMerchant] = useState(result.merchantName ?? "");
  const [resolved, setResolved] = useState<(ResolvedParticipant | null)[]>(() =>
    result.participants.map((participant) => {
      if (participant.matchedHandle && participant.confidence === "high") {
        const member = groupMembers.find((candidate) => candidate.handle === participant.matchedHandle);
        if (member) {
          return { type: "member", userId: member.id, handle: member.handle, name: member.name, avatarUrl: member.avatarUrl };
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
    onConfirm(
      {
        ...result,
        title: title || result.title,
        amountCents: amountCents > 0 ? amountCents : result.amountCents,
        merchantName: merchant || result.merchantName,
      },
      resolved.filter((participant): participant is ResolvedParticipant => participant !== null),
    );
  }, [result, title, amountCents, merchant, resolved, onConfirm]);

  const needsAmount = result.amountCents === 0 && result.expenseType === "single_amount" && amountCents === 0;
  const hasUnresolved = result.participants.length > 0 && resolved.some((participant) => participant === null);

  const matchToMember = (idx: number, member: UserProfile) => {
    setDirty(true);
    setResolved((previous) => {
      const next = [...previous];
      next[idx] = { type: "member", userId: member.id, handle: member.handle, name: member.name, avatarUrl: member.avatarUrl };
      return next;
    });
    setExpandedIdx(null);
  };

  const matchAsGuest = (idx: number) => {
    setDirty(true);
    setResolved((previous) => {
      const next = [...previous];
      next[idx] = { type: "guest", name: result.participants[idx].spokenName };
      return next;
    });
    setExpandedIdx(null);
  };

  const clearMatch = (idx: number) => {
    setDirty(true);
    setResolved((previous) => {
      const next = [...previous];
      next[idx] = null;
      return next;
    });
  };

  return (
    <div className="space-y-3" onChangeCapture={() => setDirty(true)}>
      <VoiceBillTicket title="Confira sua conta">
        <Row label="O quê" fillKey="title" className="py-0">
          {editingTitle ? (
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => setEditingTitle(false)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  setEditingTitle(false);
                }
              }}
              aria-label="Nome da conta"
              autoFocus
              className="text-right text-base md:text-sm"
            />
          ) : (
            <button type="button" aria-label={`Nome da conta: ${title || "Sem título"}`} onClick={() => setEditingTitle(true)} className={cn(editableValue, "truncate text-base font-semibold")}>
              {title || "Sem título"}
            </button>
          )}
        </Row>
        <Row label="Quanto" fillKey="amount" className="items-start py-0 [&>dt]:pt-3" valueClassName="flex-1 [&>div]:w-full">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 justify-end">
              {editingAmount ? (
                <CurrencyInput
                  valueCents={amountCents}
                  onChangeCents={setAmountCents}
                  onBlur={() => setEditingAmount(false)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      setEditingAmount(false);
                    }
                  }}
                  aria-label="Valor total"
                  autoFocus
                  className="min-h-11 min-w-0 w-full text-right text-base md:text-sm"
                />
              ) : (
                <button type="button" aria-label={`Valor total: ${formatBRL(amountCents)}`} onClick={() => setEditingAmount(true)} className={editableValue}>
                  <Money cents={amountCents} className="text-lg font-bold" />
                </button>
              )}
            </div>
            {result.items.length > 0 && (
              <ul aria-label="Itens" className="mt-1 divide-y divide-dashed divide-border">
                {result.items.map((item, index) => (
                  <li key={index} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2 text-sm">
                    <div className="min-w-0 flex-1 basis-24">
                      <p className="break-words font-medium">{item.description}</p>
                      {item.quantity > 1000 && (
                        <p className="text-xs text-muted-foreground">
                          {formatExpenseQuantity(item.quantity as ExpenseQuantity)}x {formatBRL(item.unitPriceCents)} un.
                        </p>
                      )}
                    </div>
                    <Money cents={item.totalCents} className="ml-auto font-semibold" />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Row>
        {(result.merchantName || merchant) && (
          <Row label="Onde" fillKey="merchant">
            <Input
              value={merchant}
              onChange={(event) => setMerchant(event.target.value)}
              aria-label="Estabelecimento"
              placeholder="Nome do local"
              className="text-right text-base md:text-sm"
            />
          </Row>
        )}
        <Row label="Com quem" fillKey="participants" className="items-start [&>dt]:pt-3" valueClassName="flex-1 [&>div]:w-full">
          {result.participants.length === 0 ? (
            <p className="py-3 text-right text-sm text-muted-foreground">Só você por enquanto. Dá pra adicionar pessoas no próximo passo.</p>
          ) : (
            <ul className="w-full divide-y divide-dashed divide-border">
              {result.participants.map((participant, index) => {
                const person = resolved[index];
                const member = person?.type === "member" ? person : null;
                let status = "Não identificado";
                if (person?.type === "guest") status = "Convidado";
                else if (member) status = `@${member.handle}`;
                else if (participant.matchedHandle) status = `@${participant.matchedHandle} ?`;
                return (
                  <li key={index} className="flex flex-wrap items-center gap-2 py-2">
                    <UserAvatar id={member?.userId ?? participant.spokenName} name={person?.name ?? participant.spokenName} avatarUrl={member?.avatarUrl} size="sm" />
                    <div className="min-w-0 flex-1 basis-16">
                      <p className="break-words text-sm font-medium">{participant.spokenName}</p>
                      <p className={cn("break-all text-xs text-muted-foreground", !person && !participant.matchedHandle && "text-warning-text")}>{status}</p>
                    </div>
                    {person ? (
                      <Button type="button" variant="ghost" size="sm" className="ml-auto min-h-11" aria-label={`Alterar ${participant.spokenName}`} onClick={() => clearMatch(index)}>Alterar</Button>
                    ) : (
                      <Popover open={expandedIdx === index} onOpenChange={(open) => setExpandedIdx(open ? index : null)}>
                        <PopoverTrigger render={<Button type="button" size="sm" variant="outline" className="ml-auto min-h-11" aria-label={`Atribuir ${participant.spokenName}`} />}>
                          Atribuir
                        </PopoverTrigger>
                        <PopoverContent align="end">
                          <PopoverTitle>Atribuir {participant.spokenName}</PopoverTitle>
                          {groupMembers.length > 0 && (
                            <div className="space-y-1">
                              <p className="px-2 text-xs font-medium text-muted-foreground">Membros do grupo</p>
                              {groupMembers.map((candidate) => (
                                <Button key={candidate.id} type="button" variant="ghost" className="h-auto min-h-11 w-full justify-start px-2 py-2 text-left" onClick={() => matchToMember(index, candidate)}>
                                  <UserAvatar id={candidate.id} name={candidate.name} avatarUrl={candidate.avatarUrl} size="sm" />
                                  <span className="min-w-0">
                                    <span className="block truncate text-sm font-medium">{candidate.name}</span>
                                    <span className="block truncate text-xs text-muted-foreground">@{candidate.handle}</span>
                                  </span>
                                </Button>
                              ))}
                            </div>
                          )}
                          <Button type="button" variant="outline" className="h-auto min-h-11 justify-start whitespace-normal py-2 text-left" onClick={() => matchAsGuest(index)}>
                            <UserPlus className="size-4 shrink-0" aria-hidden="true" />
                            Adicionar como convidado
                          </Button>
                        </PopoverContent>
                      </Popover>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Row>
      </VoiceBillTicket>
      <div aria-live="polite" className="space-y-2">
        {needsAmount && (
          <p className="flex items-center gap-2 rounded-xl bg-warning/10 px-3 py-2 text-sm text-warning-text">
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            Informe o valor antes de confirmar
          </p>
        )}
        {hasUnresolved && (
          <p className="flex items-center gap-2 rounded-xl bg-warning/10 px-3 py-2 text-sm text-warning-text">
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            Atribua todos os participantes antes de confirmar
          </p>
        )}
      </div>
      <motion.div variants={reduceMotion ? fade : popIn} initial="hidden" animate="visible" className="space-y-1">
        <Button type="button" className="min-h-11 w-full" disabled={needsAmount || hasUnresolved} onClick={handleConfirm}>Confirmar</Button>
        <Button type="button" variant="ghost" className="min-h-11 w-full" onClick={requestBack}>Voltar</Button>
      </motion.div>
      <DiscardDraftDialog open={discardOpen} draftTitle={title} itemCount={result.items.length} totalCents={amountCents} mode="banner-discard" onKeep={() => setDiscardOpen(false)} onDiscard={onCancel} />
    </div>
  );
}
