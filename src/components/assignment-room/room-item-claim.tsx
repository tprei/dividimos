"use client";

import { Check, ChevronDown, ChevronUp, Loader2, Minus, Plus, Undo2 } from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Money } from "@/components/shared/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBackHandler } from "@/hooks/use-back-handler";
import {
  ROOM_TICKS_PER_MILLIUNIT,
  claimTicksForFraction,
  claimTicksForQuantity,
} from "@/lib/assignment-room-money";
import {
  formatExpenseQuantity,
  parseExpenseQuantity,
  type ExpenseQuantity,
} from "@/lib/expense-quantity";
import type { AssignmentRoomItem } from "@/types/assignment-room";

const FRACTION_DENOMINATORS = [2, 3, 4, 5, 6, 8, 10] as const;
const UNIT_TICKS = 1_000 * ROOM_TICKS_PER_MILLIUNIT;

interface RoomItemClaimProps {
  item: AssignmentRoomItem;
  claimedTicks: number;
  availableTicks: number;
  pending: boolean;
  disabled: boolean;
  errorMessage?: string | null;
  onSubmit: (ticks: number) => void;
}

function claimSummary(item: AssignmentRoomItem, ticks: number): string {
  if (ticks === 0) return "Nada escolhido";
  for (const denominator of FRACTION_DENOMINATORS) {
    for (let numerator = 1; numerator < denominator; numerator += 1) {
      const result = claimTicksForFraction(item.quantityMilliunits, numerator, denominator);
      if (result.ok && result.value === ticks) return `${numerator}/${denominator} do item`;
    }
  }
  if (ticks % ROOM_TICKS_PER_MILLIUNIT === 0) {
    const quantity = (ticks / ROOM_TICKS_PER_MILLIUNIT) as ExpenseQuantity;
    return `${formatExpenseQuantity(quantity)} un.`;
  }
  const capacity = item.quantityMilliunits * ROOM_TICKS_PER_MILLIUNIT;
  return `${ticks} de ${capacity} partes`;
}

export function RoomItemClaim({
  item,
  claimedTicks,
  availableTicks,
  pending,
  disabled,
  errorMessage,
  onSubmit,
}: RoomItemClaimProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  const maximumTicks = claimedTicks + availableTicks;

  const close = useCallback(() => {
    setOpen(false);
    setDraft("");
    setLocalError(null);
  }, []);
  useBackHandler(open, close);

  useEffect(() => {
    if (wasOpenRef.current && !open) triggerRef.current?.focus();
    wasOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [close, open]);

  function submitTicks(ticks: number) {
    if (pending || disabled || ticks === claimedTicks) return;
    if (!Number.isSafeInteger(ticks) || ticks < 0 || ticks > maximumTicks) {
      setLocalError("Essa quantidade não está mais disponível.");
      return;
    }
    setLocalError(null);
    onSubmit(ticks);
  }

  function submitDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseExpenseQuantity(draft);
    if (!parsed.ok) {
      setLocalError("Digite uma quantidade válida, com até três casas decimais.");
      return;
    }
    const ticks = claimTicksForQuantity(parsed.value);
    if (!ticks.ok || ticks.value > maximumTicks) {
      setLocalError("Essa quantidade não está mais disponível.");
      return;
    }
    submitTicks(ticks.value);
  }

  function openEditor() {
    setOpen(true);
    setLocalError(null);
    setDraft(
      claimedTicks > 0 && claimedTicks % ROOM_TICKS_PER_MILLIUNIT === 0
        ? formatExpenseQuantity(
            (claimedTicks / ROOM_TICKS_PER_MILLIUNIT) as ExpenseQuantity,
          )
        : "",
    );
  }

  const message = localError || errorMessage;

  return (
    <article className="rounded-2xl border bg-card p-4" data-item-id={item.id}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-medium">{item.description}</h3>
          <p className="text-sm text-muted-foreground">
            Linha original: {formatExpenseQuantity(item.quantityMilliunits as ExpenseQuantity)} un.
          </p>
          <p className="mt-1 text-sm font-medium">{claimSummary(item, claimedTicks)}</p>
          {pending && (
            <p role="status" className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Salvando sua escolha...
            </p>
          )}
        </div>
        <Money cents={item.totalPriceCents} className="shrink-0 font-semibold" />
      </div>

      {message && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {message}
        </p>
      )}

      {!open ? (
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          className="mt-3 min-h-11 w-full"
          disabled={disabled}
          onClick={openEditor}
        >
          <ChevronDown className="size-4" />
          {claimedTicks > 0 ? "Editar minha parte" : "Escolher quantidade"}
        </Button>
      ) : (
        <div className="mt-4 space-y-4 border-t pt-4">
          <div className="grid grid-cols-[44px_minmax(0,1fr)_44px] gap-2">
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="min-h-11 min-w-11"
              aria-label="Diminuir uma unidade"
              disabled={pending || disabled || claimedTicks === 0}
              onClick={() => submitTicks(Math.max(0, claimedTicks - UNIT_TICKS))}
            >
              <Minus className="size-4" />
            </Button>
            <form className="grid min-w-0 grid-cols-[minmax(0,1fr)_44px] gap-2" onSubmit={submitDraft}>
              <Input
                value={draft}
                inputMode="decimal"
                aria-label="Quantidade desejada"
                placeholder="Ex.: 1,5"
                disabled={pending || disabled}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setLocalError(null);
                }}
              />
              <Button
                type="submit"
                size="icon"
                className="min-h-11 min-w-11"
                aria-label="Confirmar quantidade"
                disabled={pending || disabled}
              >
                <Check className="size-4" />
              </Button>
            </form>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="min-h-11 min-w-11"
              aria-label="Aumentar uma unidade"
              disabled={pending || disabled || claimedTicks >= maximumTicks}
              onClick={() => submitTicks(Math.min(maximumTicks, claimedTicks + UNIT_TICKS))}
            >
              <Plus className="size-4" />
            </Button>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Frações da linha original</p>
            <div className="grid grid-cols-4 gap-2">
              {FRACTION_DENOMINATORS.map((denominator) => {
                const result = claimTicksForFraction(item.quantityMilliunits, 1, denominator);
                const ticks = result.ok ? result.value : 0;
                return (
                  <Button
                    key={denominator}
                    type="button"
                    variant="outline"
                    className="min-h-11 px-2"
                    disabled={pending || disabled || ticks > maximumTicks}
                    onClick={() => submitTicks(ticks)}
                  >
                    1/{denominator}
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {claimedTicks > 0 && (
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={pending || disabled}
                onClick={() => submitTicks(0)}
              >
                <Undo2 className="size-4" />
                Desfazer minha escolha
              </Button>
            )}
            <Button type="button" variant="ghost" className="min-h-11" onClick={close}>
              <ChevronUp className="size-4" />
              Recolher
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}
