"use client";

import { Loader2, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Money } from "@/components/shared/money";
import { UserAvatar } from "@/components/shared/user-avatar";
import { GuestAvatar } from "@/components/shared/guest-avatar";
import { displayNames } from "@/lib/people";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ROOM_TICKS_PER_MILLIUNIT } from "@/lib/assignment-room-money";
import {
  claimOptionsFor,
  claimQuantityLabel,
  formatRoomTicks,
} from "@/lib/assignment-room-quantity";
import { cn } from "@/lib/utils";
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
  const selfParticipantId = participants.find(
    (participant) => participant.ordinal === 0,
  )?.id;
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

  return (
    <Dialog
      open={open}
      dismissable={!saving}
      onOpenChange={(next) => {
        if (saving) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        finalFocus={getReturnFocus}
        variant="sheet"
        className="gap-5 sm:px-6 sm:pt-5 sm:pb-6"
      >
        <DialogHeader className="gap-0">
          <div className="flex items-baseline justify-between gap-3">
            <DialogTitle className="min-w-0 truncate pr-1 text-lg leading-7 font-semibold tracking-tight">
              {item.description}
            </DialogTitle>
            <Money
              cents={item.totalPriceCents}
              className="shrink-0 text-base"
            />
          </div>
          <DialogDescription className="leading-5">
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
          </DialogDescription>
        </DialogHeader>

        {canSelectParticipant && (
          <section aria-labelledby="claim-target-label">
            <p id="claim-target-label" className="mb-2 font-semibold">
              Pra quem?
            </p>
            <div
              className="flex gap-2 overflow-x-auto pb-1"
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
                      role="radio"
                      aria-label={label}
                      aria-checked={selected}
                      className={cn(
                        "min-h-11 shrink-0 gap-1.5 rounded-full py-1 pr-3 pl-1.5",
                        selected &&
                          "border-primary bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                      )}
                      disabled={saving}
                      onClick={() => onTargetChange(participant.id)}
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
            className="mb-3 text-base font-semibold"
          >
            {question}
          </p>

          {claimOptions.kind === "whole" && (
            <div className="flex flex-wrap items-center gap-2">
              {claimOptions.options
                .filter((option) => !option.label.startsWith("O resto"))
                .map((option) => {
                  const selected = draftTicks === option.ticks;
                  return (
                    <Button
                      key={option.ticks}
                      type="button"
                      variant="outline"
                      aria-pressed={selected}
                      className={cn(
                        "size-12 rounded-full p-0 text-base font-semibold",
                        selected &&
                          "border-primary bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                      )}
                      disabled={saving || stale || !targetActive}
                      onClick={() => chooseTicks(option.ticks)}
                    >
                      {option.label}
                    </Button>
                  );
                })}
              <span className="px-1 text-base text-muted-foreground">
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
                      aria-pressed={selected}
                      className={cn(
                        "min-h-11 rounded-full px-4 font-semibold",
                        selected &&
                          "border-primary bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
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
              className="flex items-center gap-3"
              role="group"
              aria-label="Quantidade"
            >
              <Button
                type="button"
                size="icon-lg"
                variant="outline"
                className="rounded-full"
                aria-label="Diminuir uma unidade"
                disabled={
                  saving || stale || !targetActive || stepperUnits <= 1
                }
                onClick={() => chooseTicks((stepperUnits - 1) * UNIT_TICKS)}
              >
                <Minus aria-hidden="true" />
              </Button>
              <span className="min-w-10 text-center text-lg font-semibold tabular-nums">
                {stepperUnits}
              </span>
              <Button
                type="button"
                size="icon-lg"
                variant="outline"
                className="rounded-full"
                aria-label="Aumentar uma unidade"
                disabled={
                  saving ||
                  stale ||
                  !targetActive ||
                  stepperUnits >= claimOptions.maxUnits
                }
                onClick={() => chooseTicks((stepperUnits + 1) * UNIT_TICKS)}
              >
                <Plus aria-hidden="true" />
              </Button>
              <span className="text-base text-muted-foreground">
                de {formatRoomTicks(claimOptions.total * UNIT_TICKS)}
              </span>
            </div>
          )}

          {claimOptions.kind === "fractions" && (
            <div className="flex flex-wrap gap-2">
              {claimOptions.options.map((option) => {
                const selected = draftTicks === option.ticks;
                return (
                  <Button
                    key={option.ticks}
                    type="button"
                    variant="outline"
                    aria-pressed={selected}
                    className={cn(
                      "min-h-11 rounded-full px-4 font-semibold",
                      selected &&
                        "border-primary bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
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
            className="min-h-12 w-full rounded-lg text-base font-bold"
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
              className="min-h-11 w-full text-sm font-semibold text-destructive-text hover:text-destructive-text"
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
      </DialogContent>
    </Dialog>
  );
}
