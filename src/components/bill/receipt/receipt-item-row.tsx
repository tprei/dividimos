"use client";

import { Fragment } from "react";
import { Minus, Pencil, Plus, Trash2 } from "lucide-react";
import { Money } from "@/components/shared/money";
import { ItemIcon } from "@/components/shared/item-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MAX_EXPENSE_QUANTITY_MILLIUNITS,
  formatExpenseQuantity,
  type ExpenseQuantity,
} from "@/lib/expense-quantity";
import type { ReceiptItem } from "@/lib/receipt-ocr";
import { cn } from "@/lib/utils";

export interface ReceiptItemRowProps {
  item: ReceiptItem;
  showIcon: boolean;
  index: number;
  amountText: string;
  amountInvalid: boolean;
  nameInvalid: boolean;
  panelOpen: boolean;
  onTogglePanel: (index: number) => void;
  onNameChange: (index: number, value: string) => void;
  onQuantityChange: (index: number, quantityMilliunits: number) => void;
  onAmountChange: (index: number, value: string) => void;
  onRemove: (index: number) => void;
}

export function ReceiptItemRow({
  item,
  showIcon,
  index,
  amountText,
  amountInvalid,
  nameInvalid,
  panelOpen,
  onTogglePanel,
  onNameChange,
  onQuantityChange,
  onAmountChange,
  onRemove,
}: ReceiptItemRowProps) {
  const itemLabel = item.description.trim() || "item";
  const quantityText = formatExpenseQuantity(item.quantity as ExpenseQuantity);
  const nameErrorId = `receipt-item-${index}-name-error`;
  const amountErrorId = `receipt-item-${index}-amount-error`;
  const invalid = nameInvalid || amountInvalid;
  const errorIds = [nameInvalid ? nameErrorId : null, amountInvalid ? amountErrorId : null]
    .filter((id): id is string => id !== null)
    .join(" ");

  return (
    <Fragment>
      <button
        type="button"
        aria-label={`Editar ${itemLabel}`}
        aria-expanded={panelOpen}
        aria-describedby={invalid ? errorIds : undefined}
        onClick={() => onTogglePanel(index)}
        className={cn(
          "flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left motion-safe:transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
          panelOpen && "bg-muted/50",
        )}
      >
        {showIcon && (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
            <ItemIcon icon={item.icon} className="size-8" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block break-words text-base leading-5 font-semibold [overflow-wrap:anywhere]",
              nameInvalid && "text-destructive",
            )}
          >
            {item.description.trim() || "Item sem nome"}
          </span>
          {item.quantity !== 1000 && (
            <span className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs leading-4 text-muted-foreground tabular-nums">
              <span className="font-semibold">{quantityText}x</span>
              {!amountInvalid && (
                <>
                  <span aria-hidden="true">·</span>
                  <span><Money cents={item.unitPriceCents} className="text-xs font-normal" /> cada</span>
                </>
              )}
            </span>
          )}
        </span>
        <Money
          cents={item.totalCents}
          className={cn("shrink-0 text-sm font-semibold", amountInvalid && "text-destructive")}
        />
        <Pencil className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
      {invalid && (
        <div className="space-y-1 px-4 pb-2 text-xs text-destructive">
          {nameInvalid && <p id={nameErrorId}>Informe o nome do item.</p>}
          {amountInvalid && <p id={amountErrorId}>Valor incompatível com a quantidade.</p>}
        </div>
      )}
      {panelOpen && (
        <div className="space-y-3 border-t border-border bg-muted/30 px-4 pt-3 pb-4">
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <label htmlFor={`receipt-item-${index}-name`} className="text-xs text-muted-foreground">
                Nome
              </label>
              <Input
                id={`receipt-item-${index}-name`}
                value={item.description}
                onChange={(event) => onNameChange(index, event.target.value)}
                aria-label={`Nome de ${itemLabel}`}
                aria-invalid={nameInvalid}
                aria-describedby={nameInvalid ? nameErrorId : undefined}
                className="h-11 w-full bg-card text-base md:text-sm"
              />
            </div>
            <p id={`receipt-item-${index}-quantity-label`} className="sr-only">
              Quantidade de {itemLabel}
            </p>
            <div
              role="group"
              aria-labelledby={`receipt-item-${index}-quantity-label`}
              className="flex h-11 shrink-0 items-center overflow-hidden rounded-lg border border-input bg-card"
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={item.quantity <= 1000}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onQuantityChange(index, item.quantity - 1000)}
                aria-label={`Diminuir quantidade de ${itemLabel}`}
                className="size-11 rounded-none text-muted-foreground"
              >
                <Minus className="size-3.5" aria-hidden="true" />
              </Button>
              <span
                aria-live="polite"
                aria-atomic="true"
                className="min-w-7 text-center text-base font-semibold tabular-nums md:text-sm"
              >
                {quantityText}x
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={item.quantity + 1000 > MAX_EXPENSE_QUANTITY_MILLIUNITS}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onQuantityChange(index, item.quantity + 1000)}
                aria-label={`Aumentar quantidade de ${itemLabel}`}
                className="size-11 rounded-none text-muted-foreground"
              >
                <Plus className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          </div>
          <div className="space-y-1">
            <label htmlFor={`receipt-item-${index}-amount`} className="text-xs text-muted-foreground">
              Valor total
            </label>
            <Input
              id={`receipt-item-${index}-amount`}
              value={amountText}
              onChange={(event) => onAmountChange(index, event.target.value)}
              inputMode="decimal"
              aria-label={`Valor total de ${itemLabel}`}
              aria-invalid={amountInvalid}
              aria-describedby={amountInvalid ? amountErrorId : undefined}
              className="h-11 w-full bg-card text-right font-mono text-base md:text-sm"
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              className="h-11 flex-1 text-destructive hover:bg-destructive/10"
              onClick={() => onRemove(index)}
              aria-label={`Remover ${itemLabel}`}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Remover
            </Button>
            <Button variant="outline" className="h-11 flex-1 bg-card" onClick={() => onTogglePanel(index)}>
              Pronto
            </Button>
          </div>
        </div>
      )}
    </Fragment>
  );
}
