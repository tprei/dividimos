export interface AccountDeletionGroup {
  id: string;
  name: string;
}

export type AccountDeletionResponse =
  | { ok: true; userId: string }
  | { ok: false; code: "outstanding_balance"; groups: AccountDeletionGroup[] }
  | { ok: false; code: "unauthenticated" }
  | { ok: false; code: "invalid_argument" }
  | { ok: false; code: "deletion_failed"; retryable: true }
  | { ok: false; code: "apple_reauthorization_required" }
  | { ok: false; code: "apple_revoke_failed"; retryable: true; userId: string }
  | { ok: false; code: "auth_delete_failed"; retryable: true; userId: string };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isAccountDeletionGroup(value: unknown): value is AccountDeletionGroup {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return isUuid(record.id) && typeof record.name === "string" && record.name.length > 0;
}

export function decodeAccountDeletionGroups(raw: unknown): AccountDeletionGroup[] | null {
  if (!Array.isArray(raw)) return null;
  const groups: AccountDeletionGroup[] = [];
  for (const entry of raw) {
    if (!isAccountDeletionGroup(entry)) return null;
    groups.push({ id: entry.id, name: entry.name });
  }
  return groups;
}

export function decodeAccountDeletionResponse(raw: unknown): AccountDeletionResponse | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.ok !== "boolean") return null;

  if (record.ok === true) {
    if (!isUuid(record.userId)) return null;
    return { ok: true, userId: record.userId };
  }

  if (record.code === "outstanding_balance") {
    const groups = decodeAccountDeletionGroups(record.groups);
    if (!groups) return null;
    return { ok: false, code: "outstanding_balance", groups };
  }
  if (record.code === "unauthenticated") return { ok: false, code: "unauthenticated" };
  if (record.code === "invalid_argument") return { ok: false, code: "invalid_argument" };
  if (record.code === "apple_reauthorization_required") {
    return { ok: false, code: "apple_reauthorization_required" };
  }
  if (record.code === "deletion_failed" && record.retryable === true) {
    return { ok: false, code: "deletion_failed", retryable: true };
  }
  if (record.code === "apple_revoke_failed" && record.retryable === true && isUuid(record.userId)) {
    return { ok: false, code: "apple_revoke_failed", retryable: true, userId: record.userId };
  }
  if (record.code === "auth_delete_failed" && record.retryable === true && isUuid(record.userId)) {
    return { ok: false, code: "auth_delete_failed", retryable: true, userId: record.userId };
  }
  return null;
}
