/**
 * Runtime validation for Supabase realtime `postgres_changes` payloads.
 *
 * `payload.new` is typed as a row but is `unknown` at runtime: a malformed or
 * partial event (or `null`) would otherwise crash the mapper or feed garbage
 * into UI state. These guards narrow the payload and reject anything missing the
 * critical identity/amount fields, so a bad event is skipped rather than fatal.
 */
export function validateRealtimeRow<T>(
  value: unknown,
  requiredStringKeys: readonly string[] = [],
  requiredNumberKeys: readonly string[] = [],
): T | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const row = value as Record<string, unknown>;
  for (const key of requiredStringKeys) {
    if (typeof row[key] !== "string") return null;
  }
  for (const key of requiredNumberKeys) {
    if (typeof row[key] !== "number") return null;
  }
  return value as T;
}
