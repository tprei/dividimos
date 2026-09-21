"use client";

import { Check, Loader2, Minus, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Money } from "@/components/shared/money";
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
import type { AssignmentRoomClaim, AssignmentRoomItem } from "@/types/assignment-room";

/** Ticks in one whole item; the plus and minus controls move by this much. */
const UNIT_TICKS = 1_000 * ROOM_TICKS_PER_MILLIUNIT;

/** Fractions offered up front, as fractions of the whole printed line. */
const QUICK_DENOMINATORS = [2, 3, 4] as const;

/** Fractions kept behind the disclosure, where they do not crowd the sheet. */
const EXTRA_DENOMINATORS = [5, 6, 8, 10] as const;

/**
 * The draft is what the person is choosing, never what the room has stored.
 * Nothing leaves this component until the confirm button runs, so tapping a
 * fraction or a stepper can no longer take an item by accident.
 */
type ClaimDraft =
  | { kind: "empty" }
  | { kind: "ticks"; ticks: number }
  | { kind: "quantity"; text: string };

interface RoomItemClaimProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  getReturnFocus: () => HTMLElement | null;
  item: AssignmentRoomItem;
  /** Claims for this item only. */
  claims: AssignmentRoomClaim[];
  availableTicks: number;
  selfParticipantId: string;
  pending: boolean;
  disabled: boolean;
  error: { participantId: string; message: string } | null;
  onSubmit: (participantId: string, ticks: number) => Promise<boolean>;
}

type DraftResolution =
  | { status: "empty" }
  | { status: "invalid"; message: string }
  | { status: "ticks"; ticks: number };

/** Selected fractions read as filled chips rather than a hairline border. */
const CHIP =
  "min-h-11 px-2 font-semibold transition-colors aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground";

export function RoomItemClaim({
  open,
  onOpenChange,
  getReturnFocus,
  item,
  claims,
  availableTicks,
  selfParticipantId,
  pending,
  disabled,
  error,
  onSubmit,
}: RoomItemClaimProps) {
  const capacityTicks = item.quantityMilliunits * ROOM_TICKS_PER_MILLIUNIT;
  const [draft, setDraft] = useState<ClaimDraft>({ kind: "empty" });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attemptFailed, setAttemptFailed] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingRef = useRef(false);

  // Everyone edits their own share, so the room never asks who this is for.
  const savedTicks = useMemo(
    () => claims.find((claim) => claim.participantId === selfParticipantId)?.ticks ?? 0,
    [claims, selfParticipantId],
  );
  const maximumTicks = savedTicks + availableTicks;

  const seedDraft = useCallback((ticks: number): ClaimDraft => {
    return ticks > 0 ? { kind: "ticks", ticks } : { kind: "empty" };
  }, []);

  // Opening the editor only reads the room. It never writes, not even for a
  // line that holds a single unit. Seeding is tied to the closed-to-open
  // transition so a live room update cannot overwrite what someone is typing.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      const initial =
        claims.find((claim) => claim.participantId === selfParticipantId)?.ticks ?? 0;
      setDraft(seedDraft(initial));
      setAdvancedOpen(false);
      setAttemptFailed(false);
      setSaveError(null);
    }
    wasOpenRef.current = open;
  }, [claims, open, seedDraft, selfParticipantId]);

  function chooseTicks(ticks: number) {
    setDraft({ kind: "ticks", ticks });
    setAttemptFailed(false);
    setSaveError(null);
  }

  function typeQuantity(text: string) {
    setDraft({ kind: "quantity", text });
    setAttemptFailed(false);
    setSaveError(null);
  }

  const resolution: DraftResolution = useMemo(() => {
    if (draft.kind === "empty") return { status: "empty" };
    if (draft.kind === "ticks") {
      if (draft.ticks < 0 || draft.ticks > maximumTicks) {
        return {
          status: "invalid",
          message:
            "Essa quantidade não está mais disponível. Escolha outra quantidade.",
        };
      }
      return { status: "ticks", ticks: draft.ticks };
    }
    const text = draft.text.trim();
    if (text.length === 0) return { status: "empty" };
    if (text === "0" || text === "0,0" || text === "0.0") {
      return { status: "ticks", ticks: 0 };
    }
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
        message:
          "Essa quantidade não está mais disponível. Escolha outra quantidade.",
      };
    }
    return { status: "ticks", ticks: ticks.value };
  }, [draft, maximumTicks]);

  const draftTicks = resolution.status === "ticks" ? resolution.ticks : null;
  const unchanged = draftTicks !== null && draftTicks === savedTicks;
  const canSave = !disabled && !pending && !saving && draftTicks !== null && !unchanged;

  const scopedError =
    attemptFailed && error?.participantId === selfParticipantId ? error.message : null;
  const message =
    resolution.status === "invalid"
      ? resolution.message
      : (saveError ?? scopedError);

  function fractionTicks(denominator: number): number | null {
    const result = claimTicksForFraction(item.quantityMilliunits, 1, denominator);
    return result.ok ? result.value : null;
  }

  function stepFrom(): number {
    if (draftTicks !== null) return draftTicks;
    return savedTicks;
  }

  async function confirm() {
    if (!canSave || draftTicks === null || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await onSubmit(selfParticipantId, draftTicks);
      if (saved) {
        onOpenChange(false);
        return;
      }
      setAttemptFailed(true);
      if (!error || error.participantId !== selfParticipantId) {
        setSaveError("Não foi possível salvar. Tente novamente.");
      }
    } catch {
      setAttemptFailed(true);
      setSaveError("Não foi possível salvar. Tente novamente.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const remainder = draftTicks === null ? null : maximumTicks - draftTicks;

  return (
    <Dialog
      open={open}
      dismissable={!saving}
      onOpenChange={(next) => {
        if (saving) return;
        onOpenChange(next);
      }}
    >
      <DialogContent finalFocus={getReturnFocus} className="gap-3">
        <DialogHeader className="gap-1">
          <DialogTitle>{item.description}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-primary/12 px-2 py-0.5 font-semibold text-primary-text">
              <Money cents={item.totalPriceCents} className="text-xs" />
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
              Linha inteira: {formatRoomTicks(capacityTicks)} un.
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-medium",
                availableTicks > 0
                  ? "bg-success/15 text-success-text"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {availableTicks > 0
                ? `Livre: ${formatRoomTicks(availableTicks)} un.`
                : "Tudo escolhido"}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Frações da linha inteira
          </p>
          <div className="grid grid-cols-4 gap-2">
            <Button
              type="button"
              variant="outline"
              aria-pressed={draftTicks === capacityTicks}
              className={CHIP}
              disabled={saving || capacityTicks > maximumTicks}
              onClick={() => chooseTicks(capacityTicks)}
            >
              Inteiro
            </Button>
            {QUICK_DENOMINATORS.map((denominator) => {
              const ticks = fractionTicks(denominator);
              return (
                <Button
                  key={denominator}
                  type="button"
                  variant="outline"
                  aria-pressed={ticks !== null && draftTicks === ticks}
                  className={CHIP}
                  disabled={saving || ticks === null || ticks > maximumTicks}
                  onClick={() => ticks !== null && chooseTicks(ticks)}
                >
                  1/{denominator}
                </Button>
              );
            })}
          </div>
        </div>

        {maximumTicks > 0 && maximumTicks !== capacityTicks && (
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full border-success/40 bg-success/10 font-semibold text-success-text hover:bg-success/20"
            disabled={saving}
            onClick={() => chooseTicks(maximumTicks)}
          >
            Pegar o restante ({formatRoomTicks(maximumTicks)} un.)
          </Button>
        )}

        {!advancedOpen ? (
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 w-full text-primary-text"
            disabled={saving}
            onClick={() => setAdvancedOpen(true)}
          >
            Outra quantidade
          </Button>
        ) : (
          <div className="space-y-3 rounded-xl bg-muted/60 p-3">
            <div className="grid grid-cols-[44px_minmax(0,1fr)_44px] gap-2">
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="min-h-11 min-w-11 text-primary-text"
                aria-label="Diminuir uma unidade"
                disabled={saving || stepFrom() <= 0}
                onClick={() => chooseTicks(Math.max(0, stepFrom() - UNIT_TICKS))}
              >
                <Minus className="size-4" />
              </Button>
              <Input
                value={
                  draft.kind === "quantity"
                    ? draft.text
                    : draftTicks === null
                      ? ""
                      : formatRoomTicks(draftTicks)
                }
                inputMode="decimal"
                aria-label="Quantidade desejada"
                placeholder="Ex.: 1,5"
                className="min-h-11 bg-background text-center font-semibold"
                disabled={saving}
                onChange={(event) => typeQuantity(event.target.value)}
              />
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="min-h-11 min-w-11 text-primary-text"
                aria-label="Aumentar uma unidade"
                disabled={saving || stepFrom() >= maximumTicks}
                onClick={() =>
                  chooseTicks(Math.min(maximumTicks, stepFrom() + UNIT_TICKS))
                }
              >
                <Plus className="size-4" />
              </Button>
            </div>
            <SelectField
              label="Escolher fração"
              value=""
              placeholder="Escolher fração"
              disabled={saving}
              options={EXTRA_DENOMINATORS.map((denominator) => {
                const ticks = fractionTicks(denominator);
                return {
                  value: String(denominator),
                  label: `1/${denominator}`,
                  disabled: ticks === null || ticks > maximumTicks,
                };
              })}
              onChange={(value) => {
                const ticks = fractionTicks(Number(value));
                if (ticks !== null) chooseTicks(ticks);
              }}
            />
          </div>
        )}

        {savedTicks > 0 && (
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 w-full text-destructive-text"
            disabled={saving}
            onClick={() => chooseTicks(0)}
          >
            <Trash2 className="size-4" />
            Remover minha escolha
          </Button>
        )}

        <div
          className={cn(
            "rounded-xl px-3 py-2.5 text-sm ring-1",
            draftTicks === null
              ? "bg-muted ring-transparent"
              : "bg-primary/10 ring-primary/20",
          )}
        >
          {draftTicks === null ? (
            <p className="text-muted-foreground">Escolha uma quantidade para continuar.</p>
          ) : (
            <>
              <p className="flex items-center gap-1.5 font-semibold text-primary-text">
                <Check className="size-4" aria-hidden="true" />
                Sua quantidade: {formatRoomTicks(draftTicks)} un.
              </p>
              {remainder !== null && (
                <p className="mt-0.5 text-muted-foreground">
                  Depois de confirmar, restam {formatRoomTicks(remainder)} un.
                </p>
              )}
            </>
          )}
        </div>

        {message && (
          <p role="alert" className="text-sm text-destructive-text">
            {message}
          </p>
        )}

        {/* Confirm sits above cancel in reading order; the shared footer's row
            layout would push full-width actions past the popup edge. */}
        <DialogFooter className="flex-col sm:flex-col sm:justify-stretch">
          <Button
            type="button"
            className="min-h-11 w-full font-semibold"
            disabled={!canSave}
            onClick={confirm}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {saving ? "Salvando..." : "Confirmar quantidade"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 w-full"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
