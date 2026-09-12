"use client";

import { useEffect, useRef, useState } from "react";
import { DivisionModePills } from "@/components/bill/division-mode-pills";
import { DivisionSlider } from "@/components/bill/division-slider";
import { FixedAmountHelpers } from "@/components/bill/fixed-amount-helpers";
import { PercentHelpers } from "@/components/bill/percent-helpers";
import { GuestAvatar } from "@/components/shared/guest-avatar";
import { Money } from "@/components/shared/money";
import { PersonLabel } from "@/components/shared/person-label";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useInvitedUserIds } from "@/hooks/use-invited-user-ids";
import { allocateEvenly, parseAllocationPercentText, parseExpenseCentsText } from "@/lib/expense-money";
import {
  FULL_PERCENT_BASIS_POINTS,
  centsText,
  clampPercentDigits,
  computeDivision,
  divisionStatusText,
  percentText,
  type ItemDivisionMode,
  type ItemDivisionValue,
} from "@/lib/item-division";
import { cn } from "@/lib/utils";

export interface ItemDivisionParticipant {
  id: string;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
  isGuest: boolean;
}

export interface ItemDivisionEditorProps {
  itemId: string;
  itemName: string;
  itemCents: number;
  participants: ItemDivisionParticipant[];
  value: ItemDivisionValue | null;
  onSave: (value: ItemDivisionValue) => void;
  onClose: () => void;
}

function ShareCell({
  shareCents,
  percentInput,
  fixedInput,
  inputLabel,
  onFocus,
  onPercentChange,
  onFixedChange,
}: {
  shareCents: number | null;
  percentInput: string | null;
  fixedInput: string | null;
  inputLabel: string;
  onFocus: () => void;
  onPercentChange: (value: string) => void;
  onFixedChange: (value: string) => void;
}) {
  if (percentInput !== null) {
    return (
      <Input
        value={percentInput}
        onChange={(event) => onPercentChange(clampPercentDigits(event.target.value.replace(/\D/g, "")))}
        onFocus={onFocus}
        inputMode="numeric"
        aria-label={inputLabel}
        className="h-11 w-24 bg-card text-right font-mono"
      />
    );
  }
  if (fixedInput !== null) {
    return (
      <Input
        value={fixedInput}
        onChange={(event) => onFixedChange(event.target.value)}
        onFocus={onFocus}
        inputMode="decimal"
        aria-label={inputLabel}
        className="h-11 w-24 bg-card text-right font-mono"
      />
    );
  }
  if (shareCents === null) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  return <Money cents={shareCents} className="text-sm" />;
}

function percentSliderValue(text: string): number {
  const parsed = parseAllocationPercentText(text);
  return parsed.ok ? Math.round(parsed.value / 100) : 0;
}

function fixedSliderValue(text: string): number {
  const parsed = parseExpenseCentsText(text, { format: "plain_decimal", zeroPolicy: "allow" });
  return parsed.ok ? parsed.value : 0;
}
const AUTOSAVE_DELAY_MS = 400;

function divisionKey(value: ItemDivisionValue | null): string {
  if (!value) return "";
  const shares = [...value.shares]
    .sort((a, b) => (a.participantId < b.participantId ? -1 : 1))
    .map((share) => `${share.participantId}:${share.cents}:${share.basisPoints ?? ""}`)
    .join("|");
  return `${value.mode}#${shares}`;
}

export function ItemDivisionEditor({
  itemId,
  itemName,
  itemCents,
  participants,
  value,
  onSave,
  onClose,
}: ItemDivisionEditorProps) {
  const participantIds = participants.map((participant) => participant.id);
  const [mode, setMode] = useState<ItemDivisionMode>(value?.mode ?? "equal");
  const [rawSelectedIds, setSelectedIds] = useState<string[]>(() => {
    if (!value) return [];
    const saved = new Set(value.shares.map((share) => share.participantId));
    return participantIds.filter((id) => saved.has(id));
  });
  const selectedIds = rawSelectedIds.filter((id) => participantIds.includes(id));
  const [lastTouchedId, setLastTouchedId] = useState<string | null>(null);
  const [percentTexts, setPercentTexts] = useState<Record<string, string>>(() => {
    const texts: Record<string, string> = {};
    for (const share of value?.shares ?? []) {
      if (share.basisPoints !== undefined) texts[share.participantId] = percentText(share.basisPoints);
    }
    return texts;
  });
  const [fixedTexts, setFixedTexts] = useState<Record<string, string>>(() => {
    const texts: Record<string, string> = {};
    for (const share of value?.shares ?? []) {
      texts[share.participantId] = centsText(share.cents);
    }
    return texts;
  });

  const seedBase = selectedIds.length > 0 ? selectedIds : participantIds;
  const seededPercentTexts: Record<string, string> = {};
  const percentSeed = allocateEvenly(FULL_PERCENT_BASIS_POINTS / 100, seedBase.length);
  if (percentSeed.ok) {
    seedBase.forEach((id, index) => {
      seededPercentTexts[id] = percentText(percentSeed.value[index] * 100);
    });
  }
  const seededFixedTexts: Record<string, string> = {};
  const fixedSeed = allocateEvenly(itemCents, seedBase.length);
  if (fixedSeed.ok) {
    seedBase.forEach((id, index) => {
      seededFixedTexts[id] = centsText(fixedSeed.value[index]);
    });
  }
  const percentValues: Record<string, string> = {};
  const fixedValues: Record<string, string> = {};
  for (const id of participantIds) {
    percentValues[id] = percentTexts[id] ?? seededPercentTexts[id] ?? percentText(0);
    fixedValues[id] = fixedTexts[id] ?? seededFixedTexts[id] ?? centsText(0);
  }

  const contributes = (id: string): boolean => {
    if (mode === "percent") {
      const parsed = parseAllocationPercentText(percentValues[id]);
      return !parsed.ok || parsed.value > 0;
    }
    const parsed = parseExpenseCentsText(fixedValues[id], {
      format: "plain_decimal",
      zeroPolicy: "allow",
    });
    return !parsed.ok || parsed.value > 0;
  };
  const includedIds =
    mode === "equal" ? selectedIds : participantIds.filter((id) => contributes(id));

  const division = computeDivision(itemCents, mode, includedIds, percentValues, fixedValues);
  const percentSliderValues: Record<string, number> = {};
  for (const id of participantIds) percentSliderValues[id] = percentSliderValue(percentValues[id]);
  const fixedSliderValues: Record<string, number> = {};
  for (const id of participantIds) fixedSliderValues[id] = fixedSliderValue(fixedValues[id]);
  let fixedSum = 0;
  for (const id of participantIds) fixedSum += fixedSliderValues[id];
  let percentSum = 0;
  for (const id of participantIds) percentSum += percentSliderValues[id];
  const percentRemainingBasisPoints = Math.max(0, FULL_PERCENT_BASIS_POINTS - percentSum * 100);
  const helpersTargetId =
    lastTouchedId !== null && participantIds.includes(lastTouchedId)
      ? lastTouchedId
      : participantIds.length > 0
        ? participantIds[0]
        : null;

  const toggleParticipant = (id: string) =>
    setSelectedIds((ids) =>
      ids.includes(id)
        ? ids.filter((other) => other !== id)
        : participantIds.filter((member) => member === id || ids.includes(member)),
    );

  const seedEvenly = (targetMode: ItemDivisionMode, ids: readonly string[]) => {
    if (targetMode === "percent") {
      const seeded = allocateEvenly(FULL_PERCENT_BASIS_POINTS / 100, ids.length);
      setPercentTexts(() => {
        const next: Record<string, string> = {};
        for (const id of participantIds) next[id] = percentText(0);
        if (seeded.ok) ids.forEach((id, index) => {
          next[id] = percentText(seeded.value[index] * 100);
        });
        return next;
      });
      return;
    }
    const seeded = allocateEvenly(itemCents, ids.length);
    setFixedTexts(() => {
      const next: Record<string, string> = {};
      for (const id of participantIds) next[id] = centsText(0);
      if (seeded.ok) ids.forEach((id, index) => {
        next[id] = centsText(seeded.value[index]);
      });
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedIds([...participantIds]);
    if (mode !== "equal") seedEvenly(mode, participantIds);
  };

  const handleSelectNone = () => {
    setSelectedIds([]);
    if (mode !== "equal") seedEvenly(mode, []);
  };

  const draft: ItemDivisionValue | null = division.ok
    ? {
        mode,
        shares: includedIds.map((id) => ({
          participantId: id,
          cents: division.centsById[id],
          ...(division.basisPointsById ? { basisPoints: division.basisPointsById[id] } : {}),
        })),
      }
    : null;
  const draftKey = divisionKey(draft);

  const onSaveRef = useRef(onSave);
  const draftRef = useRef(draft);
  const savedKeyRef = useRef(divisionKey(value));
  const timerRef = useRef<number | null>(null);

  const flush = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = draftRef.current;
    const pendingKey = divisionKey(pending);
    if (pending !== null && pendingKey !== savedKeyRef.current) {
      savedKeyRef.current = pendingKey;
      onSaveRef.current(pending);
    }
  };
  const flushRef = useRef(flush);

  useEffect(() => {
    onSaveRef.current = onSave;
    draftRef.current = draft;
    flushRef.current = flush;
  });

  useEffect(() => {
    if (draftKey === "" || draftKey === savedKeyRef.current) return;
    timerRef.current = window.setTimeout(() => flushRef.current(), AUTOSAVE_DELAY_MS);
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [draftKey]);

  useEffect(() => () => flushRef.current(), []);

  const handleDone = () => {
    flush();
    onClose();
  };

  const status = divisionStatusText(division, mode);
  const invitedUserIds = useInvitedUserIds();

  return (
    <div className="space-y-3 border-t border-dashed border-border bg-muted/30 px-4 pt-3 pb-4">
      <DivisionModePills
        value={mode}
        onChange={setMode}
        groupLabel={`Modo de divisão de ${itemName}`}
        idPrefix={`modo-divisao-${itemId}`}
      />
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Pessoas</p>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="min-h-11" onClick={handleSelectAll}>
            Todos
          </Button>
          <Button variant="ghost" size="sm" className="min-h-11" onClick={handleSelectNone}>
            Nenhum
          </Button>
        </div>
      </div>
      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-input bg-card">
        {participants.map((participant) => {
          const selected = includedIds.includes(participant.id);
          const shareId = `${itemId}-share-${participant.id}`;
          const identity = (
            <>
              {participant.isGuest ? (
                <GuestAvatar size="sm" />
              ) : (
                <UserAvatar name={participant.name} avatarUrl={participant.avatarUrl} size="sm" />
              )}
              <PersonLabel
                name={participant.name}
                handle={participant.handle}
                className="flex-1"
                nameClassName="text-sm"
              />
              {!participant.isGuest && invitedUserIds.has(participant.id) && (
                <Badge variant="secondary" className="shrink-0">
                  Convite pendente
                </Badge>
              )}
            </>
          );
          const shareCell = (
            <span id={shareId}>
              <ShareCell
                shareCents={selected && division.ok ? division.centsById[participant.id] : null}
                percentInput={mode === "percent" ? percentValues[participant.id] : null}
                fixedInput={mode === "fixed" ? fixedValues[participant.id] : null}
                inputLabel={
                  mode === "percent"
                    ? `Percentual de ${participant.name}${participant.handle ? ` (@${participant.handle})` : ""} em ${itemName}`
                    : `Valor fixo de ${participant.name}${participant.handle ? ` (@${participant.handle})` : ""} em ${itemName}`
                }
                onFocus={() => setLastTouchedId(participant.id)}
                onPercentChange={(next) =>
                  setPercentTexts((prev) => ({ ...prev, [participant.id]: next }))
                }
                onFixedChange={(next) =>
                  setFixedTexts((prev) => ({ ...prev, [participant.id]: next }))
                }
              />
            </span>
          );
          if (mode === "equal") {
            return (
              <button
                key={participant.id}
                type="button"
                role="switch"
                aria-checked={selected}
                aria-label={`Incluir ${participant.name}${participant.handle ? ` (@${participant.handle})` : ""} em ${itemName}`}
                aria-describedby={shareId}
                onClick={() => toggleParticipant(participant.id)}
                className={cn(
                  "flex min-h-12 w-full min-w-0 items-center gap-3 px-3 py-2 text-left transition-colors",
                  selected ? "bg-primary/10" : "opacity-60",
                )}
              >
                {identity}
                {shareCell}
              </button>
            );
          }
          return (
            <div key={participant.id} className="flex min-h-12 min-w-0 flex-wrap items-center gap-3 px-3 py-2">
              {identity}
              {shareCell}
              <DivisionSlider
                ariaLabel={
                  mode === "percent"
                    ? `Percentual deslizante de ${participant.name}${participant.handle ? ` (@${participant.handle})` : ""} em ${itemName}`
                    : `Valor deslizante de ${participant.name}${participant.handle ? ` (@${participant.handle})` : ""} em ${itemName}`
                }
                className="basis-full"
                min={0}
                max={mode === "percent" ? FULL_PERCENT_BASIS_POINTS / 100 : itemCents}
                step={mode === "percent" ? 1 : "any"}
                snap={mode === "percent" ? { step: 5, threshold: 2 } : undefined}
                value={mode === "percent" ? percentSliderValues[participant.id] : fixedSliderValues[participant.id]}
                onChange={(next) => {
                  setLastTouchedId(participant.id);
                  if (mode === "percent") {
                    setPercentTexts((prev) => ({ ...prev, [participant.id]: percentText(next * 100) }));
                    return;
                  }
                  setFixedTexts((prev) => ({ ...prev, [participant.id]: centsText(next) }));
                }}
              />
              {mode === "fixed" && participant.id === helpersTargetId && (
                <div className="basis-full">
                  <FixedAmountHelpers
                    totalCents={itemCents}
                    remainingCents={Math.max(0, itemCents - fixedSum)}
                    onAdd={(deltaCents) => {
                      if (helpersTargetId === null) return;
                      const current = fixedSliderValues[helpersTargetId];
                      setFixedTexts((prev) => ({ ...prev, [helpersTargetId]: centsText(current + deltaCents) }));
                    }}
                  />
                </div>
              )}
              {mode === "percent" && participant.id === helpersTargetId && (
                <div className="basis-full">
                  <PercentHelpers
                    remainingBasisPoints={percentRemainingBasisPoints}
                    onAdd={(deltaBasisPoints) => {
                      if (helpersTargetId === null) return;
                      const current = percentSliderValues[helpersTargetId] * 100;
                      setPercentTexts((prev) => ({
                        ...prev,
                        [helpersTargetId]: percentText(Math.min(FULL_PERCENT_BASIS_POINTS, current + deltaBasisPoints)),
                      }));
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p
        aria-live="polite"
        className={cn("text-xs font-semibold", division.ok ? "text-muted-foreground" : "text-destructive")}
      >
        {status}
      </p>
      {division.ok && (
        <p className="text-xs text-muted-foreground">Salvo automaticamente</p>
      )}
      <Button className="h-11 w-full" onClick={handleDone}>
        Pronto
      </Button>
    </div>
  );
}
