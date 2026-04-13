import type { DebtStatus } from "@/types";

const DEBT_STATUSES = ["pending", "partially_paid", "settled"] as const;

export function isDebtStatus(value: unknown): value is DebtStatus {
  return typeof value === "string" && DEBT_STATUSES.includes(value as DebtStatus);
}

export function coerceDebtStatus(value: unknown, fallback: DebtStatus): DebtStatus {
  return isDebtStatus(value) ? value : fallback;
}
