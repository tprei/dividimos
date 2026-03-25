/**
 * Type guards for runtime validation of enum values.
 * These provide both compile-time and runtime safety for type assertions.
 */
import type {
  BillStatus,
  BillType,
  BillParticipantStatus,
  DebtStatus,
  GroupMemberStatus,
  PixKeyType,
  SplitType,
} from "@/types";

// Define const arrays for runtime checking
const BILL_STATUSES = ["draft", "active", "partially_settled", "settled"] as const;
const BILL_TYPES = ["single_amount", "itemized"] as const;
const BILL_PARTICIPANT_STATUSES = ["invited", "accepted", "declined"] as const;
const DEBT_STATUSES = ["pending", "paid_unconfirmed", "settled"] as const;
const GROUP_MEMBER_STATUSES = ["invited", "accepted"] as const;
const PIX_KEY_TYPES = ["phone", "cpf", "email", "random"] as const;
const SPLIT_TYPES = ["equal", "percentage", "fixed"] as const;

/**
 * Type guard for BillStatus enum.
 * @param value - The value to check
 * @returns true if value is a valid BillStatus
 */
export function isBillStatus(value: unknown): value is BillStatus {
  return typeof value === "string" && BILL_STATUSES.includes(value as BillStatus);
}

/**
 * Type guard for BillType enum.
 * @param value - The value to check
 * @returns true if value is a valid BillType
 */
export function isBillType(value: unknown): value is BillType {
  return typeof value === "string" && BILL_TYPES.includes(value as BillType);
}

/**
 * Type guard for BillParticipantStatus enum.
 * @param value - The value to check
 * @returns true if value is a valid BillParticipantStatus
 */
export function isBillParticipantStatus(
  value: unknown
): value is BillParticipantStatus {
  return (
    typeof value === "string" &&
    BILL_PARTICIPANT_STATUSES.includes(value as BillParticipantStatus)
  );
}

/**
 * Type guard for DebtStatus enum.
 * @param value - The value to check
 * @returns true if value is a valid DebtStatus
 */
export function isDebtStatus(value: unknown): value is DebtStatus {
  return typeof value === "string" && DEBT_STATUSES.includes(value as DebtStatus);
}

/**
 * Type guard for GroupMemberStatus enum.
 * @param value - The value to check
 * @returns true if value is a valid GroupMemberStatus
 */
export function isGroupMemberStatus(value: unknown): value is GroupMemberStatus {
  return (
    typeof value === "string" &&
    GROUP_MEMBER_STATUSES.includes(value as GroupMemberStatus)
  );
}

/**
 * Type guard for PixKeyType enum.
 * @param value - The value to check
 * @returns true if value is a valid PixKeyType
 */
export function isPixKeyType(value: unknown): value is PixKeyType {
  return typeof value === "string" && PIX_KEY_TYPES.includes(value as PixKeyType);
}

/**
 * Type guard for SplitType enum.
 * @param value - The value to check
 * @returns true if value is a valid SplitType
 */
export function isSplitType(value: unknown): value is SplitType {
  return typeof value === "string" && SPLIT_TYPES.includes(value as SplitType);
}

/**
 * Asserts that a value is a valid BillStatus, throwing if not.
 * @param value - The value to check
 * @param context - Optional context for error message
 * @throws Error if value is not a valid BillStatus
 */
export function assertBillStatus(value: unknown, context?: string): asserts value is BillStatus {
  if (!isBillStatus(value)) {
    throw new Error(
      `Invalid BillStatus: ${JSON.stringify(value)}${context ? ` (context: ${context})` : ""}`
    );
  }
}

/**
 * Asserts that a value is a valid BillType, throwing if not.
 * @param value - The value to check
 * @param context - Optional context for error message
 * @throws Error if value is not a valid BillType
 */
export function assertBillType(value: unknown, context?: string): asserts value is BillType {
  if (!isBillType(value)) {
    throw new Error(
      `Invalid BillType: ${JSON.stringify(value)}${context ? ` (context: ${context})` : ""}`
    );
  }
}

/**
 * Asserts that a value is a valid SplitType, throwing if not.
 * @param value - The value to check
 * @param context - Optional context for error message
 * @throws Error if value is not a valid SplitType
 */
export function assertSplitType(value: unknown, context?: string): asserts value is SplitType {
  if (!isSplitType(value)) {
    throw new Error(
      `Invalid SplitType: ${JSON.stringify(value)}${context ? ` (context: ${context})` : ""}`
    );
  }
}

/**
 * Asserts that a value is a valid DebtStatus, throwing if not.
 * @param value - The value to check
 * @param context - Optional context for error message
 * @throws Error if value is not a valid DebtStatus
 */
export function assertDebtStatus(value: unknown, context?: string): asserts value is DebtStatus {
  if (!isDebtStatus(value)) {
    throw new Error(
      `Invalid DebtStatus: ${JSON.stringify(value)}${context ? ` (context: ${context})` : ""}`
    );
  }
}

/**
 * Coerces a value to BillStatus with a fallback.
 * @param value - The value to coerce
 * @param fallback - The fallback value if invalid
 * @returns The value if valid, otherwise the fallback
 */
export function coerceBillStatus(value: unknown, fallback: BillStatus): BillStatus {
  return isBillStatus(value) ? value : fallback;
}

/**
 * Coerces a value to BillType with a fallback.
 * @param value - The value to coerce
 * @param fallback - The fallback value if invalid
 * @returns The value if valid, otherwise the fallback
 */
export function coerceBillType(value: unknown, fallback: BillType): BillType {
  return isBillType(value) ? value : fallback;
}

/**
 * Coerces a value to SplitType with a fallback.
 * @param value - The value to coerce
 * @param fallback - The fallback value if invalid
 * @returns The value if valid, otherwise the fallback
 */
export function coerceSplitType(value: unknown, fallback: SplitType): SplitType {
  return isSplitType(value) ? value : fallback;
}

/**
 * Coerces a value to DebtStatus with a fallback.
 * @param value - The value to coerce
 * @param fallback - The fallback value if invalid
 * @returns The value if valid, otherwise the fallback
 */
export function coerceDebtStatus(value: unknown, fallback: DebtStatus): DebtStatus {
  return isDebtStatus(value) ? value : fallback;
}
