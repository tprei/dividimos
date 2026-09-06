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

export type FinancialCompatibilityManifest = Readonly<{
  status: "maintenance" | "ready";
}>;

export type FinancialCompatibilityIssue =
  | Readonly<{ code: "maintenance" }>;

export type FinancialCompatibilityCheck =
  | Readonly<{ compatible: true }>
  | Readonly<{ compatible: false; issue: FinancialCompatibilityIssue }>;

export function readFinancialCompatibilityManifest(): FinancialCompatibilityManifest {
  return {
    status: process.env.FINANCIAL_MAINTENANCE === "true" ? "maintenance" : "ready",
  };
}

export function evaluateServerFinancialGate(): FinancialCompatibilityCheck {
  const manifest = readFinancialCompatibilityManifest();
  if (manifest.status === "maintenance") {
    return { compatible: false, issue: { code: "maintenance" } };
  }
  return { compatible: true };
}
