/**
 * Server-side financial compatibility gate for the #477 two-migration
 * cutover. Owns the schema version this application build was compiled
 * against (sent as a header on every Supabase request so a future signed
 * manifest/control plane can identify stale clients) and the pure
 * evaluation the proxy uses to decide whether a request may reach a
 * protected financial page during maintenance or a schema bump.
 *
 * It knows no Supabase/PostgREST/table shape and performs no I/O,
 * matching #477's rule that only `expense-money.ts` owns money/table
 * semantics.
 */

/** This build's effective pre-#477 database schema version. */
export const CURRENT_FINANCIAL_SCHEMA_VERSION = 1;

/** Sent as a global header on every outgoing Supabase request. */
export const FINANCIAL_SCHEMA_HEADER_NAME = "x-dividimos-financial-schema-version";

export type FinancialCompatibilityManifest = Readonly<{
  status: "maintenance" | "ready";
  requiredFinancialSchemaVersion: number;
  minimumNativeVersionCode: number;
}>;

export type FinancialCompatibilityIssue =
  | Readonly<{ code: "maintenance" }>
  | Readonly<{ code: "schema_outdated"; requiredFinancialSchemaVersion: number }>;

export type FinancialCompatibilityCheck =
  | Readonly<{ compatible: true }>
  | Readonly<{ compatible: false; issue: FinancialCompatibilityIssue }>;

function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

/**
 * Reads the deploy-time environment variables that control the gate
 * state. Shared so the proxy (middleware) can enforce the same state
 * server-side, before any protected route renders, without an extra
 * network round-trip.
 */
export function readFinancialCompatibilityManifest(): FinancialCompatibilityManifest {
  return {
    status: process.env.FINANCIAL_MAINTENANCE === "true" ? "maintenance" : "ready",
    requiredFinancialSchemaVersion: parsePositiveIntEnv(process.env.FINANCIAL_REQUIRED_SCHEMA_VERSION, 1),
    minimumNativeVersionCode: parsePositiveIntEnv(process.env.FINANCIAL_MINIMUM_NATIVE_VERSION_CODE, 1),
  };
}

/**
 * Server-side gate: enforces only the maintenance/schema state (both
 * fully known from deploy-time env vars), never the native version (the
 * server has no client platform signal before the request completes).
 * This runs in the proxy/middleware, BEFORE any protected server
 * component renders, so an incompatible/maintenance window can never let
 * a financial page's server-side data fetch execute at all.
 */
export function evaluateServerFinancialGate(): FinancialCompatibilityCheck {
  const manifest = readFinancialCompatibilityManifest();
  if (manifest.status === "maintenance") {
    return { compatible: false, issue: { code: "maintenance" } };
  }
  if (CURRENT_FINANCIAL_SCHEMA_VERSION < manifest.requiredFinancialSchemaVersion) {
    return {
      compatible: false,
      issue: { code: "schema_outdated", requiredFinancialSchemaVersion: manifest.requiredFinancialSchemaVersion },
    };
  }
  return { compatible: true };
}
