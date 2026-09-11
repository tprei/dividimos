"use client";

import { Fragment } from "react";
import { Pencil } from "lucide-react";
import { Money } from "@/components/shared/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ReceiptItem } from "@/lib/receipt-ocr";
import { cn } from "@/lib/utils";

export interface ReceiptItemRowProps {
  item: ReceiptItem;
  index: number;
  amountText: string;
  amountInvalid: boolean;
  nameInvalid: boolean;
  panelOpen: boolean;
  onTogglePanel: (index: number) => void;
  onNameChange: (index: number, value: string) => void;
  onAmountChange: (index: number, value: string) => void;
}

export function ReceiptItemRow({
  item,
  index,
  amountText,
  amountInvalid,
  nameInvalid,
  panelOpen,
  onTogglePanel,
  onNameChange,
  onAmountChange,
}: ReceiptItemRowProps) {
  const itemLabel = item.description.trim() || "item";
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
        className="flex min-h-14 w-full items-center px-4 py-2 text-left transition-colors hover:bg-muted/40"
      >
        <span
          className={cn(
            "min-w-0 break-words text-sm leading-5 font-semibold",
            nameInvalid && "text-destructive",
          )}
        >
          {item.description.trim() || "Item sem nome"}
        </span>
        <span
          aria-hidden="true"
          className="mx-2 flex-1 translate-y-[-0.25rem] border-b border-dotted border-border/60"
        />
        <Money
          cents={item.totalCents}
          className={cn("shrink-0 text-sm", amountInvalid && "text-destructive")}
        />
        <Pencil className="ml-2 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
      {invalid && (
        <div className="space-y-1 px-4 pb-2 text-xs text-destructive">
          {nameInvalid && <p id={nameErrorId}>Informe o nome do item.</p>}
          {amountInvalid && <p id={amountErrorId}>Valor incompatível com a quantidade.</p>}
        </div>
      )}
      {panelOpen && (
        <div className="space-y-3 border-t border-dashed border-border bg-muted/30 px-4 pt-3 pb-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Nome</p>
            <Input
              value={item.description}
              onChange={(event) => onNameChange(index, event.target.value)}
              aria-label={`Nome de ${itemLabel}`}
              aria-invalid={nameInvalid}
              aria-describedby={nameInvalid ? nameErrorId : undefined}
              className="h-11 w-full bg-card"
            />
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Valor</p>
            <Input
              value={amountText}
              onChange={(event) => onAmountChange(index, event.target.value)}
              inputMode="decimal"
              aria-label={`Valor de ${itemLabel}`}
              aria-invalid={amountInvalid}
              aria-describedby={amountInvalid ? amountErrorId : undefined}
              className="h-11 w-full bg-card text-right font-mono"
            />
          </div>
          <Button
            variant="ghost"
            className="h-11 w-full"
            onClick={() => onTogglePanel(index)}
          >
            Pronto
          </Button>
        </div>
      )}
    </Fragment>
  );
}
