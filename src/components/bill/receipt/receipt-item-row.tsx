"use client";

import { Fragment } from "react";
import { Users } from "lucide-react";
import { AvatarStack } from "@/components/shared/avatar-stack";
import { ItemDivisionEditor, type ItemDivisionParticipant } from "@/components/bill/item-division-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isDivisionValid, type ItemDivisionValue } from "@/lib/item-division";
import type { ReceiptItem } from "@/lib/receipt-ocr";

export interface ReceiptItemRowProps {
  item: ReceiptItem;
  index: number;
  amountText: string;
  amountInvalid: boolean;
  nameInvalid: boolean;
  selected: boolean;
  expanded: boolean;
  division?: ItemDivisionValue;
  participants: ItemDivisionParticipant[];
  onToggleSelected: (index: number) => void;
  onToggleExpanded: (index: number) => void;
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
  selected,
  expanded,
  division,
  participants,
  onToggleSelected,
  onToggleExpanded,
  onNameChange,
  onAmountChange,
  onSaveDivision,
  onCancelDivision,
}: ReceiptItemRowProps) {
  const itemLabel = item.description.trim() || "item";
  const nameErrorId = `receipt-item-${index}-name-error`;
  const amountErrorId = `receipt-item-${index}-amount-error`;
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
        <label className="flex min-h-11 min-w-11 shrink-0 items-center justify-center">
          <input
            type="checkbox"
            className="size-5 accent-primary"
            aria-label={`Selecionar ${itemLabel}`}
            checked={selected}
            onChange={() => onToggleSelected(index)}
          />
        </label>
        <Input
          value={item.description}
          onChange={(event) => onNameChange(index, event.target.value)}
          aria-label={`Nome de ${itemLabel}`}
          aria-invalid={nameInvalid}
          aria-describedby={nameInvalid ? nameErrorId : undefined}
          className="h-11 min-w-0 flex-1 border-0 bg-transparent px-0 shadow-none"
        />
        <Input
          value={amountText}
          onChange={(event) => onAmountChange(index, event.target.value)}
          inputMode="decimal"
          aria-label={`Valor de ${itemLabel}`}
          aria-invalid={amountInvalid}
          aria-describedby={amountInvalid ? amountErrorId : undefined}
          className="h-11 w-20 min-w-0 shrink-0 border-0 bg-transparent px-0 text-right font-mono shadow-none"
        />
        {assignedPeople.length > 0 ? (
          <AvatarStack people={assignedPeople} max={3} size="xs" />
        ) : (
          <Badge variant="secondary" className="shrink-0">
            Pendente
          </Badge>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="min-h-11 min-w-11 shrink-0"
          aria-label={`Dividir ${itemLabel}`}
          aria-expanded={expanded}
          onClick={() => onToggleExpanded(index)}
        >
          <Users className="size-4" />
        </Button>
      </div>
      {(nameInvalid || amountInvalid) && (
        <div className="space-y-1 px-4 pb-2 text-xs text-destructive">
          {nameInvalid && <p id={nameErrorId}>Informe o nome do item.</p>}
          {amountInvalid && <p id={amountErrorId}>Valor incompatível com a quantidade.</p>}
        </div>
      )}
      {expanded && (
        <div className="px-3 pb-4 pt-1">
          <ItemDivisionEditor
            itemId={`receipt-item-${index}`}
            itemName={item.description}
            itemCents={item.totalCents}
            participants={participants}
            value={division ?? null}
            onSave={(value) => onSaveDivision(index, value)}
            onCancel={onCancelDivision}
          />
        </div>
      )}
    </Fragment>
  );
}
