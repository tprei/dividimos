#!/usr/bin/env node
// Asserts the deny-all database contract against a live database.
//
// Usage: node scripts/check-database-invariants.mjs <database-url>
//
// The contract (README.md, "Security model"): application tables keep RLS
// enabled with zero policies and no privileges for anon or authenticated.
// Every read and write goes through a SECURITY DEFINER RPC that checks
// membership itself, so those functions must have a pinned search_path and a
// known owner.
//
// Exceptions live in supabase/security-allowlist.json and are reviewed by a
// human. A missing or unreadable allowlist fails the check: this gate never
// passes by default.

import { readFileSync } from "node:fs";
import pg from "pg";

const ALLOWLIST_PATH = "supabase/security-allowlist.json";
const FORBIDDEN_GRANTEES = ["anon", "authenticated", "PUBLIC"];

function loadAllowlist() {
  let raw;
  try {
    raw = readFileSync(ALLOWLIST_PATH, "utf8");
  } catch (error) {
    console.error(`::error::Cannot read ${ALLOWLIST_PATH}: ${error.message}`);
    console.error("The allowlist is required. Without it this gate cannot pass.");
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error(`::error::${ALLOWLIST_PATH} is not valid JSON: ${error.message}`);
    process.exit(1);
  }

  for (const key of ["policies", "grants", "definerOwners", "tablesWithoutRls"]) {
    if (!Array.isArray(parsed[key])) {
      console.error(`::error::${ALLOWLIST_PATH} is missing the "${key}" array.`);
      process.exit(1);
    }
  }
  if (parsed.definerOwners.length === 0) {
    console.error(`::error::${ALLOWLIST_PATH} lists no allowed definer owner.`);
    process.exit(1);
  }
  return parsed;
}

// Only objects this repo's migrations create are audited: the public and
// guest_credentials application schemas, plus realtime policies, which is where
// broadcast authorization lives. Supabase's own storage, auth and functions
// schemas are platform-managed and ship their own grants.
const AUDITED_TABLE_SCHEMAS = ["public", "guest_credentials"];
const AUDITED_POLICY_SCHEMAS = ["public", "guest_credentials", "realtime"];

async function collect(client) {
  const tables = await client.query(
    `select n.nspname as table_schema,
            c.relname as table_name,
            c.relrowsecurity as rls_enabled
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($1::text[]) and c.relkind = 'r'
      order by 1, 2`,
    [AUDITED_TABLE_SCHEMAS],
  );
  const policies = await client.query(
    `select schemaname, tablename, policyname
       from pg_policies
      where schemaname = any($1::text[])
      order by 1, 2, 3`,
    [AUDITED_POLICY_SCHEMAS],
  );
  const grants = await client.query(
    `select table_schema, table_name, grantee, privilege_type
       from information_schema.role_table_grants
      where table_schema = any($1::text[]) and grantee = any($2::text[])
      order by 1, 2, 3, 4`,
    [AUDITED_TABLE_SCHEMAS, FORBIDDEN_GRANTEES],
  );
  const functions = await client.query(
    `select p.proname as function_name,
            pg_get_function_identity_arguments(p.oid) as args,
            pg_get_userbyid(p.proowner) as owner,
            p.proconfig
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
      order by 1, 2`,
  );

  return {
    tables: tables.rows,
    policies: policies.rows,
    grants: grants.rows,
    functions: functions.rows,
  };
}

function auditFailures(state, allowlist) {
  const failures = [];

  for (const { table_schema, table_name, rls_enabled } of state.tables) {
    if (rls_enabled) continue;
    const tableId = `${table_schema}.${table_name}`;
    if (allowlist.tablesWithoutRls.includes(tableId)) continue;
    failures.push(`RLS is disabled on ${tableId}`);
  }

  for (const { schemaname, tablename, policyname } of state.policies) {
    const id = `${schemaname}.${tablename}.${policyname}`;
    if (allowlist.policies.includes(id)) continue;
    failures.push(
      `policy ${policyname} exists on ${schemaname}.${tablename}; access is RPC-only, so tables carry no policies`,
    );
  }

  for (const { table_schema, table_name, grantee, privilege_type } of state.grants) {
    const id = `${table_schema}.${table_name}.${grantee}.${privilege_type}`;
    if (allowlist.grants.includes(id)) continue;
    failures.push(
      `${grantee} holds ${privilege_type} on ${table_schema}.${table_name}; clients reach data only through RPCs`,
    );
  }

  for (const { function_name, args, owner, proconfig } of state.functions) {
    const signature = `public.${function_name}(${args})`;
    const settings = proconfig ?? [];
    const pinned = settings.some((entry) => entry.startsWith("search_path="));
    if (!pinned) {
      failures.push(
        `SECURITY DEFINER function ${signature} has no pinned search_path`,
      );
    }
    if (!allowlist.definerOwners.includes(owner)) {
      failures.push(
        `SECURITY DEFINER function ${signature} is owned by ${owner}, which is not a reviewed owner`,
      );
    }
  }

  return failures;
}

async function main() {
  const databaseUrl = process.argv[2] ?? process.env.SUPABASE_DB_URL;
  if (!databaseUrl) {
    console.error("usage: check-database-invariants.mjs <database-url>");
    process.exit(2);
  }

  const allowlist = loadAllowlist();
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  let state;
  try {
    state = await collect(client);
  } finally {
    await client.end();
  }

  const failures = auditFailures(state, allowlist);

  if (failures.length > 0) {
    console.error("::error::The database security contract is broken.");
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error("");
    console.error(
      "Application tables keep RLS on with zero policies and no anon/authenticated",
    );
    console.error(
      "privileges; every read and write is a SECURITY DEFINER RPC that checks",
    );
    console.error(
      `membership. A deliberate exception belongs in ${ALLOWLIST_PATH} with a reviewer.`,
    );
    process.exit(1);
  }

  console.log(
    `OK: ${state.tables.length} tables with RLS, ${state.policies.length} reviewed policies, ` +
      `no anon/authenticated/PUBLIC table privileges, ${state.functions.length} definer functions with a pinned search_path.`,
  );
}

await main();
