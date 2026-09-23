"use client";

import { Check, Loader2, Minus, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Money } from "@/components/shared/money";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import {
  ROOM_TICKS_PER_MILLIUNIT,
  claimTicksForFraction,
  claimTicksForQuantity,
} from "@/lib/assignment-room-money";
import { formatRoomTicks } from "@/lib/assignment-room-quantity";
import { parseExpenseQuantity } from "@/lib/expense-quantity";
import { cn } from "@/lib/utils";
import type {
  AssignmentRoomClaim,
  AssignmentRoomItem,
  AssignmentRoomParticipant,
} from "@/types/assignment-room";

const UNIT_TICKS = 1_000 * ROOM_TICKS_PER_MILLIUNIT;
const QUICK_DENOMINATORS = [2, 3, 4] as const;
const EXTRA_DENOMINATORS = [5, 6, 8, 10] as const;

type ClaimDraft =
  | { kind: "empty" }
  | { kind: "ticks"; ticks: number }
  | { kind: "quantity"; text: string };

type DraftResolution =
  | { status: "empty" }
  | { status: "invalid"; message: string }
  | { status: "ticks"; ticks: number };

interface RoomItemClaimProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  getReturnFocus: () => HTMLElement | null;
  item: AssignmentRoomItem;
  claims: AssignmentRoomClaim[];
  availableTicks: number;
  targetParticipantId: string;
  participants: AssignmentRoomParticipant[];
  canSelectParticipant: boolean;
  onTargetChange: (participantId: string) => void;
  pending: boolean;
  disabled: boolean;
  error: { participantId: string; message: string } | null;
  onSubmit: (
    participantId: string,
    ticks: number,
    expectedItemRevision: number,
  ) => Promise<boolean>;
}

const CHIP =
  "min-h-11 px-2 font-semibold transition-colors aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground";

export function RoomItemClaim({
  open,
  onOpenChange,
  getReturnFocus,
  item,
  claims,
  availableTicks,
  targetParticipantId,
  participants,
  canSelectParticipant,
  onTargetChange,
  pending,
  disabled,
  error,
  onSubmit,
}: RoomItemClaimProps) {
  const capacityTicks = item.quantityMilliunits * ROOM_TICKS_PER_MILLIUNIT;
  const target = participants.find((participant) => participant.id === targetParticipantId) ?? null;
  const targetActive = target !== null && !target.removed;
  const savedTicks = useMemo(
    () => claims.find((claim) => claim.participantId === targetParticipantId)?.ticks ?? 0,
    [claims, targetParticipantId],
  );
  const maximumTicks = savedTicks + availableTicks;
  const [draft, setDraft] = useState<ClaimDraft>({ kind: "empty" });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [draftItemRevision, setDraftItemRevision] = useState<number | null>(null);
  const savingRef = useRef(false);
  const wasOpenRef = useRef(false);
  const draftKeyRef = useRef<string | null>(null);
  const draftKey = `${item.id}:${targetParticipantId}`;

  const seedDraft = useCallback((ticks: number): ClaimDraft => {
    return ticks > 0 ? { kind: "ticks", ticks } : { kind: "empty" };
  }, []);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (!wasOpenRef.current || draftKeyRef.current !== draftKey) {
      setDraft(seedDraft(savedTicks));
      setDraftItemRevision(item.revision);
      setAdvancedOpen(false);
      setSaveError(null);
      draftKeyRef.current = draftKey;
    }
    wasOpenRef.current = true;
  }, [draftKey, item.revision, item.id, open, savedTicks, seedDraft]);

  const stale = draftItemRevision !== null && item.revision !== draftItemRevision;
  const resolution: DraftResolution = useMemo(() => {
    if (draft.kind === "empty") return { status: "empty" };
    if (draft.kind === "ticks") {
      if (draft.ticks < 0 || draft.ticks > maximumTicks) {
        return {
          status: "invalid",
          message: "Essa quantidade não está mais disponível. Escolha outra quantidade.",
        };
      }
      return { status: "ticks", ticks: draft.ticks };
    }
    const text = draft.text.trim();
    if (text.length === 0) return { status: "empty" };
    if (/^0([,.]0*)?$/.test(text)) return { status: "ticks", ticks: 0 };
    const parsed = parseExpenseQuantity(text.replace(",", "."));
    if (!parsed.ok) {
      return {
        status: "invalid",
        message: "Digite uma quantidade válida, com até três casas decimais.",
      };
    }
    const ticks = claimTicksForQuantity(parsed.value);
    if (!ticks.ok || ticks.value > maximumTicks) {
      return {
        status: "invalid",
        message: "Essa quantidade não está mais disponível. Escolha outra quantidade.",
      };
    }
    return { status: "ticks", ticks: ticks.value };
  }, [draft, maximumTicks]);

  const draftTicks = resolution.status === "ticks" ? resolution.ticks : null;
  const unchanged = draftTicks !== null && draftTicks === savedTicks;
  const canSave =
    !disabled &&
    !pending &&
    !saving &&
    !stale &&
    targetActive &&
    draftTicks !== null &&
    !unchanged;
  const scopedError =
    error?.participantId === targetParticipantId ? error.message : null;
  const message = stale
    ? "Esta escolha ficou desatualizada. O item não está mais disponível nesta versão. Atualize antes de salvar."
    : !targetActive
      ? "Essa pessoa não está mais na sala."
      : resolution.status === "invalid"
        ? resolution.message
        : scopedError ?? saveError;

  function chooseTicks(ticks: number) {
    if (stale || !targetActive) return;
    setDraft({ kind: "ticks", ticks });
    setSaveError(null);
  }

  function typeQuantity(text: string) {
    if (stale || !targetActive) return;
    setDraft({ kind: "quantity", text });
    setSaveError(null);
  }

  function fractionTicks(denominator: number): number | null {
    const result = claimTicksForFraction(item.quantityMilliunits, 1, denominator);
    return result.ok ? result.value : null;
  }

  function stepFrom(): number {
    return draftTicks ?? savedTicks;
  }

  function refreshDraft() {
    if (saving) return;
    setDraft(seedDraft(savedTicks));
    setDraftItemRevision(item.revision);
    setAdvancedOpen(false);
    setSaveError(null);
  }

  async function confirm() {
    if (!canSave || draftTicks === null || savingRef.current || draftItemRevision === null) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await onSubmit(targetParticipantId, draftTicks, draftItemRevision);
      if (saved) {
        onOpenChange(false);
        return;
      }
      setSaveError(
        error?.participantId === targetParticipantId
          ? error.message
          : "Não foi possível salvar. Tente novamente.",
      );
    } catch {
      setSaveError("Não foi possível salvar. Tente novamente.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const remainder = draftTicks === null ? null : maximumTicks - draftTicks;
  const targetLabel = target?.displayName ?? "pessoa removida";
  const quantityLabel = canSelectParticipant ? `Quantidade de ${targetLabel}` : "Sua quantidade";

  return (
    <Dialog
      open={open}
      dismissable={!saving}
      onOpenChange={(next) => {
        if (saving) return;
        onOpenChange(next);
      }}
    >
      <DialogContent finalFocus={getReturnFocus} className="gap-5 rounded-3xl">
        <DialogHeader className="gap-2">
          <DialogTitle className="pr-6 text-xl">{item.description}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-baseline justify-between gap-2">
            <span>{formatRoomTicks(capacityTicks)} un. · {availableTicks > 0 ? `${formatRoomTicks(availableTicks)} livres` : "Tudo escolhido"}</span>
            <Money cents={item.totalPriceCents} className="text-base font-semibold text-foreground" />
          </DialogDescription>
        </DialogHeader>

        {canSelectParticipant && (
          <div>
            <p className="mb-2 text-sm font-semibold">Pra quem?</p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Pra quem?">
              {participants.filter((participant) => !participant.removed).map((participant) => (
                <Button
                  key={participant.id}
                  type="button"
                  variant="outline"
                  role="radio"
                  aria-checked={participant.id === targetParticipantId}
                  className={cn("min-h-11 gap-1.5 rounded-full px-2", participant.id === targetParticipantId && "border-primary bg-primary/15 text-primary-text")}
                  disabled={saving}
                  onClick={() => onTargetChange(participant.id)}
                >
                  <UserAvatar name={participant.displayName} avatarUrl={participant.avatarUrl} size="xs" />
                  <span className="max-w-28 truncate">{participant.displayName}</span>
                </Button>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="mb-2 text-sm font-semibold">{quantityLabel}</p>
          <div className="grid grid-cols-2 gap-2 min-[360px]:grid-cols-4">
            <Button type="button" variant="outline" aria-pressed={draftTicks === capacityTicks} className={CHIP} disabled={saving || stale || !targetActive || capacityTicks > maximumTicks} onClick={() => chooseTicks(capacityTicks)}>
              Inteiro
            </Button>
            {QUICK_DENOMINATORS.map((denominator) => {
              const ticks = fractionTicks(denominator);
              return (
                <Button key={denominator} type="button" variant="outline" aria-pressed={ticks !== null && draftTicks === ticks} className={CHIP} disabled={saving || stale || !targetActive || ticks === null || ticks > maximumTicks} onClick={() => ticks !== null && chooseTicks(ticks)}>
                  1/{denominator}
                </Button>
              );
            })}
          </div>
        </div>

        {maximumTicks > 0 && maximumTicks !== capacityTicks && (
          <Button type="button" variant="outline" className="min-h-11 w-full border-success/40 bg-success/10 font-semibold text-success-text hover:bg-success/20" disabled={saving || stale || !targetActive} onClick={() => chooseTicks(maximumTicks)}>
            Pegar o restante ({formatRoomTicks(maximumTicks)} un.)
          </Button>
        )}

        {!advancedOpen ? (
          <Button type="button" variant="ghost" className="min-h-11 w-full text-primary-text" disabled={saving || stale || !targetActive} onClick={() => setAdvancedOpen(true)}>
            Outra quantidade
          </Button>
        ) : (
          <div className="space-y-3 rounded-xl bg-muted/60 p-3">
            <div className="grid grid-cols-[44px_minmax(0,1fr)_44px] gap-2">
              <Button type="button" size="icon" variant="outline" className="min-h-11 min-w-11 text-primary-text" aria-label="Diminuir uma unidade" disabled={saving || stale || !targetActive || stepFrom() <= 0} onClick={() => chooseTicks(Math.max(0, stepFrom() - UNIT_TICKS))}>
                <Minus className="size-4" />
              </Button>
              <Input value={draft.kind === "quantity" ? draft.text : draftTicks === null ? "" : formatRoomTicks(draftTicks)} inputMode="decimal" aria-label="Quantidade desejada" placeholder="Ex.: 1,5" className="min-h-11 bg-background text-center font-semibold" disabled={saving || stale || !targetActive} onChange={(event) => typeQuantity(event.target.value)} />
              <Button type="button" size="icon" variant="outline" className="min-h-11 min-w-11 text-primary-text" aria-label="Aumentar uma unidade" disabled={saving || stale || !targetActive || stepFrom() >= maximumTicks} onClick={() => chooseTicks(Math.min(maximumTicks, stepFrom() + UNIT_TICKS))}>
                <Plus className="size-4" />
              </Button>
            </div>
            <SelectField label="Escolher fração" value="" placeholder="Escolher fração" disabled={saving || stale || !targetActive} options={EXTRA_DENOMINATORS.map((denominator) => {
              const ticks = fractionTicks(denominator);
              return { value: String(denominator), label: `1/${denominator}`, disabled: ticks === null || ticks > maximumTicks };
            })} onChange={(value) => {
              const ticks = fractionTicks(Number(value));
              if (ticks !== null) chooseTicks(ticks);
            }} />
          </div>
        )}

        {savedTicks > 0 && (
          <Button type="button" variant="ghost" className="min-h-11 w-full text-destructive-text" disabled={saving || stale || !targetActive} onClick={() => chooseTicks(0)}>
            <Trash2 className="size-4" />
            {canSelectParticipant ? `Remover escolha de ${targetLabel}` : "Remover minha escolha"}
          </Button>
        )}

        <div className="border-t border-dashed pt-3 text-sm">
          {draftTicks === null ? (
            <p className="text-muted-foreground">Escolha uma quantidade para continuar.</p>
          ) : (
            <>
              <p className="flex items-center gap-1.5 font-semibold text-primary-text">
                <Check className="size-4" aria-hidden="true" />
                {canSelectParticipant ? `${targetLabel}: ` : "Sua quantidade: "}{formatRoomTicks(draftTicks)} un.
              </p>
              {remainder !== null && <p className="mt-0.5 text-muted-foreground">Depois de confirmar, restam {formatRoomTicks(remainder)} un.</p>}
            </>
          )}
        </div>

        {message && <p role="alert" className="text-sm text-destructive-text">{message}</p>}
        {stale && (
          <Button type="button" variant="outline" className="min-h-11 w-full" disabled={saving || !targetActive} onClick={refreshDraft}>
            Atualizar escolha
          </Button>
        )}

        <DialogFooter className="flex-col sm:flex-col sm:justify-stretch">
          <Button type="button" className="min-h-12 w-full text-base font-semibold" disabled={!canSave} onClick={confirm}>
            {saving ? <Loader2 className="size-4" /> : null}
            {saving ? "Salvando..." : canSelectParticipant ? "Confirmar quantidade" : "Confirmar quantidade"}
          </Button>
          <Button type="button" variant="ghost" className="min-h-11 w-full" disabled={saving} onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
