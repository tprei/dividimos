"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { useBackHandler } from "@/hooks/use-back-handler";
import type { ItemDivisionParticipant } from "@/components/bill/item-division-editor";
import { ReceiptBatchDialog } from "@/components/bill/receipt/receipt-batch-dialog";
import { ReceiptItemRow } from "@/components/bill/receipt/receipt-item-row";
import { Money } from "@/components/shared/money";
import { ScreenHeader } from "@/components/shared/screen-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import {
  computeServiceFeeCents,
  formatServiceFeeBasisPoints,
  parseExpenseCentsText,
  parseServiceFeeBasisPoints,
  parseServiceFeeBasisPointsText,
} from "@/lib/expense-money";
import {
  centsText,
  equalDivision,
  isDivisionValid,
  recomputeDivisionShares,
  type ItemDivisionValue,
} from "@/lib/item-division";
import {
  MAX_EXPENSE_CENTS,
  MAX_EXPENSE_SOURCE_ITEM_DESCRIPTION_CODE_POINTS,
} from "@/lib/expense-money";
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
  onConfirm: (
    result: ReceiptOcrResult,
    divisions: Record<number, ItemDivisionValue>,
    occurredOn: string,
  ) => void;
  onCancel: () => void;
}

export function ScannedItemsReview({
  result,
  participants,
  initialOccurredOn,
  onConfirm,
  onCancel,
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
  const [divisions, setDivisions] = useState<Record<number, ItemDivisionValue>>({});
  const [selectedIndexes, setSelectedIndexes] = useState<Set<number>>(() => new Set());
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  useBackHandler(expandedIndex !== null && !batchOpen, () => setExpandedIndex(null));

  const subtotalCents = items.reduce((sum, item) => sum + item.totalCents, 0);
  const serviceFeeResult = parseServiceFeeBasisPointsText(serviceFee || "0");
  const serviceFeeCentsResult = serviceFeeResult.ok
    ? computeServiceFeeCents(subtotalCents, serviceFeeResult.value)
    : null;
  const serviceFeeCents = serviceFeeCentsResult?.ok ? serviceFeeCentsResult.value : 0;
  const totalCents = subtotalCents + serviceFeeCents + result.fixedFeesCents;
  const pendingCount = items.reduce((count, item, index) => {
    const division = divisions[index];
    return division && isDivisionValid(division, item.totalCents) ? count : count + 1;
  }, 0);
  const amountsValid = items.every((item, index) =>
    isAmountValid(item, amountTexts[index] ?? ""),
  );
  const descriptionsValid = items.every((item) => isDescriptionValid(item.description));
  const totalWithinCap = totalCents <= (MAX_EXPENSE_CENTS as number);
  const canConfirm =
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
    setDivisions((current) => {
      const division = current[index];
      if (!division) return current;
      return { ...current, [index]: recomputeDivisionShares(division, total) };
    });
  };

  const handleSaveDivision = (index: number, value: ItemDivisionValue) => {
    setDivisions((current) => ({ ...current, [index]: value }));
    setExpandedIndex(null);
  };

  const toggleSelected = (index: number) => {
    setSelectedIndexes((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const applyBatch = (participantIds: string[]) => {
    setDivisions((current) => {
      const next = { ...current };
      for (const index of selectedIndexes) {
        const item = items[index];
        if (!item) continue;
        const division = equalDivision(participantIds, item.totalCents);
        if (division) next[index] = division;
      }
      return next;
    });
    setBatchOpen(false);
  };

  const handleContinue = () => {
    if (!canConfirm || !serviceFeeResult.ok) return;
    setSelectedIndexes(new Set());
    onConfirm(
      {
        ...result,
        merchant: merchant.trim() || null,
        items,
        serviceFeeBasisPoints: serviceFeeResult.value,
        totalCents,
      },
      divisions,
      occurredOn,
    );
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
      <ScreenHeader back onBack={onCancel} eyebrow="Leitura" title="Recibo" />
      <div className="px-4">
        <div className="overflow-hidden rounded-2xl border bg-card">
          <div className="h-1 bg-primary" />
          <div className="flex items-start justify-between gap-2 px-4 pb-2 pt-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                Recibo lido
              </p>
              <Input
                value={merchant}
                onChange={(event) => setMerchant(event.target.value)}
                aria-label="Nome do estabelecimento"
                placeholder="Nome do estabelecimento"
                className="mt-1 h-11 border-0 bg-transparent px-0 text-base font-bold shadow-none"
              />
              <DateField
                label="Data do recibo"
                value={occurredOn}
                onChange={setOccurredOn}
              />
              {!isOccurredOnValid(occurredOn) && (
                <p id="receipt-occurred-on-error" className="text-xs text-destructive">
                  Informe uma data válida.
                </p>
              )}
            </div>
            <Badge variant="secondary" className="shrink-0">
              {pendingCount} {pendingCount === 1 ? "pendente" : "pendentes"}
            </Badge>
          </div>
          <div className="divide-y divide-border border-t">
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
                selected={selectedIndexes.has(index)}
                expanded={expandedIndex === index}
                division={divisions[index]}
                participants={participants}
                onToggleSelected={toggleSelected}
                onToggleExpanded={(itemIndex) =>
                  setExpandedIndex((current) => (current === itemIndex ? null : itemIndex))
                }
                onNameChange={handleNameChange}
                onAmountChange={handleAmountChange}
                onSaveDivision={handleSaveDivision}
                onCancelDivision={() => setExpandedIndex(null)}
              />
            ))}
            <div className="flex min-h-14 items-center gap-3 px-4 py-2">
              <label htmlFor="receipt-service-fee" className="min-w-0 flex-1 text-sm">
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
              <p id="receipt-service-fee-error" className="px-4 py-2 text-xs text-destructive">
                Taxa de serviço inválida.
              </p>
            )}
            {result.fixedFeesCents > 0 && (
              <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">
                <p className="min-w-0 flex-1 text-sm">Taxa impressa na nota</p>
                <Money cents={result.fixedFeesCents} className="shrink-0" />
              </div>
            )}
            <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">
              <p className="text-sm font-bold">Total</p>
              <Money cents={totalCents} className="shrink-0 font-bold" />
            </div>
            {!totalWithinCap && (
              <p className="px-4 py-2 text-xs text-destructive">
                O total excede o limite permitido.
              </p>
            )}
          </div>
        </div>
      </div>
      <footer className="sticky bottom-0 border-t bg-background/95 px-4 py-3 backdrop-blur safe-bottom">
        {selectedIndexes.size === 0 ? (
          <Button className="min-h-11 w-full text-base font-bold" onClick={handleContinue} disabled={!canConfirm}>
            Continuar para divisão
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button
              variant="ghost"
              className="min-h-11"
              onClick={() => setSelectedIndexes(new Set())}
            >
              Limpar
            </Button>
            <Button
              className="min-h-11 flex-1 text-base font-bold"
              onClick={() => setBatchOpen(true)}
            >
              Atribuir · {selectedIndexes.size}
            </Button>
          </div>
        )}
      </footer>
      <ReceiptBatchDialog
        open={batchOpen}
        selectedCount={selectedIndexes.size}
        participants={participants}
        onOpenChange={setBatchOpen}
        onApply={applyBatch}
      />
    </motion.div>
  );
}
