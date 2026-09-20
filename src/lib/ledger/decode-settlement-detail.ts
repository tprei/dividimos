import type { ValidationResult } from "@/lib/expense-money";
import type { Settlement, WireIssue } from "@/types/ledger";
import { decodeSettlement } from "./decode";
import { type Path, exactKeys, fail, isRecord } from "./decode-expense";

const DETAIL_KEYS = ["settlement"] as const;

/**
 * Shape of `get_settlement`: a single-key wrapper around the same settlement
 * serializer the group snapshot uses, so field validation stays in one place.
 */
export function decodeSettlementDetail(
  raw: unknown,
  path: Path = [],
): ValidationResult<Settlement, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const k = exactKeys(raw, DETAIL_KEYS, path);
  if (!k.ok) return k;
  return decodeSettlement(raw.settlement, [...path, "settlement"]);
}
