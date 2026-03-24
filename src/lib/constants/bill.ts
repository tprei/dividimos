import type { BillType } from "@/types";

/**
 * Default service fee percentages based on bill type.
 * Itemized bills typically include a 10% service fee.
 * Single-amount bills have no service fee by default.
 */
export const DEFAULT_SERVICE_FEE_PERCENT: Record<BillType, number> = {
  itemized: 10,
  single_amount: 0,
} as const;

/**
 * Default fixed fees for bills (delivery, cover, etc.)
 */
export const DEFAULT_FIXED_FEES = 0;

/**
 * Threshold in centavos for considering a balance as "settled"
 * Accounts for rounding errors in split calculations
 */
export const SETTLEMENT_THRESHOLD_CENTS = 1;
