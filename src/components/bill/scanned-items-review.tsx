"use client";

import { motion } from "framer-motion";
import { Users } from "lucide-react";
import { useState } from "react";
import { useBackHandler } from "@/hooks/use-back-handler";
import type { ItemDivisionParticipant } from "@/components/bill/item-division-editor";
import { ReceiptItemRow } from "@/components/bill/receipt/receipt-item-row";
import { AvatarStack } from "@/components/shared/avatar-stack";
import { Money } from "@/components/shared/money";
import { ScreenHeader } from "@/components/shared/screen-header";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import {
  MAX_EXPENSE_CENTS,
  MAX_EXPENSE_SOURCE_ITEM_DESCRIPTION_CODE_POINTS,
  computeServiceFeeCents,
  formatServiceFeeBasisPoints,
  parseExpenseCentsText,
  parseServiceFeeBasisPoints,
  parseServiceFeeBasisPointsText,
} from "@/lib/expense-money";
import { centsText } from "@/lib/item-division";
import { parseExpenseQuantity, unitPriceCentsForLineTotal } from "@/lib/expense-quantity";
import { todayIsoDate } from "@/app/app/bill/new/use-wizard-submit";
import type { ReceiptItem, ReceiptOcrResult } from "@/lib/receipt-ocr";

function quantityToMilliunits(raw: number): number {
  const parsed = parseExpenseQuantity(raw);
  return parsed.ok ? (parsed.value as number) : 1000;
}

function unitPriceForTotal(item: ReceiptItem, totalCents: number): number | null {
  return unitPriceCentsForLineTotal(item.quantity, totalCents);
}

function amountCentsForText(text: string): number | null {
  const parsed = parseExpenseCentsText(text, {
    format: "plain_decimal",
    zeroPolicy: "positive",
  });
  return parsed.ok ? (parsed.value as number) : null;
}

function isDescriptionValid(description: string): boolean {
  const trimmed = description.trim();
  return (
    trimmed.length > 0 &&
    Array.from(trimmed).length <= MAX_EXPENSE_SOURCE_ITEM_DESCRIPTION_CODE_POINTS
  );
}

function isOccurredOnValid(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().startsWith(value);
}

function isAmountValid(item: ReceiptItem, text: string): boolean {
  const amount = amountCentsForText(text);
  return amount !== null && unitPriceForTotal(item, amount) !== null;
}

export interface ScannedItemsReviewProps {
  result: ReceiptOcrResult;
  participants: ItemDivisionParticipant[];
  initialOccurredOn?: string;
  onConfirm: (result: ReceiptOcrResult, occurredOn: string) => void;
  onCancel: () => void;
  onManageParticipants: () => void;
}

export function ScannedItemsReview({
  result,
  participants,
  initialOccurredOn,
  onConfirm,
  onCancel,
  onManageParticipants,
}: ScannedItemsReviewProps) {
  const [items, setItems] = useState<ReceiptItem[]>(() =>
    result.items.map((item) => ({
      ...item,
      quantity: quantityToMilliunits(item.quantity),
    })),
  );
  const [amountTexts, setAmountTexts] = useState<Record<number, string>>(() =>
    Object.fromEntries(result.items.map((item, index) => [index, centsText(item.totalCents)])),
  );
  const [merchant, setMerchant] = useState(result.merchant ?? "");
  const [occurredOn, setOccurredOn] = useState(initialOccurredOn || todayIsoDate);
  const [serviceFee, setServiceFee] = useState(() => {
    const parsed = parseServiceFeeBasisPoints(result.serviceFeeBasisPoints);
    return parsed.ok ? formatServiceFeeBasisPoints(parsed.value).replace("%", "") : "0";
  });
  const [panel, setPanel] = useState<{ index: number } | null>(null);
  useBackHandler(panel !== null, () => setPanel(null));

  const subtotalCents = items.reduce((sum, item) => sum + item.totalCents, 0);
  const serviceFeeResult = parseServiceFeeBasisPointsText(serviceFee || "0");
  const serviceFeeCentsResult = serviceFeeResult.ok
    ? computeServiceFeeCents(subtotalCents, serviceFeeResult.value)
    : null;
  const serviceFeeCents = serviceFeeCentsResult?.ok ? serviceFeeCentsResult.value : 0;
  const totalCents = subtotalCents + serviceFeeCents + result.fixedFeesCents;
  const amountsValid = items.every((item, index) =>
    isAmountValid(item, amountTexts[index] ?? ""),
  );
  const descriptionsValid = items.every((item) => isDescriptionValid(item.description));
  const totalWithinCap = totalCents <= (MAX_EXPENSE_CENTS as number);
  const canConfirm =
    participants.length >= 2 &&
    items.length > 0 &&
    amountsValid &&
    descriptionsValid &&
    totalWithinCap &&
    isOccurredOnValid(occurredOn) &&
    serviceFeeResult.ok &&
    serviceFeeCentsResult?.ok === true;

  const handleNameChange = (index: number, value: string) => {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, description: value } : item,
      ),
    );
  };

  const handleAmountChange = (index: number, text: string) => {
    setAmountTexts((current) => ({ ...current, [index]: text }));
    const total = amountCentsForText(text);
    if (total === null) return;
    const currentItem = items[index];
    if (!currentItem) return;
    const unitPriceCents = unitPriceForTotal(currentItem, total);
    if (unitPriceCents === null) return;
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, totalCents: total, unitPriceCents } : item,
      ),
    );
  };

  const handleRemoveItem = (index: number) => {
    setItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setAmountTexts((current) => {
      const next: Record<number, string> = {};
      for (const [key, text] of Object.entries(current)) {
        const position = Number(key);
        if (position === index) continue;
        next[position > index ? position - 1 : position] = text;
      }
      return next;
    });
    setPanel(null);
  };

  const togglePanel = (index: number) => {
    setPanel((current) => (current?.index === index ? null : { index }));
  };

  const handleContinue = () => {
    if (!canConfirm || !serviceFeeResult.ok) return;
    onConfirm(
      {
        ...result,
        merchant: merchant.trim() || null,
        items,
        serviceFeeBasisPoints: serviceFeeResult.value,
        totalCents,
      },
      occurredOn,
    );
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
      <ScreenHeader back onBack={onCancel} eyebrow="Leitura" title="Recibo" />
      <div className="px-4">
        <div className="overflow-hidden rounded-2xl border bg-card">
          <div className="px-4 pb-4 pt-6 text-center">
            <Input
              value={merchant}
              onChange={(event) => setMerchant(event.target.value)}
              aria-label="Nome do estabelecimento"
              placeholder="Nome do estabelecimento"
              className="h-11 border-0 bg-transparent px-0 text-center text-base font-bold uppercase tracking-[0.12em] shadow-none"
            />
            <div className="mx-auto mt-2 w-fit">
              <DateField label="Data do recibo" value={occurredOn} onChange={setOccurredOn} />
            </div>
            {!isOccurredOnValid(occurredOn) && (
              <p id="receipt-occurred-on-error" className="mt-2 text-xs leading-4 text-destructive">
                Informe uma data válida.
              </p>
            )}
          </div>
          <div className="border-t border-dashed" />
          <button
            type="button"
            onClick={onManageParticipants}
            aria-label={`Participantes: ${participants.map((person) => person.name.split(" ")[0]).join(", ")}`}
            className="flex min-h-14 w-full items-center justify-between gap-3 px-4 text-left transition-colors hover:bg-muted/40"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Users className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate text-sm font-semibold">
                {participants.length > 1
                  ? participants.map((person) => person.name.split(" ")[0]).join(", ")
                  : "Adicionar pessoas"}
              </span>
            </span>
            <AvatarStack people={participants} />
          </button>
          <div className="border-t border-dashed" />
          {items.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Nenhum item. Tente escanear novamente ou adicione manualmente.
            </p>
          )}
          {items.map((item, index) => (
            <ReceiptItemRow
              key={index}
              item={item}
              index={index}
              amountText={amountTexts[index] ?? centsText(item.totalCents)}
              amountInvalid={!isAmountValid(item, amountTexts[index] ?? centsText(item.totalCents))}
              nameInvalid={!isDescriptionValid(item.description)}
              panelOpen={panel?.index === index}
              onTogglePanel={togglePanel}
              onNameChange={handleNameChange}
              onAmountChange={handleAmountChange}
              onRemove={handleRemoveItem}
            />
          ))}
          <div className="border-t border-dashed" />
          <div className="px-4 py-2">
            <div className="flex items-baseline justify-between gap-3 py-2">
              <span className="text-sm leading-5">Subtotal</span>
              <Money cents={subtotalCents} className="text-sm" />
            </div>
            <div className="flex min-h-14 items-center gap-3 py-2">
              <label htmlFor="receipt-service-fee" className="min-w-0 flex-1 text-sm leading-5">
                Taxa de serviço (%)
              </label>
              <Input
                id="receipt-service-fee"
                value={serviceFee}
                onChange={(event) =>
                  setServiceFee(event.target.value.replace(/[^\d,.]/g, ""))
                }
                inputMode="decimal"
                aria-invalid={!serviceFeeResult.ok}
                aria-describedby={!serviceFeeResult.ok ? "receipt-service-fee-error" : undefined}
                className="h-11 w-24 shrink-0 bg-transparent text-right font-mono"
              />
            </div>
            {!serviceFeeResult.ok && (
              <p id="receipt-service-fee-error" className="pb-2 text-xs leading-4 text-destructive">
                Taxa de serviço inválida.
              </p>
            )}
            <div className="flex min-h-14 items-baseline justify-between gap-3 py-2">
              <span className="text-sm leading-5 font-bold uppercase tracking-[0.12em]">
                Total
              </span>
              <Money cents={totalCents} className="text-base font-bold" />
            </div>
            {!totalWithinCap && (
              <p className="pb-2 text-xs leading-4 text-destructive">
                O total excede o limite permitido.
              </p>
            )}
          </div>
        </div>
      </div>
      <footer className="sticky bottom-0 border-t bg-background/95 px-4 py-3 backdrop-blur safe-bottom">
        {participants.length < 2 && (
          <p className="mb-2 text-center text-xs leading-4 text-muted-foreground">
            Adicione pelo menos uma pessoa além de você.
          </p>
        )}
        <Button
          className="min-h-11 w-full text-base font-bold"
          onClick={handleContinue}
          disabled={!canConfirm}
        >
          Continuar para divisão
        </Button>
      </footer>
    </motion.div>
  );
}
