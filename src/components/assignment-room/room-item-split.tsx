"use client";

import { Equal, SlidersHorizontal, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PersonToggle } from "@/components/bill/person-toggle";
import { DivisionSlider } from "@/components/bill/division-slider";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/shared/money";
import { UserAvatar } from "@/components/shared/user-avatar";
import { GuestAvatar } from "@/components/shared/guest-avatar";
import { haptics } from "@/hooks/use-haptics";
import {
  claimTicksForFraction,
  ROOM_TICKS_PER_MILLIUNIT,
  ROOM_TICKS_PER_UNIT,
} from "@/lib/assignment-room-money";
import { claimQuantityLabel } from "@/lib/assignment-room-quantity";
import {
  changedShares,
  isEvenSplit,
  sliderTicks,
  shareToPercent,
  splitDraftStatus,
  splitTicksEvenly,
  type SplitDraftStatus,
} from "@/lib/assignment-room-split";
import { cn } from "@/lib/utils";
import type {
  AssignmentItemShare,
  AssignmentRoomClaim,
  AssignmentRoomItem,
  AssignmentRoomParticipant,
} from "@/types/assignment-room";

type SplitMode = "equal" | "custom";
type SplitHelper = "unit" | "rest" | 2 | 3 | 4;

const MODE_OPTIONS = [
  { key: "equal", label: "Igual", Icon: Equal },
  { key: "custom", label: "Ajustar", Icon: SlidersHorizontal },
] as const;

const FRACTION_HELPERS = [
  { denominator: 2, label: "½" },
  { denominator: 3, label: "⅓" },
  { denominator: 4, label: "¼" },
] as const;

export interface RoomItemSplitProps {
  item: AssignmentRoomItem;
  participants: AssignmentRoomParticipant[];
  claims: AssignmentRoomClaim[];
  selfParticipantId: string;
  labels: ReadonlyMap<string, string>;
  focusParticipantId: string | null;
  pending: boolean;
  disabled: boolean;
  error: string | null;
  previewCents: (shares: readonly AssignmentItemShare[]) => ReadonlyMap<string, number> | null;
  onSave: (shares: AssignmentItemShare[], expectedItemRevision: number) => Promise<boolean>;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
}

interface SplitPerson {
  person: AssignmentRoomParticipant;
  label: string;
  selected: boolean;
  sweepDegrees: number;
  quantity: string;
  amount: number | undefined;
  sliderValue: number;
}

function initialMode(capacity: number, shares: AssignmentItemShare[], focus: string | null): SplitMode {
  if (focus) return "custom";
  if (shares.length === 0 || isEvenSplit(capacity, shares)) return "equal";
  return "custom";
}

function SplitModeToggle({ value, onChange }: {
  value: SplitMode;
  onChange: (mode: SplitMode) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Como dividir"
      className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1"
    >
      {MODE_OPTIONS.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          onClick={() => onChange(key)}
          className={cn(
            "flex min-h-11 items-center justify-center gap-2 rounded-lg text-sm font-semibold focus-visible:outline-2 focus-visible:outline-primary",
            value === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
          )}
        >
          <Icon
            aria-hidden="true"
            className="size-4"
          />
          {label}
        </button>
      ))}
    </div>
  );
}

function SplitPeopleGrid({ people, onToggle, onEveryone, onClear }: {
  people: SplitPerson[];
  onToggle: (participantId: string) => void;
  onEveryone: () => void;
  onClear: () => void;
}) {
  const count = people.filter((person) => person.selected).length;
  let summary = "Quem divide?";
  if (count === 1) summary = "1 pessoa";
  if (count > 1) summary = `${count} pessoas`;

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{summary}</span>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11"
            onClick={onEveryone}
          >
            Todos
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11"
            onClick={onClear}
          >
            Limpar
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-6 gap-x-1 gap-y-3 pt-1 sm:grid-cols-8">
        {people.map(({ person, label, selected, sweepDegrees }) => (
          <div
            key={person.id}
            className="flex min-w-0 flex-col items-center gap-1"
          >
            <PersonToggle
              id={person.id}
              name={person.displayName}
              label={label}
              avatarUrl={person.avatarUrl}
              isGuest={person.isGuest}
              selected={selected}
              arc={{ startDegrees: 0, sweepDegrees }}
              onToggle={() => onToggle(person.id)}
            />
            <span
              title={person.displayName}
              className="w-full truncate text-center text-xs font-medium"
            >
              {label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SplitSliders({ people, multiUnit, maximum, activeName, onFocus, onChange, onEqualize, onHelper }: {
  people: SplitPerson[];
  multiUnit: boolean;
  maximum: number;
  activeName: string | null;
  onFocus: (participantId: string) => void;
  onChange: (participantId: string, value: number) => void;
  onEqualize: () => void;
  onHelper: (helper: SplitHelper) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {multiUnit ? "Por unidade" : "Por proporção"}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11"
          onClick={onEqualize}
        >
          Igualar
        </Button>
      </div>
      {people.map(({ person, label, quantity, amount, sliderValue }) => (
        <div
          key={person.id}
          data-person-id={person.id}
          onFocus={() => onFocus(person.id)}
          onPointerDown={() => onFocus(person.id)}
          className="rounded-lg px-1 pt-1"
        >
          <div className="flex items-center gap-2 text-sm">
            {person.isGuest ? (
              <GuestAvatar
                id={person.id}
                name={person.displayName}
                size="xs"
              />
            ) : (
              <UserAvatar
                id={person.id}
                name={person.displayName}
                avatarUrl={person.avatarUrl}
                size="xs"
              />
            )}
            <span
              title={person.displayName}
              className="min-w-0 flex-1 truncate font-medium"
            >
              {label}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">{quantity}</span>
            {amount !== undefined && (
              <Money
                cents={amount}
                className="text-xs font-semibold tabular-nums"
              />
            )}
          </div>
          <DivisionSlider
            className="block"
            ariaLabel={`Parte de ${label}`}
            ariaValuetext={quantity}
            min={0}
            max={maximum}
            value={sliderValue}
            snap={multiUnit ? { step: 1, threshold: 0 } : { step: 5, threshold: 2 }}
            onChange={(value) => onChange(person.id, value)}
          />
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-1">
        <span
          className="mr-1 max-w-24 truncate text-xs text-muted-foreground"
          title={activeName ?? undefined}
        >
          {activeName}
        </span>
        {multiUnit && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 rounded-full"
            onClick={() => onHelper("unit")}
          >
            +1
          </Button>
        )}
        {!multiUnit && FRACTION_HELPERS.map(({ denominator, label }) => (
          <Button
            key={denominator}
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 min-w-11 rounded-full"
            onClick={() => onHelper(denominator)}
          >
            {label}
          </Button>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 rounded-full"
          onClick={() => onHelper("rest")}
        >
          Resto
        </Button>
      </div>
    </div>
  );
}

function SplitStatusLine({ item, status, remainingCents }: {
  item: AssignmentRoomItem;
  status: SplitDraftStatus;
  remainingCents: number | null;
}) {
  let message = "Tudo dividido";
  if (status.overTicks > 0) {
    message = `Passou ${claimQuantityLabel(item.quantityMilliunits, status.overTicks)} do item`;
  } else if (status.remainingTicks > 0) {
    message = `Falta ${claimQuantityLabel(item.quantityMilliunits, status.remainingTicks)}`;
  }
  const showAmount = status.overTicks === 0 && status.remainingTicks > 0 && remainingCents !== null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "border-t pt-3 text-sm",
        status.overTicks > 0 ? "text-destructive-text" : "text-muted-foreground",
      )}
    >
      {message}
      {showAmount && <> · <Money cents={remainingCents} /></>}
    </div>
  );
}

function SplitFooter({ busy, canSave, releasing, onClose }: {
  busy: boolean;
  canSave: boolean;
  releasing: boolean;
  onClose: () => void;
}) {
  let label = "Salvar divisão";
  if (releasing) label = "Liberar item";
  if (busy) label = "Salvando...";

  return (
    <div className="flex gap-2">
      <Button
        type="button"
        variant="ghost"
        disabled={busy}
        className="min-h-11"
        onClick={onClose}
      >
        Cancelar
      </Button>
      <Button
        type="submit"
        disabled={!canSave}
        className="min-h-11 flex-1"
      >
        {busy && (
          <Loader2
            aria-hidden="true"
            className="size-4 motion-safe:animate-spin"
          />
        )}
        {label}
      </Button>
    </div>
  );
}

export function RoomItemSplit({
  item,
  participants,
  claims,
  selfParticipantId,
  labels,
  focusParticipantId,
  pending,
  disabled,
  error,
  previewCents,
  onSave,
  onClose,
  onDirtyChange,
}: RoomItemSplitProps): React.JSX.Element {
  const capacity = item.quantityMilliunits * ROOM_TICKS_PER_MILLIUNIT;
  const saved = claims.map(({ participantId, ticks }) => ({ participantId, ticks }));
  const [base, setBase] = useState({ revision: item.revision, shares: saved });
  const [draft, setDraft] = useState<AssignmentItemShare[]>(saved);
  const [mode, setMode] = useState<SplitMode>(() => initialMode(capacity, saved, focusParticipantId));
  const [lastTouched, setLastTouched] = useState<string | null>(focusParticipantId ?? saved[0]?.participantId ?? null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const rootRef = useRef<HTMLFormElement>(null);
  const activeIds = new Set(participants.map((person) => person.id));
  const changes = changedShares(
    base.shares.filter((share) => activeIds.has(share.participantId)),
    draft.filter((share) => activeIds.has(share.participantId)),
  );
  const dirty = changes.length > 0;
  const busy = pending || saving;
  const stale = base.revision !== item.revision;
  const locked = disabled || busy || stale;
  const multiUnit = item.quantityMilliunits >= 2_000;
  const status = splitDraftStatus(capacity, draft);
  const amounts = previewCents(changedShares(saved, draft));
  const selectedIds = participants
    .filter((person) => draft.some((share) => share.participantId === person.id))
    .map((person) => person.id);
  const activeId = selectedIds.includes(lastTouched ?? "") ? lastTouched : selectedIds[0];
  const activeShare = draft.find((share) => share.participantId === activeId);
  const remainingCents = amounts
    ? Math.max(0, item.totalPriceCents - Array.from(amounts.values()).reduce((sum, cents) => sum + cents, 0))
    : null;
  const people: SplitPerson[] = participants.map((person) => {
    const share = draft.find((entry) => entry.participantId === person.id);
    const ticks = share?.ticks ?? 0;
    let label = labels.get(person.id) ?? person.displayName;
    if (!labels.has(person.id) && person.id === selfParticipantId) label = "Você";
    return {
      person,
      label,
      selected: Boolean(share),
      sweepDegrees: shareToPercent(capacity, ticks) * 3.6,
      quantity: claimQuantityLabel(item.quantityMilliunits, ticks),
      amount: amounts?.get(person.id),
      sliderValue: multiUnit ? ticks / ROOM_TICKS_PER_UNIT : shareToPercent(capacity, ticks),
    };
  });
  const selectedPeople = people.filter((person) => person.selected);
  const firstPerson = selectedPeople[0];
  const activeName = people.find(({ person }) => person.id === activeId)?.label ?? null;
  const canSave = dirty && !locked && status.overTicks === 0 && amounts !== null;
  const sliderMax = multiUnit ? Math.floor(capacity / ROOM_TICKS_PER_UNIT) : 100;

  useEffect(() => {
    onDirtyChange(dirty || saving);
  }, [dirty, saving, onDirtyChange]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    const input = focusParticipantId
      ? rootRef.current?.querySelector<HTMLInputElement>(`[data-person-id="${CSS.escape(focusParticipantId)}"] input`)
      : rootRef.current?.querySelector<HTMLButtonElement>("button");
    input?.focus({ preventScroll: true });
  }, [focusParticipantId]);

  function refresh() {
    setBase({ revision: item.revision, shares: saved });
    setDraft(saved);
    setMode(initialMode(capacity, saved, null));
    setSaveError(null);
  }

  if (stale && !dirty && !busy) refresh();

  function close() {
    if (busy) return;
    if (dirty && !window.confirm("Descartar as divisões não salvas?")) return;
    onClose();
  }

  function choosePeople(ids: string[]) {
    if (locked) return;
    const orderedIds = participants.filter((person) => ids.includes(person.id)).map((person) => person.id);
    if (mode === "equal") {
      setDraft(splitTicksEvenly(capacity, orderedIds));
    } else {
      setDraft(orderedIds.map((participantId) => ({
        participantId,
        ticks: draft.find((share) => share.participantId === participantId)?.ticks ?? 0,
      })));
    }
    setSaveError(null);
  }

  function togglePerson(participantId: string) {
    setLastTouched(participantId);
    let ids = [...selectedIds, participantId];
    if (selectedIds.includes(participantId)) ids = selectedIds.filter((id) => id !== participantId);
    choosePeople(ids);
  }

  function changeMode(next: SplitMode) {
    haptics.selectionChanged();
    setMode(next);
    if (next === "equal") setDraft(splitTicksEvenly(capacity, selectedIds));
  }

  function setTicks(participantId: string, ticks: number) {
    if (locked) return;
    setLastTouched(participantId);
    setDraft(draft.map((share) => share.participantId === participantId ? { participantId, ticks } : share));
    setSaveError(null);
  }

  function changeSlider(participantId: string, value: number) {
    if (multiUnit) {
      setTicks(participantId, value * ROOM_TICKS_PER_UNIT);
      return;
    }
    const otherTicks = draft.reduce(
      (sum, share) => (share.participantId === participantId ? sum : sum + share.ticks),
      0,
    );
    setTicks(participantId, sliderTicks(capacity, value, otherTicks, draft.length));
  }

  function applyHelper(helper: SplitHelper) {
    if (!activeShare || locked) return;
    haptics.selectionChanged();
    if (helper === "unit") {
      setTicks(activeShare.participantId, Math.min(capacity, activeShare.ticks + ROOM_TICKS_PER_UNIT));
    } else if (helper === "rest") {
      setTicks(activeShare.participantId, Math.max(0, activeShare.ticks + status.remainingTicks - status.overTicks));
    } else {
      const result = claimTicksForFraction(item.quantityMilliunits, 1, helper);
      if (result.ok) setTicks(activeShare.participantId, result.value);
    }
  }

  async function save() {
    if (!canSave || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      if (await onSave(changes, base.revision)) {
        haptics.success();
        onClose();
      } else {
        setSaveError("Não deu pra salvar. Tente de novo.");
        haptics.error();
      }
    } catch {
      setSaveError("Não deu pra salvar. Tente de novo.");
      haptics.error();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <form
      ref={rootRef}
      aria-label={`Dividir ${item.description}`}
      className="space-y-3 border-t bg-muted/20 px-3 py-3 sm:px-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
    >
      <fieldset
        disabled={locked}
        className="min-w-0 space-y-3 disabled:opacity-60"
      >
        <SplitModeToggle
          value={mode}
          onChange={changeMode}
        />
        <SplitPeopleGrid
          people={people}
          onToggle={togglePerson}
          onEveryone={() => choosePeople(participants.map((person) => person.id))}
          onClear={() => choosePeople([])}
        />
        {!firstPerson && (
          <p className="py-2 text-center text-sm text-muted-foreground">
            Selecione quem vai dividir
          </p>
        )}
        {firstPerson && mode === "equal" && (
          <p className="py-2 text-center text-sm text-muted-foreground">
            {firstPerson.quantity} cada
            {firstPerson.amount !== undefined && <> · <Money cents={firstPerson.amount} /></>}
          </p>
        )}
        {firstPerson && mode === "custom" && (
          <SplitSliders
            people={selectedPeople}
            multiUnit={multiUnit}
            maximum={sliderMax}
            activeName={activeName}
            onFocus={setLastTouched}
            onChange={changeSlider}
            onEqualize={() => setDraft(splitTicksEvenly(capacity, selectedIds))}
            onHelper={applyHelper}
          />
        )}
      </fieldset>
      <SplitStatusLine
        item={item}
        status={status}
        remainingCents={remainingCents}
      />
      {stale && (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 text-sm"
        >
          <span>A sala mudou.</span>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={busy}
            onClick={refresh}
          >
            Atualizar
          </Button>
        </div>
      )}
      {(error || saveError) && (
        <p
          role="alert"
          className="text-sm text-destructive-text"
        >
          {error ?? saveError}
        </p>
      )}
      <SplitFooter
        busy={busy}
        canSave={canSave}
        releasing={draft.every((share) => share.ticks === 0)}
        onClose={close}
      />
    </form>
  );
}
