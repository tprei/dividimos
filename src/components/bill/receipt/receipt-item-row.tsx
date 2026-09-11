"use client";

import { Fragment } from "react";
import { Pencil, Users } from "lucide-react";
import { AvatarStack } from "@/components/shared/avatar-stack";
import { Money } from "@/components/shared/money";
import { ItemDivisionEditor, type ItemDivisionParticipant } from "@/components/bill/item-division-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isDivisionValid, type ItemDivisionValue } from "@/lib/item-division";
import type { ReceiptItem } from "@/lib/receipt-ocr";
import { cn } from "@/lib/utils";

export type ReceiptItemPanel = "details" | "division";

export interface ReceiptItemRowProps {
  item: ReceiptItem;
  index: number;
  amountText: string;
  amountInvalid: boolean;
  nameInvalid: boolean;
  panel: ReceiptItemPanel | null;
  division?: ItemDivisionValue;
  participants: ItemDivisionParticipant[];
  onTogglePanel: (index: number, panel: ReceiptItemPanel) => void;
  onNameChange: (index: number, value: string) => void;
  onAmountChange: (index: number, value: string) => void;
  onSaveDivision: (index: number, value: ItemDivisionValue) => void;
  onCancelDivision: () => void;
}

export function ReceiptItemRow({
  item,
  index,
  amountText,
  amountInvalid,
  nameInvalid,
  panel,
  division,
  participants,
  onTogglePanel,
  onNameChange,
  onAmountChange,
  onSaveDivision,
  onCancelDivision,
}: ReceiptItemRowProps) {
  const itemLabel = item.description.trim() || "item";
  const nameErrorId = `receipt-item-${index}-name-error`;
  const amountErrorId = `receipt-item-${index}-amount-error`;
  const assignmentId = `receipt-item-${index}-assignment`;
  const invalid = nameInvalid || amountInvalid;
  const errorIds = [nameInvalid ? nameErrorId : null, amountInvalid ? amountErrorId : null]
    .filter((id): id is string => id !== null)
    .join(" ");
  const validDivision = division && isDivisionValid(division, item.totalCents) ? division : null;
  const assignedPeople = validDivision
    ? validDivision.shares.flatMap((share) => {
        const participant = participants.find((person) => person.id === share.participantId);
        return participant ? [participant] : [];
      })
    : [];

  return (
    <Fragment>
      <div className="flex min-h-14 min-w-0 items-center gap-2 px-3 py-2">
        <button
          type="button"
          aria-label={`Editar ${itemLabel}`}
          aria-expanded={panel === "details"}
          aria-describedby={invalid ? errorIds : undefined}
          onClick={() => onTogglePanel(index, "details")}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl px-1 text-left transition-colors hover:bg-muted/40"
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm font-semibold",
              nameInvalid && "text-destructive",
            )}
          >
            {item.description.trim() || "Item sem nome"}
          </span>
          <Money
            cents={item.totalCents}
            className={cn("shrink-0 font-mono text-sm", amountInvalid && "text-destructive")}
          />
          <Pencil className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
        <Button
          variant="ghost"
          className="min-h-11 min-w-11 shrink-0 px-2"
          aria-label={`Dividir ${itemLabel}`}
          aria-expanded={panel === "division"}
          aria-describedby={assignmentId}
          onClick={() => onTogglePanel(index, "division")}
        >
          {assignedPeople.length > 0 ? (
            <AvatarStack people={assignedPeople} max={3} size="xs" />
          ) : (
            <Users className="size-4" aria-hidden="true" />
          )}
        </Button>
        <span id={assignmentId} className="sr-only">
          {assignedPeople.length > 0
            ? `Atribuído a ${assignedPeople.map((person) => person.name).join(", ")}`
            : "Sem atribuição"}
        </span>
      </div>
      {invalid && (
        <div className="space-y-1 px-4 pb-2 text-xs text-destructive">
          {nameInvalid && <p id={nameErrorId}>Informe o nome do item.</p>}
          {amountInvalid && <p id={amountErrorId}>Valor incompatível com a quantidade.</p>}
        </div>
      )}
      {panel === "details" && (
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
            onClick={() => onTogglePanel(index, "details")}
          >
            Pronto
          </Button>
        </div>
      )}
      {panel === "division" && (
        <ItemDivisionEditor
          itemId={`receipt-item-${index}`}
          itemName={item.description}
          itemCents={item.totalCents}
          participants={participants}
          value={division ?? null}
          onSave={(value) => onSaveDivision(index, value)}
          onCancel={onCancelDivision}
        />
      )}
    </Fragment>
  );
}
