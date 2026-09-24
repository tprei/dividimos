import { formatBRL } from "@/lib/currency";
import {
  allocateByBasisPoints,
  allocateEvenly,
  parseAllocationPercentText,
  parseExpenseCents,
  parseExpenseCentsText,
} from "@/lib/expense-money";
import type { ExpenseItem, SplitType } from "@/types";


export type ItemDivisionMode = "equal" | "percent" | "fixed";

export interface ItemDivisionShare {
  participantId: string;
  cents: number;
  basisPoints?: number;
}

export interface ItemDivisionValue {
  mode: ItemDivisionMode;
  shares: ItemDivisionShare[];
}

export const FULL_PERCENT_BASIS_POINTS = 10_000;
interface ItemDivisionSplit {
  itemId: string;
  userId: string;
  splitType: SplitType;
  value: number;
  computedAmountCents: number;
}

export type DivisionComputation =
  | { ok: true; centsById: Record<string, number>; basisPointsById?: Record<string, number> }
  | { ok: false; reason: "empty" }
  | { ok: false; reason: "invalid_input" }
  | { ok: false; reason: "total"; remainder: number };

export function percentText(basisPoints: number): string {
  return (basisPoints / 100).toFixed(2).replace(".", ",");
}

export function centsText(cents: number): string {
  return `${Math.floor(cents / 100)},${(cents % 100).toString().padStart(2, "0")}`;
}

export function computeDivision(
  itemCents: number,
  mode: ItemDivisionMode,
  selectedIds: readonly string[],
  percentTexts: Record<string, string>,
  fixedTexts: Record<string, string>,
): DivisionComputation {
  if (selectedIds.length === 0) return { ok: false, reason: "empty" };
  if (mode === "equal") {
    const allocated = allocateEvenly(itemCents, selectedIds.length);
    if (!allocated.ok) return { ok: false, reason: "invalid_input" };
    const centsById: Record<string, number> = {};
    selectedIds.forEach((id, index) => {
      centsById[id] = allocated.value[index];
    });
    return { ok: true, centsById };
  }
  if (mode === "percent") {
    const weights: number[] = [];
    const basisPointsById: Record<string, number> = {};
    for (const id of selectedIds) {
      const parsed = parseAllocationPercentText(percentTexts[id] ?? "");
      if (!parsed.ok) return { ok: false, reason: "invalid_input" };
      weights.push(parsed.value);
      basisPointsById[id] = parsed.value;
    }
    const remainder = FULL_PERCENT_BASIS_POINTS - weights.reduce((sum, weight) => sum + weight, 0);
    if (remainder !== 0) return { ok: false, reason: "total", remainder };
    const allocated = allocateByBasisPoints(itemCents, weights);
    if (!allocated.ok) return { ok: false, reason: "invalid_input" };
    const centsById: Record<string, number> = {};
    selectedIds.forEach((id, index) => {
      centsById[id] = allocated.value[index];
    });
    return { ok: true, centsById, basisPointsById };
  }
  const centsById: Record<string, number> = {};
  let sum = 0;
  for (const id of selectedIds) {
    const parsed = parseExpenseCentsText(fixedTexts[id] ?? "", { format: "plain_decimal", zeroPolicy: "allow" });
    if (!parsed.ok) return { ok: false, reason: "invalid_input" };
    centsById[id] = parsed.value;
    sum += parsed.value;
  }
  const remainder = itemCents - sum;
  if (remainder !== 0) return { ok: false, reason: "total", remainder };
  return { ok: true, centsById };
}

// BigInt constants rather than literals: the compile target predates `1n`.
const BASIS_POINTS_BIG = BigInt(10_000);
const HALF_UP_BIAS_BIG = BigInt(5_000);
const TWO_BIG = BigInt(2);

/** Presentation-only per-row preview values. `null` = no preview for that row. */
export interface DivisionPreview {
  centsById: Record<string, number | null>;
  basisPointsById: Record<string, number | null>;
}

/**
 * Per-row split preview that stays useful while the division does not close
 * yet: a valid computation reuses its exact allocated cents (remainder
 * included); otherwise each authored field is parsed independently, so one
 * invalid row never blanks the others and nothing is normalized to 100%.
 * Integer-only arithmetic; these values never feed saved shares.
 */
export function previewDivision(
  itemCents: number,
  mode: ItemDivisionMode,
  selectedIds: readonly string[],
  percentTexts: Record<string, string>,
  fixedTexts: Record<string, string>,
  division: DivisionComputation,
): DivisionPreview {
  const centsById: Record<string, number | null> = {};
  const basisPointsById: Record<string, number | null> = {};
  const total = parseExpenseCents(itemCents, "allow");
  if (!total.ok) {
    for (const id of selectedIds) {
      centsById[id] = null;
      basisPointsById[id] = null;
    }
    return { centsById, basisPointsById };
  }
  const totalBig = BigInt(total.value);
  const previewAuthoredRow = (id: string): void => {
    if (mode === "percent") {
      const parsed = parseAllocationPercentText(percentTexts[id] ?? "");
      if (!parsed.ok) {
        centsById[id] = null;
        basisPointsById[id] = null;
        return;
      }
      basisPointsById[id] = parsed.value;
      centsById[id] =
        Number((totalBig * BigInt(parsed.value) + HALF_UP_BIAS_BIG) / BASIS_POINTS_BIG);
      return;
    }
    if (mode === "fixed") {
      const parsed = parseExpenseCentsText(fixedTexts[id] ?? "", {
        format: "plain_decimal",
        zeroPolicy: "allow",
      });
      if (!parsed.ok) {
        centsById[id] = null;
        basisPointsById[id] = null;
        return;
      }
      centsById[id] = parsed.value;
      // Display-only half-up ratio of the authored value over the item total.
      basisPointsById[id] =
        total.value === 0
          ? null
          : Number(
              (TWO_BIG * BigInt(parsed.value) * BASIS_POINTS_BIG + totalBig) /
                (TWO_BIG * totalBig),
            );
      return;
    }
    centsById[id] = 0;
    basisPointsById[id] = null;
  };
  if (division.ok) {
    for (const id of selectedIds) {
      if (division.centsById[id] === undefined) {
        previewAuthoredRow(id);
        continue;
      }
      centsById[id] = division.centsById[id];
      basisPointsById[id] = division.basisPointsById?.[id] ?? null;
    }
    return { centsById, basisPointsById };
  }
  if (mode === "equal") {
    const equal = allocateEvenly(total.value, selectedIds.length);
    selectedIds.forEach((id, index) => {
      centsById[id] = equal.ok ? equal.value[index] : null;
      basisPointsById[id] = null;
    });
    return { centsById, basisPointsById };
  }
  for (const id of selectedIds) previewAuthoredRow(id);
  return { centsById, basisPointsById };
}

export function equalDivision(participantIds: readonly string[], cents: number): ItemDivisionValue | null {
  const shares = allocateEvenly(cents, participantIds.length);
  if (!shares.ok) return null;
  return {
    mode: "equal",
    shares: participantIds.map((participantId, index) => ({ participantId, cents: shares.value[index] })),
  };
}

export function isDivisionValid(value: ItemDivisionValue, cents: number): boolean {
  if (value.shares.length === 0 || !Number.isInteger(cents) || cents < 0) return false;
  const ids = new Set<string>();
  for (const share of value.shares) {
    if (ids.has(share.participantId) || !Number.isInteger(share.cents) || share.cents < 0) return false;
    ids.add(share.participantId);
  }
  if (value.shares.reduce((sum, share) => sum + share.cents, 0) !== cents) return false;
  if (value.mode !== "percent") return true;
  return (
    value.shares.every(
      (share) =>
        share.basisPoints !== undefined &&
        Number.isInteger(share.basisPoints) &&
        share.basisPoints >= 0 &&
        share.basisPoints <= FULL_PERCENT_BASIS_POINTS,
    ) &&
    value.shares.reduce((sum, share) => sum + (share.basisPoints ?? 0), 0) === FULL_PERCENT_BASIS_POINTS
  );
}

export function divisionForItem(
  item: Pick<ExpenseItem, "id" | "totalPriceCents">,
  splits: readonly ItemDivisionSplit[],
): ItemDivisionValue | null {
  const itemSplits = splits.filter((split) => split.itemId === item.id);
  if (itemSplits.length === 0) return null;
  const storedMode = itemSplits[0].splitType;
  if (itemSplits.some((split) => split.splitType !== storedMode)) return null;
  const mode: ItemDivisionMode = storedMode === "percentage" ? "percent" : storedMode;
  const value: ItemDivisionValue = {
    mode,
    shares: itemSplits.map((split) => ({
      participantId: split.userId,
      cents: split.computedAmountCents,
      ...(mode === "percent" ? { basisPoints: Math.round(split.value * 100) } : {}),
    })),
  };
  return isDivisionValid(value, item.totalPriceCents) ? value : null;
}

export function assignedDivisionForItem(
  item: Pick<ExpenseItem, "id" | "totalPriceCents">,
  splits: readonly ItemDivisionSplit[],
  peopleIds: ReadonlySet<string>,
): ItemDivisionValue | null {
  const division = divisionForItem(item, splits);
  if (!division) return null;
  return division.shares.every((share) => peopleIds.has(share.participantId)) ? division : null;
}

export function isItemAssigned(
  item: Pick<ExpenseItem, "id" | "totalPriceCents">,
  splits: readonly ItemDivisionSplit[],
  peopleIds: ReadonlySet<string>,
): boolean {
  return assignedDivisionForItem(item, splits, peopleIds) !== null;
}

export function recomputeDivisionShares(value: ItemDivisionValue, cents: number): ItemDivisionValue {
  const participantIds = value.shares.map((share) => share.participantId);
  if (participantIds.length === 0 || value.mode === "fixed") return value;
  if (value.mode === "percent") {
    const weights = value.shares.map((share) => share.basisPoints ?? 0);
    const allocated = allocateByBasisPoints(cents, weights);
    if (allocated.ok) {
      return {
        mode: value.mode,
        shares: participantIds.map((participantId, index) => ({
          participantId,
          cents: allocated.value[index],
          basisPoints: weights[index],
        })),
      };
    }
  }
  const equal = allocateEvenly(cents, participantIds.length);
  if (!equal.ok) return value;
  return {
    mode: value.mode,
    shares: participantIds.map((participantId, index) => ({ participantId, cents: equal.value[index] })),
  };
}

export function divisionInvalidInputText(mode: ItemDivisionMode): string {
  return mode === "percent"
    ? "Percentuais vão de 0 a 100, com até duas casas decimais."
    : "Valores em reais, com até duas casas decimais.";
}

export function divisionStatusText(division: DivisionComputation, mode: ItemDivisionMode): string {
  if (division.ok) return "Totais conferem com o valor do item.";
  if (division.reason === "empty") return "Ninguém divide este item ainda.";
  if (division.reason === "invalid_input") return divisionInvalidInputText(mode);
  if (mode === "percent") {
    const text = percentText(Math.abs(division.remainder));
    return division.remainder > 0 ? `Faltam ${text}% para fechar 100%.` : `Excede ${text}% do valor do item.`;
  }
  const money = formatBRL(Math.abs(division.remainder));
  return division.remainder > 0 ? `Faltam ${money} para fechar o item.` : `Excede ${money} do valor do item.`;
}

/**
 * Integer half-up basis points for a centavo share of a total: the seeded
 * percentages always sum to the true share (never re-rounded by consumers).
 */
export function centsToBasisPoints(cents: number, totalCents: number): number {
  if (totalCents <= 0) return 0;
  return Math.floor((cents * FULL_PERCENT_BASIS_POINTS + Math.floor(totalCents / 2)) / totalCents);
}
