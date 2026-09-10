import { centsText, percentText, type ItemDivisionMode } from "@/lib/item-division";
import type { AmountSplit } from "@/stores/bill-store";

export function initialMode(billSplits: AmountSplit[]): ItemDivisionMode {
  const splitType = billSplits[0]?.splitType;
  if (splitType === "percentage") return "percent";
  return splitType === "fixed" ? "fixed" : "equal";
}

export function initialPercentTexts(billSplits: AmountSplit[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const split of billSplits) {
    if (split.splitType === "percentage") {
      values[split.userId] = percentText(Math.round(split.value * 100));
    }
  }
  return values;
}

export function initialFixedTexts(billSplits: AmountSplit[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const split of billSplits) {
    if (split.splitType === "fixed") values[split.userId] = centsText(split.computedAmountCents);
  }
  return values;
}
