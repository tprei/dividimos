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
const FUNCTION_PRIVILEGE_SCHEMAS = ["public", "guest_credentials"];

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

  for (const key of ["policies", "grants", "definerOwners", "tablesWithoutRls", "schemas"]) {
    if (!Array.isArray(parsed[key])) {
      console.error(`::error::${ALLOWLIST_PATH} is missing the "${key}" array.`);
      process.exit(1);
    }
  }
  if (parsed.definerOwners.length === 0) {
    console.error(`::error::${ALLOWLIST_PATH} lists no allowed definer owner.`);
    process.exit(1);
  }
  if (
    parsed.functionPrivileges === null ||
    typeof parsed.functionPrivileges !== "object" ||
    Array.isArray(parsed.functionPrivileges)
  ) {
    console.error(
      `::error::${ALLOWLIST_PATH} is missing the "functionPrivileges" object.`,
    );
    console.error(
      "Every function signature needs an exact anon/authenticated contract entry.",
    );
    process.exit(1);
  }
  for (const [signature, entry] of Object.entries(parsed.functionPrivileges)) {
    if (
      entry === null ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      typeof entry.anon !== "boolean" ||
      typeof entry.authenticated !== "boolean" ||
      typeof entry.note !== "string" ||
      entry.note.length === 0
    ) {
      console.error(
        `::error::${ALLOWLIST_PATH} entry for ${signature} must be ` +
          `{ "anon": boolean, "authenticated": boolean, "note": string }.`,
      );
      process.exit(1);
    }
  }
  return parsed;
}

// Only objects this repo's migrations create are audited: the public and
// guest_credentials application schemas, plus realtime policies, which is where
// broadcast authorization lives. Supabase's own storage, auth and functions
// schemas are platform-managed and ship their own grants.
const AUDITED_TABLE_SCHEMAS = ["public", "guest_credentials"];
const AUDITED_POLICY_SCHEMAS = ["public", "guest_credentials", "realtime"];

// A pinned search_path is only safe when every element names an application
// schema or pg_temp. "$user" and unknown schemas let a hostile schema win
// object resolution inside SECURITY DEFINER bodies. An empty string is the
// strongest setting: every reference must be schema-qualified.
const SAFE_SEARCH_PATH_ELEMENTS = new Set([
  "public",
  "pg_temp",
  "extensions",
  "guest_credentials",
]);

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
  // Effective table-level privileges, not role_table_grants: a grant to a
  // role that browser roles inherit, or a column-level grant, would be
  // invisible in information_schema.role_table_grants.
  const grants = await client.query(
    `select n.nspname as table_schema,
            c.relname as table_name,
            r.rolname as grantee,
            has_table_privilege(r.oid, c.oid, 'SELECT') as can_select,
            has_table_privilege(r.oid, c.oid, 'INSERT') as can_insert,
            has_table_privilege(r.oid, c.oid, 'UPDATE') as can_update,
            has_table_privilege(r.oid, c.oid, 'DELETE') as can_delete,
            (has_any_column_privilege(r.oid, c.oid, 'SELECT')
             or has_any_column_privilege(r.oid, c.oid, 'INSERT')
             or has_any_column_privilege(r.oid, c.oid, 'UPDATE')) as any_column
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       cross join pg_roles r
      where n.nspname = any($1::text[])
        and c.relkind in ('r', 'v')
        and r.rolname = any($2::text[])
        and (has_table_privilege(r.oid, c.oid, 'SELECT')
             or has_table_privilege(r.oid, c.oid, 'INSERT')
             or has_table_privilege(r.oid, c.oid, 'UPDATE')
             or has_table_privilege(r.oid, c.oid, 'DELETE')
             or has_any_column_privilege(r.oid, c.oid, 'SELECT')
             or has_any_column_privilege(r.oid, c.oid, 'INSERT')
             or has_any_column_privilege(r.oid, c.oid, 'UPDATE'))
      order by 1, 2, 3`,
    [AUDITED_TABLE_SCHEMAS, FORBIDDEN_GRANTEES],
  );

  const sequenceGrants = await client.query(
    `select n.nspname as schema_name,
            c.relname as sequence_name,
            r.rolname as grantee
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       cross join pg_roles r
      where n.nspname = any($1::text[])
        and c.relkind = 'S'
        and r.rolname = any($2::text[])
        and (has_sequence_privilege(r.oid, c.oid, 'SELECT')
             or has_sequence_privilege(r.oid, c.oid, 'USAGE')
             or has_sequence_privilege(r.oid, c.oid, 'UPDATE'))
      order by 1, 2, 3`,
    [AUDITED_TABLE_SCHEMAS, FORBIDDEN_GRANTEES],
  );

  // Browser roles must keep USAGE on public to call the RPC surface, but
  // CREATE on an application schema would let them plant objects that other
  // queries might resolve.
  const schemaPrivileges = await client.query(
    `select n.nspname as schema_name,
            r.rolname as role_name
       from pg_namespace n
       cross join pg_roles r
      where n.nspname = any($1::text[])
        and r.rolname in ('anon', 'authenticated')
        and has_schema_privilege(r.oid, n.oid, 'CREATE')
      order by 1, 2`,
    [AUDITED_TABLE_SCHEMAS],
  );
  const functions = await client.query(
    `select p.proname as function_name,
            pg_get_function_identity_arguments(p.oid) as args,
            pg_get_userbyid(p.proowner) as owner,
            p.proconfig
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = any($1::text[]) and p.prosecdef
      order by 1, 2`,
    [FUNCTION_PRIVILEGE_SCHEMAS],
  );
  const functionPrivileges = await client.query(
    `select n.nspname as function_schema,
            p.proname as function_name,
            pg_get_function_identity_arguments(p.oid) as args,
            exists (
              select 1 from pg_roles r
               where r.rolname = 'anon'
                 and has_function_privilege(r.oid, p.oid, 'EXECUTE')
            ) as anon_execute,
            exists (
              select 1 from pg_roles r
               where r.rolname = 'authenticated'
                 and has_function_privilege(r.oid, p.oid, 'EXECUTE')
            ) as authenticated_execute,
            (p.proacl is null or exists (
              select 1 from aclexplode(p.proacl) x
               where x.grantee = 0 and x.privilege_type = 'EXECUTE'
            )) as public_execute
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = any($1::text[])
      order by 1, 2, 3`,
    [FUNCTION_PRIVILEGE_SCHEMAS],
  );

  const schemas = await client.query(
    `select nspname from pg_namespace
      where nspname !~ '^pg_' and nspname <> 'information_schema'
      order by 1`,
  );

  return {
    tables: tables.rows,
    policies: policies.rows,
    grants: grants.rows,
    functions: functions.rows,
    functionPrivileges: functionPrivileges.rows,
    sequenceGrants: sequenceGrants.rows,
    schemaPrivileges: schemaPrivileges.rows,
    schemas: schemas.rows,
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

  for (const grant of state.grants) {
    const privileges = [
      grant.can_select && "SELECT",
      grant.can_insert && "INSERT",
      grant.can_update && "UPDATE",
      grant.can_delete && "DELETE",
      grant.any_column && "COLUMN",
    ].filter((privilege) => privilege !== false);
    const id = `${grant.table_schema}.${grant.table_name}.${grant.grantee}.${privileges.join("+")}`;
    if (allowlist.grants.includes(id)) continue;
    failures.push(
      `${grant.grantee} effectively holds ${privileges.join("+")} on ${grant.table_schema}.${grant.table_name}; ` +
        `clients reach data only through RPCs`,
    );
  }
  for (const { schema_name, sequence_name, grantee } of state.sequenceGrants) {
    failures.push(
      `${grantee} holds privileges on sequence ${schema_name}.${sequence_name}; sequences are server-side only`,
    );
  }

  for (const { nspname } of state.schemas) {
    if (allowlist.schemas.includes(nspname)) continue;
    failures.push(
      `unknown schema ${nspname} exists outside the platform and application set; ` +
        `a new schema must be a reviewed allowlist entry, not an unaudited escape hatch`,
    );
  }

  for (const { schema_name, role_name } of state.schemaPrivileges) {
    failures.push(
      `${role_name} can CREATE in schema ${schema_name}; browser roles must not plant objects in application schemas`,
    );
  }

  for (const { function_name, args, owner, proconfig } of state.functions) {
    const signature = `public.${function_name}(${args})`;
    const settings = proconfig ?? [];
    const searchPath = settings.find((entry) => entry.startsWith("search_path="));
    if (searchPath === undefined) {
      failures.push(
        `SECURITY DEFINER function ${signature} has no pinned search_path`,
      );
    } else {
      const value = searchPath.slice("search_path=".length).replace(/^"|"$/g, "");
      const elements = value
        .split(",")
        .map((element) => element.trim())
        .filter((element) => element.length > 0);
      const unsafe = elements.filter(
        (element) => !SAFE_SEARCH_PATH_ELEMENTS.has(element),
      );
      if (unsafe.length > 0) {
        failures.push(
          `SECURITY DEFINER function ${signature} pins an unsafe search_path (${searchPath.slice("search_path=".length)}); ` +
            `unsupported elements: ${unsafe.join(", ")}`,
        );
      }
    }
    if (!allowlist.definerOwners.includes(owner)) {
      failures.push(
        `SECURITY DEFINER function ${signature} is owned by ${owner}, which is not a reviewed owner`,
      );
    }
  }

  const manifestSignatures = new Set(
    Object.keys(allowlist.functionPrivileges),
  );
  for (const {
    function_schema,
    function_name,
    args,
    anon_execute,
    authenticated_execute,
    public_execute,
  } of state.functionPrivileges) {
    const signature = `${function_schema}.${function_name}(${args})`;
    manifestSignatures.delete(signature);
    const entry = allowlist.functionPrivileges[signature];
    if (entry === undefined) {
      failures.push(
        `function ${signature} has no privilege manifest entry; ` +
          `add its reviewed anon/authenticated contract or drop the obsolete overload`,
      );
      continue;
    }
    if (public_execute) {
      failures.push(
        `PUBLIC holds EXECUTE on ${signature}; no application function may default to public execution`,
      );
    }
    if (entry.anon !== anon_execute) {
      failures.push(
        `anon execution of ${signature} is ${anon_execute ? "granted" : "denied"}, ` +
          `but the manifest says ${entry.anon ? "granted" : "denied"}`,
      );
    }
    if (entry.authenticated !== authenticated_execute) {
      failures.push(
        `authenticated execution of ${signature} is ${authenticated_execute ? "granted" : "denied"}, ` +
          `but the manifest says ${entry.authenticated ? "granted" : "denied"}`,
      );
    }
  }
  for (const stale of manifestSignatures) {
    failures.push(
      `manifest entry ${stale} names a function that does not exist; ` +
        `remove the stale entry or restore the reviewed signature`,
    );
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
      `no anon/authenticated/PUBLIC table privileges, ${state.functions.length} definer functions with a pinned search_path, ` +
      `${state.functionPrivileges.length} functions matching the reviewed privilege manifest.`,
  );
}

await main();
