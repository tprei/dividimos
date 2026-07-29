import { NextResponse } from "next/server";
import type { FinancialCompatibilityManifest } from "@/lib/financial-compatibility";

/**
 * Issue #477 preparatory compatibility gate: out-of-band manifest the app
 * shell (and, from the eventual invariant cutover onward, every financial
 * API route) checks before doing any Supabase/PostgREST work.
 *
 * Deliberately reads only deploy-time environment variables — never
 * PostgREST or a Supabase table — so a degraded/maintenance database
 * connection can never lie about its own status, and so this endpoint
 * keeps working even while `financial_internal.financial_compatibility_state`
 * is closed for writes. In production these variables are the signed
 * deployment manifest set by the release pipeline; the deployment
 * operator's reopen procedure (see the #477 migration) flips them in the
 * same release step that clears the database singleton's maintenance flag.
 *
 * Baseline defaults match the preparatory migration's seeded row exactly:
 * no maintenance, schema version 1, native version code 1.
 */

function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

function parseMaintenanceEnv(value: string | undefined): boolean {
  return value === "true";
}

export async function GET() {
  const manifest: FinancialCompatibilityManifest = {
    status: parseMaintenanceEnv(process.env.FINANCIAL_MAINTENANCE) ? "maintenance" : "ready",
    requiredFinancialSchemaVersion: parsePositiveIntEnv(process.env.FINANCIAL_REQUIRED_SCHEMA_VERSION, 1),
    minimumNativeVersionCode: parsePositiveIntEnv(process.env.FINANCIAL_MINIMUM_NATIVE_VERSION_CODE, 1),
  };

  return NextResponse.json(manifest, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
