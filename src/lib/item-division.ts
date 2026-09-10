import { formatBRL } from "@/lib/currency";
import {
  allocateByBasisPoints,
  allocateEvenly,
  parseAllocationPercentText,
  parseExpenseCentsText,
} from "@/lib/expense-money";

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

export function equalDivision(participantIds: readonly string[], cents: number): ItemDivisionValue | null {
  const shares = allocateEvenly(cents, participantIds.length);
  if (!shares.ok) return null;
  return {
    mode: "equal",
    shares: participantIds.map((participantId, index) => ({ participantId, cents: shares.value[index] })),
  };
}

export function isDivisionValid(value: ItemDivisionValue, cents: number): boolean {
  return value.shares.length > 0 && value.shares.reduce((sum, share) => sum + share.cents, 0) === cents;
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

export function divisionStatusText(division: DivisionComputation, mode: ItemDivisionMode): string {
  if (division.ok) return "Totais conferem com o valor do item.";
  if (division.reason === "empty") return "Selecione quem divide este item.";
  if (division.reason === "invalid_input") {
    return mode === "percent"
      ? "Informe percentuais de 0 a 100 com até duas casas decimais."
      : "Informe valores em reais com até duas casas decimais.";
  }
  if (mode === "percent") {
    const text = percentText(Math.abs(division.remainder));
    return division.remainder > 0 ? `Faltam ${text}% para fechar 100%.` : `Excede ${text}% do valor do item.`;
  }
  const money = formatBRL(Math.abs(division.remainder));
  return division.remainder > 0 ? `Faltam ${money} para fechar o item.` : `Excede ${money} do valor do item.`;
}
