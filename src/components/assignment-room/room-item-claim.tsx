"use client";

import { Loader2, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Money } from "@/components/shared/money";
import { UserAvatar } from "@/components/shared/user-avatar";
import { GuestAvatar } from "@/components/shared/guest-avatar";
import { displayNames } from "@/lib/people";
import { Button } from "@/components/ui/button";
import { haptics } from "@/hooks/use-haptics";
import { Popover, PopoverContent, PopoverDescription, PopoverTitle } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ROOM_TICKS_PER_MILLIUNIT } from "@/lib/assignment-room-money";
import {
  claimOptionsFor,
  claimQuantityLabel,
  formatRoomTicks,
} from "@/lib/assignment-room-quantity";
import type {
  AssignmentRoomClaim,
  AssignmentRoomItem,
  AssignmentRoomParticipant,
} from "@/types/assignment-room";

const UNIT_TICKS = 1_000 * ROOM_TICKS_PER_MILLIUNIT;

interface RoomItemClaimProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  getReturnFocus: () => HTMLElement | null;
  selfParticipantId: string;
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
  previewCents: (participantId: string, ticks: number) => number | null;
  onSubmit: (
    participantId: string,
    ticks: number,
    expectedItemRevision: number,
  ) => Promise<boolean>;
}

export function RoomItemClaim({
  open,
  onOpenChange,
  getReturnFocus,
  selfParticipantId,
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
  previewCents,
  onSubmit,
}: RoomItemClaimProps) {
  const capacityTicks = item.quantityMilliunits * ROOM_TICKS_PER_MILLIUNIT;
  const multiUnit = item.quantityMilliunits >= 2_000;
  const target =
    participants.find(
      (participant) => participant.id === targetParticipantId,
    ) ?? null;
  const targetActive = target !== null && !target.removed;
  const labels = displayNames(participants.filter((person) => !person.removed).map((person) => ({ ...person, name: person.displayName })), { style: "short", viewerId: selfParticipantId, selfLabel: "você" });
  const savedTicks = useMemo(
    () =>
      claims.find((claim) => claim.participantId === targetParticipantId)
        ?.ticks ?? 0,
    [claims, targetParticipantId],
  );
  const maximumTicks = savedTicks + availableTicks;
  const claimOptions = useMemo(
    () => claimOptionsFor(item.quantityMilliunits, maximumTicks),
    [item.quantityMilliunits, maximumTicks],
  );
  const [draftTicks, setDraftTicks] = useState<number | null>(null);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [collision, setCollision] = useState<string | null>(null);
  const [draftItemRevision, setDraftItemRevision] = useState<number | null>(
    null,
  );
  const savingRef = useRef(false);
  const wasOpenRef = useRef(false);
  const draftKeyRef = useRef<string | null>(null);
  const draftKey = `${item.id}:${targetParticipantId}`;

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (!wasOpenRef.current || draftKeyRef.current !== draftKey) {
      const initialTicks =
        savedTicks > 0
          ? savedTicks
          : claimOptions.kind === "stepper" && claimOptions.maxUnits > 0
            ? UNIT_TICKS
            : null;
      setDraftTicks(initialTicks);
      setTouched(false);
      setDraftItemRevision(item.revision);
      setSaveError(null);
      setCollision(null);
      draftKeyRef.current = draftKey;
    }
    wasOpenRef.current = true;
  }, [claimOptions, draftKey, item.revision, open, savedTicks]);

  useEffect(() => {
    if (!open || draftTicks === null || draftTicks <= maximumTicks) return;
    setDraftTicks(null);
    setCollision(
      availableTicks > 0
        ? `Não está mais disponível. Sobrou ${formatRoomTicks(availableTicks)}.`
        : "Alguém pegou antes de você.",
    );
  }, [availableTicks, draftTicks, maximumTicks, open]);

  const unsaved = touched && draftTicks !== null && draftTicks !== savedTicks;
  useEffect(() => {
    if (!open || !unsaved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [open, unsaved]);

  const stale =
    draftItemRevision !== null && item.revision !== draftItemRevision;
  const unchanged = draftTicks !== null && draftTicks === savedTicks;
  const previewTicks =
    draftTicks === 0 && savedTicks > 0 ? savedTicks : draftTicks;
  const previewAmount =
    previewTicks === null
      ? null
      : previewCents(targetParticipantId, previewTicks);
  const canSave =
    !disabled &&
    !pending &&
    !saving &&
    !stale &&
    targetActive &&
    draftTicks !== null &&
    previewAmount !== null &&
    !unchanged;
  const scopedError =
    error?.participantId === targetParticipantId ? error.message : null;
  const message = !targetActive
    ? "Essa pessoa não está mais na sala."
    : collision ?? scopedError ?? saveError;

  function chooseTicks(ticks: number) {
    if (stale || !targetActive) return;
    haptics.selectionChanged();
    setTouched(true);
    setDraftTicks(ticks);
    setCollision(null);
    setSaveError(null);
  }

  function refreshDraft() {
    if (saving) return;
    const refreshedTicks =
      savedTicks > 0
        ? savedTicks
        : claimOptions.kind === "stepper" && claimOptions.maxUnits > 0
          ? UNIT_TICKS
          : null;
    setDraftTicks(refreshedTicks);
    setTouched(false);
    setDraftItemRevision(item.revision);
    setCollision(null);
    setSaveError(null);
  }

  async function confirm() {
    if (
      !canSave ||
      draftTicks === null ||
      savingRef.current ||
      draftItemRevision === null
    ) {
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await onSubmit(
        targetParticipantId,
        draftTicks,
        draftItemRevision,
      );
      if (saved) {
        haptics.success();
        onOpenChange(false);
        return;
      }
      haptics.error();
      setSaveError(
        error?.participantId === targetParticipantId
          ? error.message
          : "Não foi possível salvar. Tente novamente.",
      );
    } catch {
      haptics.error();
      setSaveError("Não foi possível salvar. Tente novamente.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const hostTargetLabel = labels.get(targetParticipantId) ?? "pessoa removida";
  const question = canSelectParticipant
    ? multiUnit
      ? "Quantos?"
      : "Quanto?"
    : multiUnit
      ? "Quantos você consumiu?"
      : "Quanto você consumiu?";
  const stepperUnits =
    draftTicks !== null && draftTicks >= UNIT_TICKS
      ? Math.floor(draftTicks / UNIT_TICKS)
      : 1;
  const removing = draftTicks === 0 && savedTicks > 0;
  const actionQuantityLabel = draftTicks === null
    ? null
    : claimQuantityLabel(item.quantityMilliunits, draftTicks);
  const Surface = canSelectParticipant ? Popover : Dialog;
  const Content = canSelectParticipant ? PopoverContent : DialogContent;
  const Title = canSelectParticipant ? PopoverTitle : DialogTitle;
  const Description = canSelectParticipant ? PopoverDescription : DialogDescription;

  return (
    <Surface
      open={open}
      dismissable={!saving}
      onOpenChange={(next) => {
        if (saving) return;
        if (!next && unsaved && !window.confirm("Descartar esta escolha não salva?")) return;
        onOpenChange(next);
      }}
    >
      <Content
        finalFocus={getReturnFocus}
        {...(canSelectParticipant ? { anchor: getReturnFocus() } : {})}
        className="gap-3 sm:px-5 sm:py-4"
      >
        <DialogHeader className="gap-0.5">
          <div className="flex items-baseline justify-between gap-3">
            <Title className="min-w-0 break-words pr-1 text-base leading-6 font-semibold tracking-tight">
              {item.description}
            </Title>
            <Money
              cents={item.totalPriceCents}
              className="shrink-0 text-sm font-semibold"
            />
          </div>
          <Description className="text-xs text-muted-foreground leading-4">
            {multiUnit ? (
              <>
                Restam {formatRoomTicks(availableTicks)} de{" "}
                {formatRoomTicks(capacityTicks)} ·{" "}
                <Money cents={item.unitPriceCents} className="font-normal" /> cada
              </>
            ) : availableTicks === 0 ? (
              "Tudo com dono"
            ) : availableTicks < capacityTicks ? (
              <>Falta {formatRoomTicks(availableTicks)}</>
            ) : (
              "Inteira"
            )}
          </Description>
        </DialogHeader>
        {canSelectParticipant && (
          <section aria-labelledby="claim-target-label">
            <p id="claim-target-label" className="mb-1.5 text-xs font-medium text-muted-foreground">
              Pra quem?
            </p>
            <div
              className="flex flex-wrap gap-1.5"
              role="radiogroup"
              aria-label="Pra quem?"
            >
              {participants
                .filter((participant) => !participant.removed)
                .map((participant) => {
                  const selected = participant.id === targetParticipantId;
                  const label = participant.id === selfParticipantId ? "Você" : labels.get(participant.id);
                  return (
                    <Button
                      key={participant.id}
                      type="button"
                      variant="outline"
                      size="sm"
                      role="radio"
                      aria-label={label}
                      aria-checked={selected}
                      className={cn(
                        "h-8 shrink-0 gap-1.5 rounded-[0.5rem] px-2.5 text-xs font-medium transition-colors",
                        selected
                          ? "border-primary/30 bg-primary/15 text-primary-text hover:bg-primary/20"
                          : "border-border bg-card text-foreground hover:bg-muted",
                      )}
                      disabled={saving}
                      onClick={() => {
                        if (participant.id === targetParticipantId) return;
                        if (unsaved && !window.confirm("Descartar esta escolha não salva?")) return;
                        haptics.selectionChanged();
                        onTargetChange(participant.id);
                      }}
                    >
                      {participant.isGuest
                        ? <GuestAvatar id={participant.id} name={participant.displayName} size="xs" />
                        : <UserAvatar id={participant.id} name={participant.displayName} avatarUrl={participant.avatarUrl} size="xs" />}
                      <span title={participant.displayName} className="max-w-28 truncate">{label}</span>
                    </Button>
                  );
                })}
            </div>
          </section>
        )}

        <section aria-labelledby="claim-quantity-label">
          <p
            id="claim-quantity-label"
            className="mb-1.5 text-xs font-medium text-muted-foreground"
          >
            {question}
          </p>

          {claimOptions.kind === "whole" && (
            <div className="flex flex-wrap items-center gap-1.5">
              {claimOptions.options
                .filter((option) => !option.label.startsWith("O resto"))
                .map((option) => {
                  const selected = draftTicks === option.ticks;
                  return (
                    <Button
                      key={option.ticks}
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-pressed={selected}
                      className={cn(
                        "h-8 min-w-8 shrink-0 rounded-[0.5rem] px-2.5 text-xs font-semibold",
                        selected
                          ? "border-primary/30 bg-primary/15 text-primary-text hover:bg-primary/20"
                          : "border-border bg-card text-foreground hover:bg-muted",
                      )}
                      disabled={saving || stale || !targetActive}
                      onClick={() => chooseTicks(option.ticks)}
                    >
                      {option.label}
                    </Button>
                  );
                })}
              <span className="px-1 text-xs text-muted-foreground">
                de {formatRoomTicks(claimOptions.total * UNIT_TICKS)}
              </span>
              {claimOptions.options
                .filter((option) => option.label.startsWith("O resto"))
                .map((option) => {
                  const selected = draftTicks === option.ticks;
                  return (
                    <Button
                      key={option.ticks}
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-pressed={selected}
                      className={cn(
                        "h-8 shrink-0 rounded-[0.5rem] px-2.5 text-xs font-semibold",
                        selected
                          ? "border-primary/30 bg-primary/15 text-primary-text hover:bg-primary/20"
                          : "border-border bg-card text-foreground hover:bg-muted",
                      )}
                      disabled={saving || stale || !targetActive}
                      onClick={() => chooseTicks(option.ticks)}
                    >
                      {option.label}
                    </Button>
                  );
                })}
            </div>
          )}

          {claimOptions.kind === "stepper" && (
            <div
              className="flex items-center gap-2"
              role="group"
              aria-label="Quantidade"
            >
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="size-8 rounded-[0.5rem] p-0"
                aria-label="Diminuir uma unidade"
                disabled={
                  saving || stale || !targetActive || stepperUnits <= 1
                }
                onClick={() => chooseTicks((stepperUnits - 1) * UNIT_TICKS)}
              >
                <Minus aria-hidden="true" className="size-3.5" />
              </Button>
              <span className="min-w-8 text-center text-sm font-semibold tabular-nums">
                {stepperUnits}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="size-8 rounded-[0.5rem] p-0"
                aria-label="Aumentar uma unidade"
                disabled={
                  saving ||
                  stale ||
                  !targetActive ||
                  stepperUnits >= claimOptions.maxUnits
                }
                onClick={() => chooseTicks((stepperUnits + 1) * UNIT_TICKS)}
              >
                <Plus aria-hidden="true" className="size-3.5" />
              </Button>
              <span className="text-xs text-muted-foreground">
                de {formatRoomTicks(claimOptions.total * UNIT_TICKS)}
              </span>
            </div>
          )}

          {claimOptions.kind === "fractions" && (
            <div className="flex flex-wrap gap-1.5">
              {claimOptions.options.map((option) => {
                const selected = draftTicks === option.ticks;
                return (
                  <Button
                    key={option.ticks}
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-pressed={selected}
                    className={cn(
                      "h-8 min-w-8 shrink-0 rounded-[0.5rem] px-2.5 text-xs font-semibold",
                      selected
                        ? "border-primary/30 bg-primary/15 text-primary-text hover:bg-primary/20"
                        : "border-border bg-card text-foreground hover:bg-muted",
                    )}
                    disabled={saving || stale || !targetActive}
                    onClick={() => chooseTicks(option.ticks)}
                  >
                    {option.label}
                  </Button>
                );
              })}
            </div>
          )}
        </section>

        {message && (
          <p role="alert" className="text-sm text-destructive-text">
            {message}
          </p>
        )}
        {stale && (
          <p className="flex min-h-11 items-center gap-1 text-sm text-muted-foreground">
            <span>A sala mudou.</span>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 px-2 font-semibold text-primary-text"
              disabled={saving || !targetActive}
              onClick={refreshDraft}
            >
              Atualizar
            </Button>
          </p>
        )}

        <div className="space-y-1">
          <Button
            type="button"
            className="h-10 w-full text-sm font-semibold"
            disabled={!canSave}
            onClick={confirm}
          >
            {saving && <Loader2 className="animate-spin" aria-hidden="true" />}
            {saving ? (
              "Salvando..."
            ) : removing && previewAmount !== null ? (
              <>
                Tirar · libera <Money cents={previewAmount} />
              </>
            ) : actionQuantityLabel !== null && previewAmount !== null ? (
              <>
                {canSelectParticipant
                  ? `Dar ${actionQuantityLabel} pra ${hostTargetLabel} · `
                  : `Peguei ${actionQuantityLabel} · `}
                <Money cents={previewAmount} />
              </>
            ) : (
              "Escolha uma quantidade"
            )}
          </Button>

          {savedTicks > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-full text-xs font-semibold text-destructive-text hover:bg-destructive/10 hover:text-destructive-text"
              aria-label={
                canSelectParticipant
                  ? `Remover escolha de ${target?.displayName}`
                  : "Remover minha escolha"
              }
              disabled={saving || stale || !targetActive}
              onClick={() => chooseTicks(0)}
            >
              {canSelectParticipant
                ? targetParticipantId === selfParticipantId ? "Tirar da minha parte" : `Tirar de ${hostTargetLabel}`
                : "Tirar da minha parte"}
            </Button>
          )}
        </div>
      </Content>
    </Surface>
  );
}
