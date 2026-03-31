import type { ReceiptItem, ReceiptOcrResult } from "./receipt-ocr";

/**
 * Sanitize a single receipt item.
 *
 * Trusts `totalCents` as the ground truth for what the customer paid for that
 * line. Derives `unitPriceCents` from it instead of the other way around,
 * because OCR models and HTML parsers often put the line total in the unit
 * price field when quantity > 1.
 */
function sanitizeItem(item: ReceiptItem): ReceiptItem {
  const quantity = Math.max(0.001, item.quantity);
  const totalCents = Math.round(item.totalCents);
  const rawUnit = Math.round(item.unitPriceCents);

  if (quantity === 1) {
    return { ...item, quantity, unitPriceCents: totalCents, totalCents };
  }

  const derivedTotal = Math.round(rawUnit * quantity);
  const unitFromTotal = Math.round(totalCents / quantity);

  // Clear OCR mistake: unit price equals line total (not divided by qty)
  if (rawUnit === totalCents) {
    return { ...item, quantity, unitPriceCents: unitFromTotal, totalCents };
  }

  // Consistent within rounding: keep unit price as-is
  if (Math.abs(derivedTotal - totalCents) <= quantity) {
    return { ...item, quantity, unitPriceCents: rawUnit, totalCents };
  }

  // Inconsistent: trust totalCents, derive unit price
  return { ...item, quantity, unitPriceCents: unitFromTotal, totalCents };
}

/**
 * Post-process a full receipt OCR result:
 * 1. Fix per-item arithmetic (trusts totalCents, derives unitPriceCents)
 * 2. Compare item sum + service fee against receipt total
 * 3. If the gap is within rounding tolerance (≤1 centavo per item): adjust
 *    the largest items to absorb it
 * 4. If the gap is larger: attach `totalMismatch: true` so the UI can warn
 *    the user without blocking confirmation
 */
export function sanitizeReceiptResult(
  result: ReceiptOcrResult,
): ReceiptOcrResult & { totalMismatch?: boolean } {
  const items = result.items.map(sanitizeItem);
  const receiptTotal = Math.round(result.totalCents);
  const feePercent = Math.max(0, result.serviceFeePercent);

  const itemsSum = items.reduce((s, i) => s + i.totalCents, 0);
  const feeAmount = Math.round((itemsSum * feePercent) / 100);
  const expectedTotal = itemsSum + feeAmount;

  if (receiptTotal === 0 || items.length === 0) {
    return { ...result, items, totalCents: itemsSum };
  }

  const gap = receiptTotal - expectedTotal;
  const tolerance = items.length; // 1 centavo per item for rounding drift

  if (Math.abs(gap) <= tolerance) {
    // Small rounding gap: absorb it into item totals (not into receipt total)
    const corrected = absorb(items, gap);
    return { ...result, items: corrected, totalCents: receiptTotal };
  }

  // Heuristic: OCR may have multiplied qty × unitPrice into totalCents when the
  // receipt already showed the line total. If dividing totalCents by qty for
  // multi-quantity items brings the sum close to the receipt total, apply the fix.
  if (gap < 0) {
    const deflated = items.map((item) => {
      if (item.quantity > 1) {
        const correctedTotal = Math.round(item.totalCents / item.quantity);
        return {
          ...item,
          totalCents: correctedTotal,
          unitPriceCents: Math.round(correctedTotal / item.quantity),
        };
      }
      return item;
    });
    const deflatedSum = deflated.reduce((s, i) => s + i.totalCents, 0);
    const deflatedFee = Math.round((deflatedSum * feePercent) / 100);
    const deflatedGap = receiptTotal - (deflatedSum + deflatedFee);
    if (Math.abs(deflatedGap) <= tolerance) {
      const corrected = absorb(deflated, deflatedGap);
      return { ...result, items: corrected, totalCents: receiptTotal };
    }
  }

  // Gap too large to auto-correct
  return { ...result, items, totalCents: receiptTotal, totalMismatch: true };
}

/**
 * Add/subtract centavos from items (largest first) to absorb a rounding gap.
 */
function absorb(items: ReceiptItem[], gap: number): ReceiptItem[] {
  if (gap === 0) return items;

  const order = [...items]
    .map((_, i) => i)
    .sort((a, b) => items[b].totalCents - items[a].totalCents);

  const result = [...items];
  const step = gap > 0 ? 1 : -1;
  let left = Math.abs(gap);

  for (const i of order) {
    if (left === 0) break;
    const newTotal = result[i].totalCents + step;
    result[i] = {
      ...result[i],
      totalCents: newTotal,
      unitPriceCents:
        result[i].quantity === 1
          ? newTotal
          : Math.round(newTotal / result[i].quantity),
    };
    left--;
  }

  return result;
}
