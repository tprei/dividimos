/**
 * Type guards for runtime validation of enum values.
 * These provide both compile-time and runtime safety for type assertions.
 */
import type {
  GroupMemberStatus,
  PixKeyType,
  SplitType,
} from "@/types";

const GROUP_MEMBER_STATUSES = ["invited", "accepted"] as const;
const PIX_KEY_TYPES = ["cpf", "email", "phone", "random"] as const;
const SPLIT_TYPES = ["equal", "percentage", "fixed"] as const;

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
