#!/usr/bin/env node

/**
 * RLS Audit Script
 *
 * Extracts RLS state from a local Supabase instance, sends it to the Claude API
 * for security analysis, and outputs structured findings with a CI-compatible
 * exit code.
 *
 * Usage:
 *   node scripts/rls-audit.mjs [--json] [--diff <file>]
 *
 * Environment:
 *   ANTHROPIC_API_KEY        — required
 *   ANTHROPIC_BASE_URL       — base URL for the API (default: https://api.anthropic.com)
 *                               e.g. https://api.z.ai/api/anthropic for z.ai
 *   SUPABASE_DB_URL          — postgres connection string (default: local Supabase)
 *   RLS_AUDIT_MODEL          — Claude model to use (default: claude-sonnet-4-20250514)
 *
 * Exit codes:
 *   0 — no CRITICAL or HIGH findings
 *   1 — CRITICAL or HIGH findings detected
 *   2 — script error (missing env, DB unreachable, API failure)
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { argv, env, exit } from "node:process";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_KEY = env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error("Error: ANTHROPIC_API_KEY is not set");
  exit(2);
}

const API_BASE_URL = env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";
const DB_URL =
  env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@localhost:54322/postgres";
const MODEL = env.RLS_AUDIT_MODEL ?? "claude-sonnet-4-20250514";
const JSON_OUTPUT = argv.includes("--json");
const DIFF_INDEX = argv.indexOf("--diff");
const DIFF_FILE = DIFF_INDEX !== -1 ? argv[DIFF_INDEX + 1] : null;

// ---------------------------------------------------------------------------
// Step 1: Extract RLS state from the database
// ---------------------------------------------------------------------------

console.error("Extracting RLS state from database...");

let rlsState;
try {
  const sqlPath = new URL("./extract-rls-state.sql", import.meta.url).pathname;
  const result = execSync(
    `psql "${DB_URL}" -t -A -f "${sqlPath}"`,
    { encoding: "utf-8", timeout: 30_000 }
  );
  rlsState = JSON.parse(result.trim());
} catch (err) {
  console.error("Failed to extract RLS state:", err.message);
  exit(2);
}

const policyCount = rlsState.policies?.length ?? 0;
const secDefCount = rlsState.security_definer_functions?.length ?? 0;
const noRlsCount = rlsState.tables_without_rls?.length ?? 0;
const noPolCount = rlsState.tables_rls_enabled_no_policies?.length ?? 0;
console.error(
  `Found: ${policyCount} policies, ${secDefCount} SECURITY DEFINER functions, ` +
  `${noRlsCount} tables without RLS, ${noPolCount} tables with RLS but no policies`
);

// ---------------------------------------------------------------------------
// Step 2: Load optional diff context
// ---------------------------------------------------------------------------

let diffContext = "";
if (DIFF_FILE) {
  try {
    diffContext = readFileSync(DIFF_FILE, "utf-8");
    console.error(`Loaded diff context from ${DIFF_FILE} (${diffContext.length} chars)`);
  } catch {
    console.error(`Warning: could not read diff file ${DIFF_FILE}, proceeding without it`);
  }
}

// ---------------------------------------------------------------------------
// Step 3: Build prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a PostgreSQL RLS (Row-Level Security) auditor for a Supabase-backed expense-splitting app called Dividimos.

Domain context:
- Every expense belongs to a group. Groups have members with statuses: invited, accepted.
- Balances are canonical in the \`balances\` table (one row per group/user_a/user_b where user_a < user_b).
- Balance writes happen ONLY through SECURITY DEFINER RPCs: activate_expense, confirm_settlement, record_and_settle.
- Pix keys are encrypted at rest; raw keys must never be queryable by clients.
- User discovery is by exact @handle only — no enumeration/search of user data.
- DM groups (is_dm=true) can only be created via get_or_create_dm_group RPC, never via direct INSERT.
- \`user_profiles\` is a VIEW exposing only (id, handle, display_name, avatar_url) — safe for public listing.

Your task: analyze the RLS state for security issues. For each finding, assign a severity:

- CRITICAL: Data can be read or written across tenant boundaries, or balances can be corrupted.
- HIGH: Authorization bypass that doesn't directly corrupt data but breaks access control.
- MEDIUM: Overly permissive policy that could leak non-sensitive data or allow unintended writes.
- LOW: Missing best practice (e.g., no SET search_path on a SECURITY DEFINER function).
- INFO: Observation that is not a vulnerability but worth noting.

Known antipatterns to check:
1. USING(true) on any table with user data
2. Missing WITH CHECK on INSERT/UPDATE policies
3. my_group_ids() used where my_accepted_group_ids() is needed (invited != accepted)
4. SECURITY DEFINER functions without SET search_path = ''
5. Tables with RLS enabled but zero policies (default-deny is fine, but verify intent)
6. Tables without RLS enabled at all (could be intentional for public data)
7. Cross-tenant data access (missing group_id scoping)
8. Direct balance/settlement writes allowed outside RPCs
9. Status transition bypasses (draft→active outside activate_expense)
10. Missing caller identity checks (auth.uid() not verified)

Respond with ONLY a JSON object matching this schema:
{
  "findings": [
    {
      "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO",
      "table_or_function": "name of the affected table or function",
      "title": "short title (under 80 chars)",
      "description": "detailed explanation of the issue",
      "recommendation": "how to fix it"
    }
  ],
  "summary": "1-2 sentence overall assessment",
  "stats": {
    "total_policies": <number>,
    "security_definer_functions": <number>,
    "tables_without_rls": <number>,
    "tables_rls_no_policies": <number>
  }
}`;

const userMessage = [
  "## Current RLS State\n",
  "```json",
  JSON.stringify(rlsState, null, 2),
  "```",
  diffContext
    ? `\n## New/Changed Migration SQL\n\n\`\`\`sql\n${diffContext}\n\`\`\``
    : "",
  "\nAnalyze this RLS configuration for security issues. Return ONLY the JSON object as specified.",
].join("\n");

// ---------------------------------------------------------------------------
// Step 4: Call Claude API
// ---------------------------------------------------------------------------

console.error(`Sending to ${API_BASE_URL} (${MODEL})...`);

let response;
try {
  const res = await fetch(`${API_BASE_URL}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API returned ${res.status}: ${body}`);
  }

  response = await res.json();
} catch (err) {
  console.error("Claude API call failed:", err.message);
  exit(2);
}

// ---------------------------------------------------------------------------
// Step 5: Parse response
// ---------------------------------------------------------------------------

const rawText = response.content?.[0]?.text ?? "";
let audit;
try {
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON object found in response");
  audit = JSON.parse(jsonMatch[0]);
} catch (err) {
  console.error("Failed to parse Claude response as JSON:", err.message);
  console.error("Raw response:\n", rawText);
  exit(2);
}

// ---------------------------------------------------------------------------
// Step 6: Output results
// ---------------------------------------------------------------------------

const findings = audit.findings ?? [];
const criticalCount = findings.filter((f) => f.severity === "CRITICAL").length;
const highCount = findings.filter((f) => f.severity === "HIGH").length;
const mediumCount = findings.filter((f) => f.severity === "MEDIUM").length;
const lowCount = findings.filter((f) => f.severity === "LOW").length;
const infoCount = findings.filter((f) => f.severity === "INFO").length;

if (JSON_OUTPUT) {
  console.log(JSON.stringify(audit, null, 2));
} else {
  console.log("# RLS Security Audit Report\n");
  console.log(`**Model**: ${MODEL}`);
  console.log(`**Summary**: ${audit.summary ?? "N/A"}\n`);

  if (audit.stats) {
    console.log("## Stats\n");
    console.log(`- Policies: ${audit.stats.total_policies}`);
    console.log(`- SECURITY DEFINER functions: ${audit.stats.security_definer_functions}`);
    console.log(`- Tables without RLS: ${audit.stats.tables_without_rls}`);
    console.log(`- Tables with RLS but no policies: ${audit.stats.tables_rls_no_policies}`);
    console.log();
  }

  const severityOrder = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
  for (const severity of severityOrder) {
    const items = findings.filter((f) => f.severity === severity);
    if (items.length === 0) continue;

    const icon =
      severity === "CRITICAL" ? "🔴" :
      severity === "HIGH" ? "🟠" :
      severity === "MEDIUM" ? "🟡" :
      severity === "LOW" ? "🔵" : "ℹ️";

    console.log(`## ${icon} ${severity} (${items.length})\n`);
    for (const f of items) {
      console.log(`### ${f.table_or_function}: ${f.title}\n`);
      console.log(f.description);
      console.log(`\n**Recommendation**: ${f.recommendation}\n`);
    }
  }

  console.log("---");
  console.log(
    `**Totals**: ${criticalCount} critical, ${highCount} high, ` +
    `${mediumCount} medium, ${lowCount} low, ${infoCount} info`
  );
}

// ---------------------------------------------------------------------------
// Step 7: Exit code
// ---------------------------------------------------------------------------

if (criticalCount > 0 || highCount > 0) {
  console.error(
    `\nAudit FAILED: ${criticalCount} critical, ${highCount} high findings`
  );
  exit(1);
} else {
  console.error("\nAudit PASSED: no critical or high findings");
  exit(0);
}
