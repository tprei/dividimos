#!/usr/bin/env node
// Blocking CI gate for database migrations.
//
//   node scripts/verify-migrations.mjs fresh   --base <ref> --head <ref> --artifacts <dir> [--keep]
//   node scripts/verify-migrations.mjs upgrade --base <ref> --head <ref> --artifacts <dir> [--keep]
//   node scripts/verify-migrations.mjs compare --expected <catalog.json> --actual <catalog.json>
//
// `fresh` replays HEAD's migration files into a temporary local Supabase
// project and records the application catalog. `upgrade` builds the BASE
// project, seeds and observes a stable application fixture, applies only
// HEAD's new migration files with `migration up --local` (never reset or
// repair), re-observes, and requires every stable fact to be unchanged; it
// then records the catalog like `fresh`. `compare` diffs two catalog
// artifacts. Failures print `::error::<reason>` lines and exit 1.
//
// Every subprocess runs through execFile with argument arrays; refs, paths,
// URLs, and credentials never pass through a shell.

import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual, promisify } from "node:util";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const execFileP = promisify(execFile);

/** @typedef {{version: string, path: string, blobOid: string, mode: string}} MigrationFile */
/** @typedef {"schema"|"type"|"relation"|"column"|"constraint"|"index"|"function"|"trigger"|"policy"|"grant"|"defaultAcl"} CatalogKind */
/** @typedef {{kind: CatalogKind, identity: string, definition: string}} CatalogEntry */
/** @typedef {{postgresMajor: number, entries: CatalogEntry[]}} ApplicationCatalog */
/** @typedef {"alice"|"bob"|"carol"|"outsider"} FixtureActor */
/** @typedef {{database: pg.Client, admin: import("@supabase/supabase-js").SupabaseClient, actors: Record<FixtureActor, import("@supabase/supabase-js").SupabaseClient>}} FixtureContext */

const MIGRATIONS_DIR = "supabase/migrations";
const CONFIG_PATH = "supabase/config.toml";
const FILENAME_PATTERN = /^\d{14}_.*\.sql$/;
const APPLICATION_SCHEMAS = ["public", "guest_credentials"];
const OBSERVED_GRANTEES = ["anon", "authenticated", "PUBLIC", "service_role"];
const ACTOR_NAMES = ["alice", "bob", "carol", "outsider"];
const RECEIPT_ACCESS_KEY = "35260927654896000136550010000927651092765109";

// P3b (20260913010070) closes the lookup bypass: direct authenticated
// lookup_user_by_handle flips to denial on purpose. The upgrade gate asserts
// exactly this named AFTER-state. The BEFORE-state is not pinned: a base
// revision that already carries the migration legitimately seeds as denied.
// No other privilege drift is exempt from equality.
const LOOKUP_FLIP = {
  label: "lookup:direct:authenticated",
  after: "denied",
  note: "intentional upgrade: 20260913010070 revokes browser-role execute on public.lookup_user_by_handle(text); /api/users/lookup owns the rate limit and calls it through service_role",
};
const DM_NONCANONICAL_REPAIR = {
  label: "dm:noncanonical-members",
  after: 0,
  note: "intentional upgrade: 20260913010200 deletes noncanonical DM memberships; bases predating it seed with 1 vulnerable extra member, bases carrying it never seed one",
};
const DM_MEMBER_COUNT_REPAIR = {
  label: "db:count:public.group_members",
  dropsBy: 1,
  note: "intentional upgrade: 20260913010200 deletes exactly the seeded noncanonical DM invitation; on bases that already enforce the canonical pair nothing is seeded and the count is stable",
};
const EXCLUSION_TABLE_INTRODUCED = {
  label: "db:count:public.group_member_exclusions",
  after: 0,
  note: "intentional upgrade: 20260913010250 introduces group_member_exclusions; bases predating it cannot seed the table, so its count label appears empty after the upgrade",
};
export const INTENTIONAL_UPGRADES = new Map([
  [LOOKUP_FLIP.label, LOOKUP_FLIP],
  [DM_NONCANONICAL_REPAIR.label, DM_NONCANONICAL_REPAIR],
  [DM_MEMBER_COUNT_REPAIR.label, DM_MEMBER_COUNT_REPAIR],
  [EXCLUSION_TABLE_INTRODUCED.label, EXCLUSION_TABLE_INTRODUCED],
]);
const START_ARGS = ["start", "-x", "vector,imgproxy,logflare,edge-runtime"];
// 16_rpc_push.sql exposes only claim_push_subscription, which is granted to
// service_role and explicitly revoked from authenticated clients; there is no
// authenticated push RPC to exercise, so the fixture records this fact instead
// of faking a subscription.
const PUSH_OMITTED_NOTE =
  "omitted: 16_rpc_push.sql exposes only claim_push_subscription, a service_role RPC; there is no authenticated push RPC to exercise";


const SCRIPT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXEC_FILE_OPTIONS = { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 };

async function run(executable, args, options = {}) {
  return execFileP(executable, args, { ...EXEC_FILE_OPTIONS, ...options });
}
async function hasGitMetadata(cwd) {
  try {
    await access(join(cwd, ".git"));
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function gitOut(args, cwd) {
  const { stdout } = await run("git", args, { cwd });
  return stdout;
}

/**
 * Reads the pinned Supabase CLI version from package.json devDependencies,
 * the single pin source shared with supabase/setup-cli in CI and
 * scripts/dev-setup.sh.
 *
 * @returns {Promise<string>} the pinned exact semver, e.g. "2.20.3"
 */
async function pinnedSupabaseCliVersion() {
  let pkg;
  try {
    pkg = JSON.parse(await readFile(join(SCRIPT_ROOT, "package.json"), "utf8"));
  } catch (error) {
    throw new Error(`cannot read package.json for the pinned supabase CLI: ${error.message}`);
  }
  const pinned = pkg.devDependencies?.supabase;
  if (typeof pinned !== "string" || !/^\d+\.\d+\.\d+$/.test(pinned)) {
    throw new Error(
      `package.json devDependencies.supabase must pin an exact version, found ${pinned ?? "nothing"}`,
    );
  }
  return pinned;
}

/**
 * Resolves the repo-pinned Supabase CLI and refuses to run on any other
 * version: project layout and flag behavior drift between CLI releases.
 * CI installs the pinned release on PATH via supabase/setup-cli and
 * `npm ci --ignore-scripts` may not install the devDependency executable,
 * so PATH wins when it carries the pin; the checkout-local binary is only
 * a fallback.
 *
 * @returns {Promise<string>} executable that prints the pinned version
 */
async function pinnedSupabaseCli() {
  const pinned = await pinnedSupabaseCliVersion();
  const candidates = [
    ["supabase on PATH", "supabase"],
    [
      "checkout-local node_modules/.bin/supabase",
      join(process.cwd(), "node_modules", ".bin", "supabase"),
    ],
  ];
  const attempts = [];
  for (const [label, bin] of candidates) {
    let printed = null;
    try {
      const { stdout } = await run(bin, ["--version"]);
      printed =
        stdout
          .split("\n")
          .map((line) => line.trim().replace(/^v/, ""))
          .find((line) => /^\d+\.\d+\.\d+$/.test(line)) ?? null;
    } catch {
      printed = null;
    }
    if (printed === pinned) return bin;
    attempts.push(`${label} ${printed === null ? "is not runnable" : `printed ${printed}`}`);
  }
  throw new Error(`pinned supabase CLI ${pinned} required; ${attempts.join("; ")}`);
}

/**
 * Lists the migration files recorded in a git ref's tree.
 *
 * @param {string} ref
 * @param {{cwd?: string}} [options] cwd defaults to the process working directory
 * @returns {Promise<MigrationFile[]>} sorted by version
 */
export async function readMigrationFiles(ref, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const listing = await gitOut(["ls-tree", "-r", ref, "--", MIGRATIONS_DIR], cwd);
  const files = [];
  for (const line of listing.split("\n")) {
    if (line === "") continue;
    const match = /^(\d{6})\s+(\w+)\s+([0-9a-f]{40})\t(.+)$/u.exec(line);
    if (!match) throw new Error(`unparseable git ls-tree output line: ${line}`);
    const [, mode, objectType, blobOid, path] = match;
    // Submodule entries (mode 160000, type "commit") are not files the
    // database could ever replay.
    if (objectType !== "blob") continue;
    files.push({ version: basename(path).slice(0, 14), path, blobOid, mode });
  }
  return files.sort(
    (a, b) => compareStrings(a.version, b.version) || compareStrings(a.path, b.path),
  );
}

function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Validates that head's migration history only extends base's: applied files
 * are frozen (same blob and mode), and every new file carries a unique
 * 14-digit version sorting after base's greatest.
 *
 * @param {MigrationFile[]} baseFiles
 * @param {MigrationFile[]} headFiles
 * @returns {string[]} one message per failure, empty when valid
 */
export function validateMigrationHistory(baseFiles, headFiles) {
  const failures = [];
  const baseByPath = new Map(baseFiles.map((file) => [file.path, file]));
  const headByPath = new Map(headFiles.map((file) => [file.path, file]));
  const baseMaxVersion = baseFiles.reduce((max, file) => (file.version > max ? file.version : max), "");

  for (const path of [...baseByPath.keys()].sort(compareStrings)) {
    const base = baseByPath.get(path);
    const head = headByPath.get(path);
    if (!head) {
      failures.push(`applied migration removed in head: ${path}`);
      continue;
    }
    if (head.blobOid !== base.blobOid || head.mode !== base.mode) {
      failures.push(
        `applied migration frozen but changed in head: ${path} (base blob ${base.blobOid} mode ${base.mode}, head blob ${head.blobOid} mode ${head.mode})`,
      );
    }
  }

  const headVersions = new Map();
  for (const file of headFiles) {
    if (!FILENAME_PATTERN.test(basename(file.path))) {
      failures.push(`head migration filename does not match ${FILENAME_PATTERN.source}: ${file.path}`);
      continue;
    }
    const previous = headVersions.get(file.version);
    if (previous) {
      failures.push(`duplicate head migration version ${file.version}: ${previous} and ${file.path}`);
    } else {
      headVersions.set(file.version, file.path);
    }
    if (!baseByPath.has(file.path) && file.version <= baseMaxVersion) {
      failures.push(
        `head migration backdated: ${file.path} version ${file.version} does not sort after base greatest version ${baseMaxVersion}`,
      );
    }
  }
  return failures;
}

/**
 * Reads the configured postgres major version from a ref's config.toml.
 *
 * @param {string} ref
 * @param {{cwd?: string}} [options] cwd defaults to the process working directory
 * @returns {Promise<number|null>} null when the file or the key is absent
 */
export async function postgresMajor(ref, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  let config;
  try {
    config = await gitOut(["cat-file", "blob", `${ref}:${CONFIG_PATH}`], cwd);
  } catch {
    return null;
  }
  const match = /^\s*major_version\s*=\s*(\d+)\s*$/mu.exec(config);
  return match ? Number(match[1]) : null;
}

function catalogEntry(kind, identity, definition) {
  return { kind, identity, definition: definition.trim() };
}

function sortCatalogEntries(entries) {
  return entries.sort(
    (a, b) => compareStrings(a.kind, b.kind) || compareStrings(a.identity, b.identity),
  );
}

/**
 * Reads the PostgreSQL major version the connected server actually runs.
 *
 * @param {pg.Client} client connected pg client
 * @returns {Promise<number>} e.g. 15 for server_version_num 150001
 */
async function serverMajor(client) {
  const { rows } = await client.query(
    "select current_setting('server_version_num')::int as version_num",
  );
  return Math.trunc(rows[0].version_num / 10000);
}

/**
 * Captures every application object in the `public` and `guest_credentials`
 * schemas of a live database as a comparable catalog. Definitions carry
 * ownership, security attributes, and ACLs so that an upgrade cannot silently
 * shift privileges.
 *
 * @param {pg.Client} client connected pg client
 * @returns {Promise<ApplicationCatalog>}
 */
export async function captureApplicationCatalog(client) {
  const schemas = APPLICATION_SCHEMAS;
  const entries = [];

  const schemasResult = await client.query(
    "select nspname from pg_namespace where nspname = any($1)",
    [schemas],
  );
  for (const row of schemasResult.rows) {
    entries.push(catalogEntry("schema", row.nspname, row.nspname));
  }

  const typesResult = await client.query(
    `select n.nspname as schema_name, t.typname as type_name,
            (select string_agg(e.enumlabel, ',' order by e.enumsortorder)
               from pg_enum e where e.enumtypid = t.oid) as labels
       from pg_type t
       join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = any($1) and t.typtype = 'e'`,
    [schemas],
  );
  for (const row of typesResult.rows) {
    entries.push(catalogEntry("type", `${row.schema_name}.${row.type_name}`, row.labels));
  }

  const relationsResult = await client.query(
    `select n.nspname as schema_name, r.relname as relname, r.relkind,
            r.relrowsecurity, r.relforcerowsecurity,
            pg_get_viewdef(r.oid, true) as viewdef
       from pg_class r
       join pg_namespace n on n.oid = r.relnamespace
      where n.nspname = any($1) and r.relkind in ('r', 'v', 'S')`,
    [schemas],
  );
  for (const row of relationsResult.rows) {
    const parts = [row.relkind];
    if (row.relkind === "v") parts.push(row.viewdef);
    parts.push(String(row.relrowsecurity), String(row.relforcerowsecurity));
    entries.push(
      catalogEntry("relation", `${row.schema_name}.${row.relname}`, parts.join("|")),
    );
  }

  const columnsResult = await client.query(
    `select table_schema, table_name, column_name, data_type, is_nullable, column_default
       from information_schema.columns
      where table_schema = any($1)`,
    [schemas],
  );
  for (const row of columnsResult.rows) {
    entries.push(
      catalogEntry(
        "column",
        `${row.table_schema}.${row.table_name}.${row.column_name}`,
        `${row.data_type}|${row.is_nullable}|${row.column_default === null ? "NULL" : row.column_default}`,
      ),
    );
  }

  const constraintsResult = await client.query(
    `select n.nspname as schema_name, c.relname as table_name, k.conname,
            pg_get_constraintdef(k.oid) as constraintdef
       from pg_constraint k
       join pg_class c on c.oid = k.conrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($1)`,
    [schemas],
  );
  for (const row of constraintsResult.rows) {
    entries.push(
      catalogEntry(
        "constraint",
        `${row.schema_name}.${row.table_name}.${row.conname}`,
        row.constraintdef,
      ),
    );
  }

  const indexesResult = await client.query(
    `select schemaname, tablename, indexname, indexdef
       from pg_indexes
      where schemaname = any($1)`,
    [schemas],
  );
  for (const row of indexesResult.rows) {
    entries.push(
      catalogEntry(
        "index",
        `${row.schemaname}.${row.tablename}.${row.indexname}`,
        row.indexdef,
      ),
    );
  }

  const functionsResult = await client.query(
    `select n.nspname as schema_name, p.proname as function_name,
            pg_get_function_identity_arguments(p.oid) as identity_arguments,
            pg_get_functiondef(p.oid) as functiondef,
            p.prosecdef, p.proconfig, p.proacl::text as proacl,
            pg_get_userbyid(p.proowner) as owner
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = any($1)`,
    [schemas],
  );
  for (const row of functionsResult.rows) {
    const proconfig =
      row.proconfig === null ? "NULL" : [...row.proconfig].sort(compareStrings).join(",");
    entries.push(
      catalogEntry(
        "function",
        `${row.schema_name}.${row.function_name}(${row.identity_arguments})`,
        `${row.functiondef}|prosecdef=${row.prosecdef}|proconfig=${proconfig}|proacl=${row.proacl ?? "NULL"}|owner=${row.owner}`,
      ),
    );
  }

  const triggersResult = await client.query(
    `select n.nspname as schema_name, c.relname as table_name, t.tgname,
            pg_get_triggerdef(t.oid) as triggerdef
       from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
      where not t.tgisinternal and n.nspname = any($1)`,
    [schemas],
  );
  for (const row of triggersResult.rows) {
    entries.push(
      catalogEntry(
        "trigger",
        `${row.schema_name}.${row.table_name}.${row.tgname}`,
        row.triggerdef,
      ),
    );
  }

  const policiesResult = await client.query(
    `select schemaname, tablename, policyname, cmd, roles, qual, with_check
       from pg_policies
      where schemaname = any($1)`,
    [schemas],
  );
  for (const row of policiesResult.rows) {
    entries.push(
      catalogEntry(
        "policy",
        `${row.schemaname}.${row.tablename}.${row.policyname}`,
        `${row.cmd}|${[...row.roles].sort(compareStrings).join(",")}|${row.qual ?? "NULL"}|${row.with_check ?? "NULL"}`,
      ),
    );
  }

  // Effective privileges, not role_table_grants: grants through inherited
  // roles or at column level are invisible in information_schema.
  const grantsResult = await client.query(
    `select n.nspname as schema_name,
            c.relname as object_name,
            r.rolname as grantee,
            (select array_to_string(array_agg(p order by p), ',')
               from unnest(array[
                 case when has_table_privilege(r.oid, c.oid, 'SELECT') then 'SELECT' end,
                 case when has_table_privilege(r.oid, c.oid, 'INSERT') then 'INSERT' end,
                 case when has_table_privilege(r.oid, c.oid, 'UPDATE') then 'UPDATE' end,
                 case when has_table_privilege(r.oid, c.oid, 'DELETE') then 'DELETE' end,
                 case when has_any_column_privilege(r.oid, c.oid, 'SELECT')
                       or has_any_column_privilege(r.oid, c.oid, 'INSERT')
                       or has_any_column_privilege(r.oid, c.oid, 'UPDATE')
                      then 'COLUMN' end
               ]) as p where p is not null) as privileges
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
    [schemas, OBSERVED_GRANTEES],
  );
  for (const row of grantsResult.rows) {
    entries.push(
      catalogEntry(
        "grant",
        `${row.schema_name}.${row.object_name}.${row.grantee}`,
        row.privileges,
      ),
    );
  }
  const sequenceGrantsResult = await client.query(
    `select n.nspname as schema_name,
            c.relname as object_name,
            r.rolname as grantee,
            (select array_to_string(array_agg(p order by p), ',')
               from unnest(array[
                 case when has_sequence_privilege(r.oid, c.oid, 'SELECT') then 'SELECT' end,
                 case when has_sequence_privilege(r.oid, c.oid, 'USAGE') then 'USAGE' end,
                 case when has_sequence_privilege(r.oid, c.oid, 'UPDATE') then 'UPDATE' end
               ]) as p where p is not null) as privileges
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
    [schemas, OBSERVED_GRANTEES],
  );
  for (const row of sequenceGrantsResult.rows) {
    entries.push(
      catalogEntry(
        "grant",
        `${row.schema_name}.${row.object_name}.${row.grantee}`,
        row.privileges,
      ),
    );
  }

  // A default ACL row is identified by role and namespace, but several rows
  // can share that identity (one per object type), so the definition folds
  // every row's exploded privileges behind one identity.
  const defaultAclsResult = await client.query(
    `select pg_get_userbyid(d.defaclrole) as role_name,
            n.nspname as schema_name, d.defaclobjtype as defacltype,
            case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
            a.privilege_type
       from pg_default_acl d
       left join pg_namespace n on n.oid = d.defaclnamespace
       cross join lateral aclexplode(d.defaclacl) as a
      where n.nspname is null or n.nspname = any($1)`,
    [schemas],
  );
  const defaultAclRows = new Map();
  for (const row of defaultAclsResult.rows) {
    const identity = `${row.role_name}|${row.schema_name ?? "NULL"}`;
    const folded = defaultAclRows.get(identity) ?? [];
    folded.push(`${row.defacltype}:${row.grantee},${row.privilege_type}`);
    defaultAclRows.set(identity, folded);
  }
  for (const identity of [...defaultAclRows.keys()].sort(compareStrings)) {
    entries.push(
      catalogEntry("defaultAcl", identity, defaultAclRows.get(identity).sort(compareStrings).join(";")),
    );
  }

  return { postgresMajor: await serverMajor(client), entries: sortCatalogEntries(entries) };
}

async function classifyDirectLookup(client, handle) {
  const { data, error } = await client.rpc("lookup_user_by_handle", { p_handle: handle });
  if (!error && data && data.handle === handle) return "success";
  if (error && /permission denied/i.test(error.message)) return "denied";
  throw new Error(`unexpected direct lookup result: ${JSON.stringify({ data, error })}`);
}

/**
 * @param {ApplicationCatalog} expected
 * @param {ApplicationCatalog} actual
 * @returns {string[]} one message per difference, empty when identical
 */
export function compareApplicationCatalogs(expected, actual) {
  const failures = [];
  if (expected.postgresMajor !== actual.postgresMajor) {
    failures.push(
      `postgresMajor: expected ${expected.postgresMajor} actual ${actual.postgresMajor}`,
    );
  }
  const keyOf = (entry) => `${entry.kind}\u0000${entry.identity}`;
  const actualByKey = new Map(actual.entries.map((entry) => [keyOf(entry), entry]));
  const expectedByKey = new Map(expected.entries.map((entry) => [keyOf(entry), entry]));
  for (const [key, entry] of expectedByKey) {
    const found = actualByKey.get(key);
    if (!found) failures.push(`${entry.kind}: missing ${entry.identity}`);
    else if (found.definition !== entry.definition) {
      failures.push(`${entry.kind}: definition changed ${entry.identity}`);
    }
  }
  for (const [key, entry] of actualByKey) {
    if (!expectedByKey.has(key)) failures.push(`${entry.kind}: extra ${entry.identity}`);
  }
  return failures.sort(compareStrings);
}

/** @param {FixtureActor} actor */
function actorName(actor) {
  return `Verify ${actor[0].toUpperCase()}${actor.slice(1)}`;
}

async function callRpc(client, fn, args) {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(`rpc ${fn} failed: ${error.message}`);
  return data;
}

// Mirrors equalSplitPayload from src/test/integration-helpers.ts so the gate
// exercises the same payload shape the app sends.
function equalSplitPayload(userIds, totalCents, payerIndex = 0) {
  const base = Math.floor(totalCents / userIds.length);
  const remainder = totalCents % userIds.length;
  const shares = userIds.map((_, index) => (index < remainder ? base + 1 : base));
  return {
    items: [],
    participants: userIds.map((userId) => ({ kind: "user", userId })),
    shares,
    payers: [{ participantIndex: payerIndex, amountCents: totalCents }],
    itemAssignments: null,
  };
}

function identityRef(identities, id) {
  for (const [name, value] of Object.entries(identities)) {
    if (value === id) return name;
  }
  return id;
}

function memberStatusEntries(snapshot, identities) {
  return snapshot.members
    .map((member) => `${identityRef(identities, member.userId)}|${member.status}`)
    .sort(compareStrings);
}

function participantRef(participant, identities) {
  if (participant.kind === "user" && participant.user) {
    return identityRef(identities, participant.user.id);
  }
  if (participant.kind === "guest" && participant.guest) {
    return `guest:${participant.guest.displayName}`;
  }
  throw new Error(`unresolved expense participant: ${JSON.stringify(participant)}`);
}

/**
 * Reads the stable final-state facts the upgrade gate compares. Both
 * seedVerificationFixture (after running the scenario) and
 * captureVerificationFixture (after the upgrade) call this, so both sides
 * always derive identical labels from identical state.
 *
 * @param {FixtureContext} context
 * @param {Record<string, string>} identities
 * @returns {Promise<Array<{label: string, value: unknown}>>}
 */
async function collectStableObservations(context, identities) {
  const alice = context.actors.alice;
  const groupId = identities["group:main"];
  const observations = [];

  const snapshot = await callRpc(alice, "get_group", { p_group_id: groupId });
  observations.push({ label: "group:main:members", value: memberStatusEntries(snapshot, identities) });
  const carolMembership = snapshot.members.find(
    (member) => member.userId === identities["user:carol"],
  );
  observations.push({ label: "guest:claim:outcome", value: carolMembership?.status ?? "absent" });
  observations.push({
    label: "balances:post-void",
    value: snapshot.balances
      .map(
        (balance) =>
          `${balance.kind}|${identityRef(identities, balance.participantId)}|${balance.netCents}`,
      )
      .sort(compareStrings),
  });

  const expenseView = await callRpc(alice, "get_expense", { p_expense_id: identities["expense:main"] });
  observations.push({ label: "expense:main:version", value: expenseView.expense.currentVersionNo });
  observations.push({ label: "expense:main:status", value: expenseView.expense.status });
  observations.push({
    label: "expense:main:amounts",
    value: {
      totalCents: expenseView.current.totalCents,
      participants: expenseView.participants
        .map((participant) => ({
          participant: participantRef(participant, identities),
          shareCents: participant.shareCents,
          paidCents: participant.paidCents,
        }))
        .sort((a, b) => compareStrings(a.participant, b.participant)),
    },
  });

  const voidedCount = await context.database.query(
    "select count(*)::int as count from settlements where group_id = $1 and status = 'voided'",
    [groupId],
  );
  observations.push({ label: "settlement:voided:count", value: voidedCount.rows[0].count });

  const conversations = new Map();
  for (const actor of ["alice", "bob"]) {
    conversations.set(
      actor,
      await callRpc(context.actors[actor], "get_conversation", { p_group_id: groupId }),
    );
  }
  const chronological = [...conversations.get("alice").messages].reverse();
  const ordinals = new Map(chronological.map((message, index) => [message.id, index + 1]));
  for (const [actor, conversation] of conversations) {
    observations.push({
      label: `conversation:${actor}:messages`,
      value: [...conversation.messages]
        .reverse()
        .map((message) => `${ordinals.get(message.id)}|${identityRef(identities, message.senderId)}|${message.content}`),
    });
    const watermark = conversation.readWatermark;
    if (watermark === null || watermark === undefined) {
      observations.push({ label: `conversation:${actor}:watermark`, value: null });
      continue;
    }
    const ordinal = ordinals.get(watermark.lastReadMessageId);
    if (ordinal === undefined) {
      throw new Error(`read watermark references a message outside the conversation: ${watermark.lastReadMessageId}`);
    }
    observations.push({ label: `conversation:${actor}:watermark`, value: ordinal });
  }

  const countedTables = await context.database.query(
    `select n.nspname as schema_name, c.relname as table_name,
            (xpath('/row/c/text()', query_to_xml(
               format('select count(*) as c from %I.%I', n.nspname, c.relname),
               false, true, '')))[1]::text::int as count
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($1::text[]) and c.relkind = 'r'
      order by 1, 2`,
    [APPLICATION_SCHEMAS],
  );
  for (const row of countedTables.rows) {
    observations.push({
      label: `db:count:${row.schema_name}.${row.table_name}`,
      value: row.count,
    });
  }

  const vendor = await callRpc(alice, "get_vendor_charges", {});
  observations.push({
    label: "vendor:visible",
    value: vendor.charges
      .map((charge) => `${charge.description}|${charge.amountCents}|${charge.status}`)
      .sort(compareStrings),
  });
  observations.push({
    label: "vendor:totals",
    value: {
      total: vendor.total,
      receivedCount: vendor.receivedCount,
      receivedTodayCents: vendor.receivedTodayCents,
    },
  });

  const preview = await callRpc(context.actors.outsider, "preview_invite_link", {
    p_token: identities["invite:token"],
  });
  observations.push({
    label: "invite:preview",
    value: {
      groupName: preview.groupName,
      memberCount: preview.memberCount,
      creatorName: preview.creatorName,
      valid: preview.valid,
    },
  });

  const dm = await callRpc(alice, "get_group", { p_group_id: identities["group:dm"] });
  // The canonical pair's membership state is this label's contract; any
  // noncanonical row is exactly what dm:noncanonical-members observes (and
  // what 20260913010200 deletes), so it must not leak into the pair view.
  const dmPair = await context.database.query(
    "select dm_user_a, dm_user_b from public.groups where id = $1",
    [identities["group:dm"]],
  );
  const pair = new Set([dmPair.rows[0].dm_user_a, dmPair.rows[0].dm_user_b]);
  const dmCanonical = {
    ...dm,
    members: dm.members.filter((member) => pair.has(member.userId)),
  };
  observations.push({ label: "dm:members", value: memberStatusEntries(dmCanonical, identities) });

  const noncanonical = await context.database.query(
    `select count(*)::int as count
       from public.group_members gm
       join public.groups g on g.id = gm.group_id
      where g.kind = 'dm'
        and gm.user_id is distinct from g.dm_user_a
        and gm.user_id is distinct from g.dm_user_b`,
  );
  observations.push({
    label: "dm:noncanonical-members",
    value: noncanonical.rows[0].count,
  });

  const receiptKey = await context.database.query(
    "select (chave_acesso is not null) as present from expenses where id = $1",
    [identities["expense:main"]],
  );
  if (receiptKey.rows.length !== 1) {
    throw new Error(`expense ${identities["expense:main"]} disappeared before recapture`);
  }
  observations.push({
    label: "expense:receipt:key-present",
    value: receiptKey.rows[0].present,
  });

  observations.push({
    label: LOOKUP_FLIP.label,
    value: await classifyDirectLookup(alice, "verify_bob"),
  });
  observations.push({
    label: "lookup:direct:anon",
    value: await classifyDirectLookup(context.actors.outsider, "verify_bob"),
  });

  observations.push({ label: "notes:push", value: PUSH_OMITTED_NOTE });
  return observations;
}

function sortObservations(observations) {
  return observations.sort((a, b) => compareStrings(a.label, b.label));
}

/**
 * Seeds the verification fixture through the actor clients, then records the
 * reproducible final-state observations. Encrypted pix keys and timestamps
 * never enter the observations; random ids are normalized through the
 * identities map.
 *
 * @param {FixtureContext} context
 * @returns {Promise<{identities: Record<string, string>, observations: Array<{label: string, value: unknown}>}>}
 */
export async function seedVerificationFixture(context) {
  const identities = {};
  for (const actor of ACTOR_NAMES) {
    const email = `${actor}@verify.dividimos.local`;
    const password = `${actor}-verify-${randomUUID()}`;
    const created = await context.admin.auth.admin.createUser({
      email,
      email_confirm: true,
      password,
    });
    if (created.error) throw new Error(`createUser ${actor} failed: ${created.error.message}`);
    identities[`user:${actor}`] = created.data.user.id;
    const signedIn = await context.actors[actor].auth.signInWithPassword({ email, password });
    if (signedIn.error) throw new Error(`signInWithPassword ${actor} failed: ${signedIn.error.message}`);
    await callRpc(context.actors[actor], "complete_onboarding", {
      p_handle: `verify_${actor}`,
      p_name: actorName(actor),
      p_pix_key_encrypted: "enc",
      p_pix_key_hint: "hint",
      p_pix_key_type: "cpf",
    });
  }

  const alice = context.actors.alice;
  const bob = context.actors.bob;
  const carol = context.actors.carol;
  const aliceId = identities["user:alice"];
  const bobId = identities["user:bob"];
  const carolId = identities["user:carol"];

  // Identity resolution stays off the lookup RPC entirely: browser roles
  // lost direct execution in 20260913010070 and service_role only gained it
  // there, so any RPC-based resolution would break one side of an upgrade.
  // The seeded profile is asserted at the schema level instead, and the
  // observation classifier below records the browser-role flip.
  const bobProfileRow = await context.database.query(
    "select handle from public.users where id = $1",
    [bobId],
  );
  if (bobProfileRow.rows[0]?.handle !== "verify_bob") {
    throw new Error(`seeded bob profile missing: ${JSON.stringify(bobProfileRow.rows)}`);
  }

  const group = await callRpc(alice, "create_group", { p_name: "Verify Group", p_member_ids: [] });
  identities["group:main"] = group.groupId;
  await callRpc(alice, "invite_member", { p_group_id: group.groupId, p_user_id: bobId });
  await callRpc(bob, "accept_invitation", { p_group_id: group.groupId });

  const mainSplit = equalSplitPayload([aliceId, bobId], 10000);
  const expense = await callRpc(alice, "create_expense", {
    p_client_id: randomUUID(),
    p_group_id: group.groupId,
    p_occurred_on: "2026-09-13",
    p_title: "Verify Expense",
    p_merchant_name: null,
    p_expense_type: "single_amount",
    p_total_cents: 10000,
    p_service_fee_bps: 0,
    p_fixed_fee_cents: 0,
    p_chave_acesso: RECEIPT_ACCESS_KEY,
    p_payload: mainSplit,
  });
  identities["expense:main"] = expense.expenseId;
  const edited = await callRpc(alice, "edit_expense", {
    p_expense_id: expense.expenseId,
    p_expected_version_no: 1,
    p_occurred_on: "2026-09-13",
    p_title: "Verify Expense Edited",
    p_merchant_name: null,
    p_expense_type: "single_amount",
    p_total_cents: 10000,
    p_service_fee_bps: 0,
    p_fixed_fee_cents: 0,
    p_payload: mainSplit,
  });
  if (edited.versionNo !== 2) {
    throw new Error(`edit_expense produced version ${edited.versionNo}, expected 2`);
  }

  const guestExpense = await callRpc(alice, "create_expense", {
    p_client_id: randomUUID(),
    p_group_id: group.groupId,
    p_occurred_on: "2026-09-13",
    p_title: "Verify Guest Expense",
    p_merchant_name: null,
    p_expense_type: "single_amount",
    p_total_cents: 10000,
    p_service_fee_bps: 0,
    p_fixed_fee_cents: 0,
    p_chave_acesso: null,
    p_payload: {
      items: [],
      participants: [
        { kind: "user", userId: aliceId },
        { kind: "guest", displayName: "Verify Guest" },
      ],
      shares: [5000, 5000],
      payers: [{ participantIndex: 0, amountCents: 10000 }],
      itemAssignments: null,
    },
  });
  identities["expense:guest"] = guestExpense.expenseId;
  const guestView = await callRpc(alice, "get_expense", { p_expense_id: guestExpense.expenseId });
  const guestParticipant = guestView.participants.find((participant) => participant.kind === "guest");
  if (!guestParticipant || !guestParticipant.guest) {
    throw new Error("guest participant missing after create_expense");
  }
  identities["guest:main"] = guestParticipant.guest.id;

  const claim = await callRpc(alice, "create_guest_claim_token", {
    p_guest_id: identities["guest:main"],
  });
  const resolved = await callRpc(carol, "resolve_guest_claim_token", { p_token: claim.token });
  if (resolved.status !== "ready") {
    throw new Error(`resolve_guest_claim_token returned status ${resolved.status}, expected ready`);
  }
  await callRpc(carol, "claim_guest", { p_token: claim.token });

  const settlement = await callRpc(bob, "record_settlement", {
    p_operation_id: randomUUID(),
    p_group_id: group.groupId,
    p_from_user_id: bobId,
    p_to_user_id: aliceId,
    p_amount_cents: 4000,
  });
  identities["settlement:main"] = settlement.settlementId;
  await callRpc(alice, "void_settlement", { p_settlement_id: settlement.settlementId });

  const aliceFirst = await callRpc(alice, "send_message", {
    p_client_id: randomUUID(),
    p_group_id: group.groupId,
    p_content: "verify-alice-1",
  });
  const aliceSecond = await callRpc(alice, "send_message", {
    p_client_id: randomUUID(),
    p_group_id: group.groupId,
    p_content: "verify-alice-2",
  });
  await callRpc(bob, "send_message", {
    p_client_id: randomUUID(),
    p_group_id: group.groupId,
    p_content: "verify-bob-1",
  });
  await callRpc(bob, "mark_read", {
    p_group_id: group.groupId,
    p_last_read_message_id: aliceSecond.id,
  });
  if (!aliceFirst.id || !aliceSecond.id) {
    throw new Error("send_message returned no message id");
  }

  const receivedCharge = await callRpc(alice, "record_vendor_charge", {
    p_amount_cents: 2500,
    p_description: "verify-received",
  });
  await callRpc(alice, "confirm_vendor_charge", { p_charge_id: receivedCharge.id });
  const cancelledCharge = await callRpc(alice, "record_vendor_charge", {
    p_amount_cents: 700,
    p_description: "verify-cancelled",
  });
  await callRpc(alice, "cancel_vendor_charge", { p_charge_id: cancelledCharge.id });

  const invite = await callRpc(alice, "create_invite_link", { p_group_id: group.groupId });
  identities["invite:token"] = invite.token;

  const dm = await callRpc(alice, "get_or_create_dm", { p_user_id: carolId });
  identities["group:dm"] = dm.groupId;
  await callRpc(alice, "send_message", {
    p_client_id: randomUUID(),
    p_group_id: dm.groupId,
    p_content: "verify-dm-1",
  });


  // Seed the vulnerable A/B/C state THROUGH the RPC: inviting a third user
  // into the DM succeeds exactly on bases that predate 20260913010200 and
  // fails with invalid_operation on bases that already enforce the canonical
  // pair, so the fixture reproduces the pre-repair state only where it could
  // really exist, and the upgrade's repair deletes exactly that invitation.
  identities["dm:vulnerable"] = "no";
  try {
    await callRpc(alice, "invite_member", {
      p_group_id: dm.groupId,
      p_user_id: identities["user:outsider"],
    });
    identities["dm:vulnerable"] = "yes";
  } catch (error) {
    if (!/invalid_operation/.test(String(error?.message ?? error))) {
      throw error;
    }
  }

  // preview_invite_link is granted to anon as well as authenticated; signing
  // the outsider out makes the preview exercise the anon-reachable path.
  await context.actors.outsider.auth.signOut();
  const preview = await callRpc(context.actors.outsider, "preview_invite_link", {
    p_token: invite.token,
  });
  if (preview.valid !== true) {
    throw new Error(`preview_invite_link rejected the fresh token: ${JSON.stringify(preview)}`);
  }

  return { identities, observations: sortObservations(await collectStableObservations(context, identities)) };
}

/**
 * Re-reads the fixture's observable state after an upgrade without re-running
 * the scenario, producing exactly the labels seedVerificationFixture records.
 *
 * @param {FixtureContext} context
 * @param {Record<string, string>} identities identities returned by the seed
 * @returns {Promise<Array<{label: string, value: unknown}>>} sorted by label
 */
export async function captureVerificationFixture(context, identities) {
  return sortObservations(await collectStableObservations(context, identities));
}

/**
 * Compares seed observations against recaptured ones by label.
 *
 * @param {Array<{label: string, value: unknown}>} expected
 * @param {Array<{label: string, value: unknown}>} actual
 * @returns {string[]} one message per difference, empty when identical
 */
export function compareFixtureObservations(expected, actual) {
  const failures = [];
  const expectedByLabel = new Map(expected.map((observation) => [observation.label, observation.value]));
  const actualByLabel = new Map(actual.map((observation) => [observation.label, observation.value]));
  for (const [label, value] of expectedByLabel) {
    if (!actualByLabel.has(label)) {
      failures.push(`${label}: before=${JSON.stringify(value)} after=missing`);
    }
  }
  for (const [label, value] of actualByLabel) {
    if (!expectedByLabel.has(label)) {
      // A reviewed migration may introduce an observable that cannot exist
      // on the base (a new table's count); the entry pins the only value
      // the upgrade may surface for it.
      const upgrade = INTENTIONAL_UPGRADES.get(label);
      if (upgrade !== undefined && isDeepStrictEqual(value, upgrade.after)) continue;
      failures.push(`${label}: unexpected after upgrade, after=${JSON.stringify(value)}`);
    }
  }
  for (const [label, expectedValue] of expectedByLabel) {
    if (INTENTIONAL_UPGRADES.has(label)) continue;
    const actualValue = actualByLabel.get(label);
    if (actualValue === undefined || isDeepStrictEqual(expectedValue, actualValue)) continue;
    failures.push(`${label}: before=${JSON.stringify(expectedValue)} after=${JSON.stringify(actualValue)}`);
  }
  for (const [label, upgrade] of INTENTIONAL_UPGRADES) {
    const before = expectedByLabel.get(label);
    const after = actualByLabel.get(label);
    if (before === undefined && after === undefined) continue;
    if (upgrade.dropsBy !== undefined) {
      if (before === after) continue;
      if (typeof before === "number" && typeof after === "number" && before - after === upgrade.dropsBy) {
        continue;
      }
      failures.push(`${label}: repair should delete exactly ${upgrade.dropsBy} row(s), observed before=${JSON.stringify(before)} after=${JSON.stringify(after)} (${upgrade.note})`);
      continue;
    }
    if (after !== upgrade.after) {
      failures.push(`${label}: upgrade should be ${JSON.stringify(upgrade.after)}, observed after=${JSON.stringify(after)} (${upgrade.note})`);
    }
  }
  return failures.sort(compareStrings);
}

async function startProject(bin, projectDir) {
  try {
    await run(bin, START_ARGS, { cwd: projectDir });
  } catch (first) {
    await run(bin, ["stop", "--no-backup"], { cwd: projectDir }).catch(() => {});
    try {
      await run(bin, START_ARGS, { cwd: projectDir });
    } catch (second) {
      throw new Error(
        `supabase start failed twice\nfirst attempt:\n${first.stdout ?? ""}${first.stderr ?? ""}\nsecond attempt:\n${second.stdout ?? ""}${second.stderr ?? ""}`,
      );
    }
  }
}

async function readProjectEnv(bin, projectDir) {
  const { stdout } = await run(bin, ["status", "--output", "json"], { cwd: projectDir });
  const status = JSON.parse(stdout);
  const mapping = {
    api_url: "API_URL",
    anon_key: "ANON_KEY",
    service_role_key: "SERVICE_ROLE_KEY",
    db_url: "DB_URL",
  };
  const env = {};
  const missing = [];
  for (const [key, source] of Object.entries(mapping)) {
    if (typeof status[source] !== "string" || status[source] === "") missing.push(source);
    else env[key] = status[source];
  }
  if (missing.length > 0) {
    throw new Error(`supabase status output is missing ${missing.join(", ")}`);
  }
  return env;
}

async function writeMigrationBlobs(gitRef, files, migrationsDir, cwd) {
  for (const file of files) {
    const blob = await gitOut(["cat-file", "blob", `${gitRef}:${file.path}`], cwd);
    await writeFile(join(migrationsDir, basename(file.path)), blob);
  }
}

async function applyHeadMigrations(bin, projectDir, cwd, baseFiles, headFiles, headRef) {
  const baseMaxVersion = baseFiles.reduce((max, file) => (file.version > max ? file.version : max), "");
  await writeMigrationBlobs(
    headRef,
    headFiles.filter((file) => file.version > baseMaxVersion),
    join(projectDir, "supabase", "migrations"),
    cwd,
  );
  try {
    await run(bin, ["migration", "up", "--local"], { cwd: projectDir });
  } catch (error) {
    throw new Error(`supabase migration up failed\n${error.stdout ?? ""}${error.stderr ?? ""}`);
  }
}

function buildFixtureContext(env, database) {
  const auth = { autoRefreshToken: false, persistSession: false };
  return {
    database,
    admin: createClient(env.api_url, env.service_role_key, { auth }),
    actors: {
      alice: createClient(env.api_url, env.anon_key, { auth }),
      bob: createClient(env.api_url, env.anon_key, { auth }),
      carol: createClient(env.api_url, env.anon_key, { auth }),
      outsider: createClient(env.api_url, env.anon_key, { auth }),
    },
  };
}

/**
 * Runs one full verification mode and writes the artifacts.
 *
 * @param {{baseRef: string, headRef: string, mode: "fresh"|"upgrade", artifactDirectory: string, keep?: boolean, cwd?: string}} options
 *   cwd scopes git operations and defaults to the process working directory
 * @returns {Promise<ApplicationCatalog & {observations?: Array<{label: string, value: unknown}>}>}
 * @throws {Error} with every accumulated failure message
 */
export async function verifyMigrations(options) {
  const { baseRef, headRef, mode, artifactDirectory, keep = false } = options;
  const cwd = options.cwd ?? process.cwd();
  if (mode !== "fresh" && mode !== "upgrade") throw new Error(`unknown mode: ${String(mode)}`);
  if (!baseRef) throw new Error("a --base revision is required");
  if (!headRef) throw new Error("a --head revision is required");
  if (!artifactDirectory) throw new Error("an --artifacts directory is required");

  let bin;
  if (!(await hasGitMetadata(cwd))) {
    bin = await pinnedSupabaseCli();
  }

  const baseFiles = await readMigrationFiles(baseRef, { cwd });
  const headFiles = await readMigrationFiles(headRef, { cwd });
  const failures = validateMigrationHistory(baseFiles, headFiles);
  const baseMajor = await postgresMajor(baseRef, { cwd });
  const headMajor = await postgresMajor(headRef, { cwd });
  if (baseMajor !== null && headMajor !== null && baseMajor !== headMajor) {
    failures.push(
      `a major version change needs its own tested toolchain PR: ${baseRef} has major_version ${baseMajor}, ${headRef} has ${headMajor}`,
    );
  }
  if (failures.length > 0) throw new Error(failures.join("\n"));
  bin = await pinnedSupabaseCli();

  const builtRef = mode === "fresh" ? headRef : baseRef;
  const config = await gitOut(["cat-file", "blob", `${builtRef}:${CONFIG_PATH}`], cwd);
  await mkdir(artifactDirectory, { recursive: true });

  const projectDir = await mkdtemp(join(tmpdir(), "verify-migrations-"));
  try {
    // The temp project carries only config.toml and the migration files; the
    // declarative schemas under supabase/schemas/ are intentionally absent,
    // the gate replays the frozen migration history.
    const migrationsDir = join(projectDir, "supabase", "migrations");
    await mkdir(migrationsDir, { recursive: true });
    await writeFile(join(projectDir, "supabase", "config.toml"), config);
    await writeMigrationBlobs(builtRef, mode === "fresh" ? headFiles : baseFiles, migrationsDir, cwd);

    await startProject(bin, projectDir);
    const env = await readProjectEnv(bin, projectDir);
    await writeFile(join(artifactDirectory, "env.json"), `${JSON.stringify(env, null, 2)}\n`);

    const database = new pg.Client({ connectionString: env.db_url });
    await database.connect();
    try {
      const actualServerMajor = await serverMajor(database);
      if (headMajor !== null && actualServerMajor !== headMajor) {
        throw new Error(
          `the replayed server runs PostgreSQL ${actualServerMajor} but the head declares ${headMajor}; a major version change needs its own tested toolchain PR`,
        );
      }
      let catalog;
      if (mode === "fresh") {
        catalog = await captureApplicationCatalog(database);
      } else {
        const context = buildFixtureContext(env, database);
        const seed = await seedVerificationFixture(context);
        await writeFile(
          join(artifactDirectory, "observations.json"),
          `${JSON.stringify(seed.observations, null, 2)}\n`,
        );
        await applyHeadMigrations(bin, projectDir, cwd, baseFiles, headFiles, headRef);
        const recaptured = await captureVerificationFixture(context, seed.identities);
        const observationFailures = compareFixtureObservations(seed.observations, recaptured);
        if (observationFailures.length > 0) throw new Error(observationFailures.join("\n"));
        catalog = await captureApplicationCatalog(database);
        catalog.observations = recaptured;
      }
      // Artifact contract: the catalog keeps the major the live server
      // reported (never the configured one), so compare catches a stack
      // replayed on the wrong PostgreSQL release.
      await writeFile(
        join(artifactDirectory, "catalog.json"),
        `${JSON.stringify({ postgresMajor: catalog.postgresMajor, entries: catalog.entries }, null, 2)}\n`,
      );
      return catalog;
    } finally {
      await database.end();
    }
  } finally {
    if (keep) {
      await writeFile(join(artifactDirectory, "project-dir.txt"), `${projectDir}\n`);
    } else {
      // Cleanup is best-effort: a failed stop must never mask the primary
      // failure with a cleanup error.
      await run(bin, ["stop", "--no-backup"], { cwd: projectDir }).catch((error) => {
        console.error(`verify-migrations: supabase stop failed: ${error.message}`);
      });
      await rm(projectDir, { recursive: true, force: true });
    }
  }
}

const USAGE = `usage:
  node scripts/verify-migrations.mjs fresh   --base <ref> --head <ref> --artifacts <dir> [--keep]
  node scripts/verify-migrations.mjs upgrade --base <ref> --head <ref> --artifacts <dir> [--keep]
  node scripts/verify-migrations.mjs compare --expected <catalog.json> --actual <catalog.json>`;

function parseArgs(argv, valueFlags, booleanFlags) {
  const flags = new Map();
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new Error(`unexpected argument: ${arg}`);
    const name = arg.slice(2);
    if (flags.has(name)) throw new Error(`duplicate flag: ${arg}`);
    if (booleanFlags.includes(name)) {
      flags.set(name, "true");
      continue;
    }
    if (!valueFlags.includes(name)) throw new Error(`unknown flag: ${arg}`);
    if (index + 1 >= argv.length) throw new Error(`missing value for ${arg}`);
    flags.set(name, argv[index + 1]);
    index++;
  }
  return flags;
}

async function readCatalogFile(path) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`catalog ${path} is not readable JSON: ${error.message}`);
  }
  if (typeof parsed?.postgresMajor !== "number" || !Array.isArray(parsed?.entries)) {
    throw new Error(`catalog ${path} is not an application catalog`);
  }
  for (const entry of parsed.entries) {
    if (
      typeof entry?.kind !== "string" ||
      typeof entry?.identity !== "string" ||
      typeof entry?.definition !== "string"
    ) {
      throw new Error(`catalog ${path} has a malformed entry: ${JSON.stringify(entry)}`);
    }
  }
  return parsed;
}

/**
 * @returns {Promise<number>} process exit code
 */
async function main(argv) {
  const [mode, ...rest] = argv;
  if (mode !== "fresh" && mode !== "upgrade" && mode !== "compare") {
    console.error(USAGE);
    for (const line of [mode ? `unknown mode: ${mode}` : "missing mode"]) {
      console.error(`::error::${line}`);
    }
    return 1;
  }
  try {
    if (mode === "compare") {
      const flags = parseArgs(rest, ["expected", "actual"], []);
      const expectedPath = flags.get("expected");
      const actualPath = flags.get("actual");
      if (!expectedPath || !actualPath) {
        throw new Error("compare requires --expected and --actual");
      }
      const failures = compareApplicationCatalogs(
        await readCatalogFile(expectedPath),
        await readCatalogFile(actualPath),
      );
      if (failures.length === 0) {
        console.log("OK: catalogs identical");
        return 0;
      }
      for (const failure of failures) console.error(`::error::${failure}`);
      console.error(`compare failed with ${failures.length} difference(s)`);
      return 1;
    }
    const flags = parseArgs(rest, ["base", "head", "artifacts"], ["keep"]);
    const baseRef = flags.get("base");
    const headRef = flags.get("head");
    const artifactDirectory = flags.get("artifacts");
    if (!baseRef || !headRef || !artifactDirectory) {
      throw new Error("fresh and upgrade require --base, --head, and --artifacts");
    }
    const artifacts = resolve(artifactDirectory);
    await verifyMigrations({
      baseRef,
      headRef,
      mode,
      artifactDirectory: artifacts,
      keep: flags.has("keep"),
    });
    console.log(`OK: ${mode} verification passed; artifacts in ${artifacts}`);
    return 0;
  } catch (error) {
    for (const line of String(error?.message ?? error).split("\n")) {
      console.error(`::error::${line}`);
    }
    console.error(`${mode} verification failed`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  process.exit(await main(process.argv.slice(2)));
}
