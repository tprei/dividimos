/**
 * Issue #477 preparatory compatibility gate.
 *
 * This is the client-safe half of the two-migration cutover described in
 * the #477 spec's "Compatibility and maintenance gate" section. It owns:
 *
 * - the schema version this application build was compiled against
 *   (sent as a header on every Supabase request so a future signed
 *   manifest/control plane can identify stale clients);
 * - the wire contract and strict decoder for the out-of-band
 *   `GET /api/runtime/financial-compatibility` manifest; and
 * - the pure compatibility evaluation the app shell uses to decide
 *   whether to render a blocking maintenance/update/error state instead
 *   of the authenticated app.
 *
 * It knows no Supabase/PostgREST/table shape and performs no I/O itself
 * beyond the one fetch helper below, matching #477's rule that only
 * `expense-money.ts` owns money/table semantics.
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

export type FinancialCompatibilityDecodeIssue = Readonly<{
  code: "invalid_manifest";
  path: readonly (string | number)[];
}>;

export type FinancialCompatibilityDecodeResult =
  | Readonly<{ ok: true; value: FinancialCompatibilityManifest }>
  | Readonly<{ ok: false; issue: FinancialCompatibilityDecodeIssue }>;

const MANIFEST_ROOT_KEYS = ["status", "requiredFinancialSchemaVersion", "minimumNativeVersionCode"] as const;

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/**
 * Strict decoder for the `/api/runtime/financial-compatibility` response.
 * Rejects extra/missing keys and wrong-typed fields; never repairs or
 * defaults a malformed manifest.
 */
export function decodeFinancialCompatibilityManifest(raw: unknown): FinancialCompatibilityDecodeResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, issue: { code: "invalid_manifest", path: [] } };
  }

  const record = raw as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== MANIFEST_ROOT_KEYS.length || !MANIFEST_ROOT_KEYS.every((key) => key in record)) {
    return { ok: false, issue: { code: "invalid_manifest", path: [] } };
  }

  const { status, requiredFinancialSchemaVersion, minimumNativeVersionCode } = record;

  if (status !== "maintenance" && status !== "ready") {
    return { ok: false, issue: { code: "invalid_manifest", path: ["status"] } };
  }
  if (!isPositiveInteger(requiredFinancialSchemaVersion)) {
    return { ok: false, issue: { code: "invalid_manifest", path: ["requiredFinancialSchemaVersion"] } };
  }
  if (!isPositiveInteger(minimumNativeVersionCode)) {
    return { ok: false, issue: { code: "invalid_manifest", path: ["minimumNativeVersionCode"] } };
  }

  return { ok: true, value: { status, requiredFinancialSchemaVersion, minimumNativeVersionCode } };
}

export type FinancialCompatibilityIssue =
  | Readonly<{ code: "maintenance" }>
  | Readonly<{ code: "schema_outdated"; requiredFinancialSchemaVersion: number }>
  | Readonly<{ code: "native_outdated"; minimumNativeVersionCode: number }>
  | Readonly<{ code: "unreachable" }>;

export type FinancialCompatibilityCheck =
  | Readonly<{ compatible: true }>
  | Readonly<{ compatible: false; issue: FinancialCompatibilityIssue }>;

/**
 * Pure evaluation against an already-decoded manifest. `nativeVersionCode`
 * is `null` on web (no native build to compare) and the parsed
 * `App.getInfo().build` integer on native.
 */
export function evaluateFinancialCompatibility(
  manifest: FinancialCompatibilityManifest,
  nativeVersionCode: number | null,
): FinancialCompatibilityCheck {
  if (manifest.status === "maintenance") {
    return { compatible: false, issue: { code: "maintenance" } };
  }
  if (CURRENT_FINANCIAL_SCHEMA_VERSION < manifest.requiredFinancialSchemaVersion) {
    return {
      compatible: false,
      issue: { code: "schema_outdated", requiredFinancialSchemaVersion: manifest.requiredFinancialSchemaVersion },
    };
  }
  if (nativeVersionCode !== null && nativeVersionCode < manifest.minimumNativeVersionCode) {
    return {
      compatible: false,
      issue: { code: "native_outdated", minimumNativeVersionCode: manifest.minimumNativeVersionCode },
    };
  }
  return { compatible: true };
}

/**
 * Fetches and decodes the compatibility manifest. Always requests
 * `cache: "no-store"` to match the endpoint's own `Cache-Control:
 * no-store, max-age=0` and never satisfies from a CDN/browser cache.
 * Network/parse failure surfaces as `{ compatible: false, issue: {
 * code: "unreachable" } }` — the caller treats an unreachable gate the
 * same as a blocked one; it never falls open.
 */
export async function fetchFinancialCompatibility(
  nativeVersionCode: number | null,
): Promise<FinancialCompatibilityCheck> {
  try {
    const response = await fetch("/api/runtime/financial-compatibility", { cache: "no-store" });
    if (!response.ok) {
      return { compatible: false, issue: { code: "unreachable" } };
    }
    const raw: unknown = await response.json();
    const decoded = decodeFinancialCompatibilityManifest(raw);
    if (!decoded.ok) {
      return { compatible: false, issue: { code: "unreachable" } };
    }
    return evaluateFinancialCompatibility(decoded.value, nativeVersionCode);
  } catch {
    return { compatible: false, issue: { code: "unreachable" } };
  }
}
