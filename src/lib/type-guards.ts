/**
 * Type guards for runtime validation of enum values.
 * These provide both compile-time and runtime safety for type assertions.
 */
import type { PixKeyType } from "@/types";

const PIX_KEY_TYPES = ["cpf", "email", "phone", "random"] as const;

/**
 * Type guard for PixKeyType enum.
 * @param value - The value to check
 * @returns true if value is a valid PixKeyType
 */
export function isPixKeyType(value: unknown): value is PixKeyType {
  return typeof value === "string" && PIX_KEY_TYPES.includes(value as PixKeyType);
}
