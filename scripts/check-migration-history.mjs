#!/usr/bin/env node
// Guards the immutability of applied database migrations.
//
// Usage:
//   node scripts/check-migration-history.mjs <base-sha> <head-sha> \
//     [--allow-ci-changes] [--trusted-main <sha>]
//
// Rules:
//   1. Files that exist in the PR base tree are frozen: editing, deleting,
//      renaming or chmod-ing one fails. The deployed database records
//      migrations by filename and never re-reads a file.
//   2. New migration files carry a unique 14-digit timestamp that sorts after
//      the base's greatest version. Duplicate versions (even with different
//      descriptive suffixes), backdated additions, and nonconforming names
//      fail.
//   3. Replacing applied history wholesale is authorized only by an exact
//      manifest pinned to blob contents AND file modes, read exclusively from
//      the --trusted-main commit (the immutable main commit the trusted
//      workflow detached to). Neither the PR head nor the PR base branch can
//      supply its own authorization: an unmerged stacked parent carrying a
//      manifest authorizes nothing. No PR number, branch name, label or
//      environment flag authorizes a reset.
//
// The PR's own changes are measured from the merge base, but frozen-path and
// timestamp-collision decisions use the actual base tree, so a migration that
// landed on the base branch after this PR started still collides correctly.

import { execFileSync } from "node:child_process";

const MIGRATIONS_DIR = "supabase/migrations";
const RESET_MANIFEST_PATH = "supabase/migrations-reset-manifest.json";
const VERSION_PATTERN = /^(\d{14})_/;
const REGULAR_FILE_MODES = new Set(["100644", "100755"]);
const BLOB_PATTERN = /^[0-9a-f]{40}$/;

// Files the deployed database can never re-read, and files whose edits decide
// what the gates themselves do. An ordinary PR may not touch them.
const PROTECTED_CI_PATHS = [
  ".github/workflows/",
  "scripts/check-migration-history.mjs",
  "supabase/config.toml",
  RESET_MANIFEST_PATH,
];

function git(args, options = {}) {
  return execFileSync("git", args, {
    encoding: "buffer",
    maxBuffer: 256 * 1024 * 1024,
    ...options,
  });
}

function gitText(args, options = {}) {
  return git(args, options).toString("utf8");
}

/** @typedef {{path: string, blob: string, mode: string}} MigrationFile */

/**
 * @param {string} sha
 * @returns {Map<string, {blob: string, mode: string}>}
 */
function migrationBlobMap(sha) {
  const out = gitText(["ls-tree", "-r", sha, "--", MIGRATIONS_DIR]);
  const map = new Map();
  for (const line of out.split("\n")) {
    if (line.length === 0) continue;
    const [meta, path] = line.split("\t");
    const parts = meta.split(/\s+/);
    if (parts[1] !== "blob") continue;
    map.set(path, { blob: parts[2], mode: parts[0] });
  }
  return map;
}

function resetManifestShapeFailures(manifest) {
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    return [`${RESET_MANIFEST_PATH} on trusted main is not a reset manifest object`];
  }
  const failures = [];
  for (const section of ["old", "new"]) {
    const entries = manifest[section];
    if (
      entries === null ||
      typeof entries !== "object" ||
      Array.isArray(entries) ||
      Object.keys(entries).length === 0
    ) {
      failures.push(
        `${RESET_MANIFEST_PATH} on trusted main has no nonempty "${section}" section`,
      );
      continue;
    }
    for (const [path, entry] of Object.entries(entries)) {
      if (
        entry === null ||
        typeof entry !== "object" ||
        Array.isArray(entry) ||
        typeof entry.blob !== "string" ||
        !BLOB_PATTERN.test(entry.blob) ||
        !REGULAR_FILE_MODES.has(entry.mode)
      ) {
        failures.push(
          `${RESET_MANIFEST_PATH} entry for ${path} must pin ` +
            `{ "blob": 40-hex, "mode": "100644" or "100755" }`,
        );
      }
    }
  }
  return failures;
}

/**
 * The reset manifest is read only from the trusted main commit supplied by
 * the trusted workflow. Returns null when absent there.
 * @param {string | undefined} trustedMainSha
 */
function readResetManifest(trustedMainSha) {
  if (!trustedMainSha) {
    return { failures: ["no --trusted-main commit was supplied, so no reset can be authorized"] };
  }
  let raw;
  try {
    raw = gitText(
      ["cat-file", "blob", `${trustedMainSha}:${RESET_MANIFEST_PATH}`],
      { stdio: "pipe" },
    );
  } catch {
    return { failures: [`trusted main carries no reviewed reset manifest at ${RESET_MANIFEST_PATH}`] };
  }
  try {
    const parsed = JSON.parse(raw);
    return { manifest: parsed, failures: resetManifestShapeFailures(parsed) };
  } catch (error) {
    return {
      failures: [`${RESET_MANIFEST_PATH} on trusted main is not valid JSON: ${error.message}`],
    };
  }
}

// Compares a live tree map against a manifest section and returns one failure
// per missing, extra, modified, or wrongly-moded file.
function manifestMismatches(label, treeMap, manifestSection) {
  const failures = [];
  for (const [path, entry] of Object.entries(manifestSection)) {
    const found = treeMap.get(path);
    if (found === undefined) {
      failures.push(`${label} is missing ${path}`);
    } else if (found.blob !== entry.blob) {
      failures.push(`${label} file ${path} does not match the manifest blob identity`);
    } else if (found.mode !== entry.mode) {
      failures.push(`${label} file ${path} has mode ${found.mode}, manifest requires ${entry.mode}`);
    }
  }
  for (const path of treeMap.keys()) {
    if (!(path in manifestSection)) {
      failures.push(`${label} carries ${path}, which the manifest does not authorize`);
    }
  }
  return failures;
}

/**
 * @param {string | undefined} trustedMainSha
 * @param {Map<string, {blob: string, mode: string}>} baseMap
 * @param {Map<string, {blob: string, mode: string}>} headMap
 */
function resetTransitionFailures(trustedMainSha, baseMap, headMap) {
  const { manifest, failures } = readResetManifest(trustedMainSha);
  if (failures.length > 0 || !manifest) return failures;
  return [
    ...manifestMismatches("the base", baseMap, manifest.old),
    ...manifestMismatches("the head", headMap, manifest.new),
  ];
}

/**
 * Paths changed by the PR itself, measured from the merge base so migrations
 * that landed on the base branch after this PR started are not attributed to
 * it. Renames are decomposed into a delete and an add, so the old path shows
 * up as changed instead of hiding behind an R status.
 */
function changedPaths(mergeBase, headSha, pathspec) {
  const out = gitText([
    "diff",
    "--name-only",
    "--no-renames",
    mergeBase,
    headSha,
    "--",
    ...pathspec,
  ]);
  return out.split("\n").filter((line) => line.length > 0);
}

function migrationVersion(path) {
  const name = path.split("/").pop();
  const match = name.match(VERSION_PATTERN);
  return match === null ? null : match[1];
}

/**
 * @param {Map<string, {blob: string, mode: string}>} baseMap
 * @param {Map<string, {blob: string, mode: string}>} headMap
 */
function timestampFailures(baseMap, headMap) {
  const failures = [];
  const added = [...headMap.keys()].filter((path) => !baseMap.has(path));

  for (const path of added) {
    if (migrationVersion(path) === null) {
      failures.push(
        `new migration ${path} does not follow the <14-digit-timestamp>_<description>.sql naming rule`,
      );
    }
  }

  const byVersion = new Map();
  for (const path of headMap.keys()) {
    const version = migrationVersion(path);
    if (version === null) continue;
    const peers = byVersion.get(version) ?? [];
    peers.push(path);
    byVersion.set(version, peers);
  }
  for (const [version, paths] of byVersion) {
    if (paths.length > 1) {
      failures.push(
        `migration version ${version} is used by multiple files: ${paths.sort().join(", ")}`,
      );
    }
  }

  const baseVersions = [...baseMap.keys()]
    .map(migrationVersion)
    .filter((version) => version !== null)
    .sort();
  const maxBaseVersion = baseVersions[baseVersions.length - 1];
  if (maxBaseVersion !== undefined) {
    for (const path of added) {
      const version = migrationVersion(path);
      if (version !== null && version <= maxBaseVersion) {
        failures.push(
          `new migration ${path} sorts at or before the base's greatest version ${maxBaseVersion}; ` +
            `new versions must sort after it`,
        );
      }
    }
  }

  return failures;
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function main() {
  const args = process.argv.slice(2);
  const allowCiChanges = args.includes("--allow-ci-changes");
  const trustedMainSha = optionValue(args, "--trusted-main");
  const [baseSha, headSha] = args.filter((a) => !a.startsWith("--"));
  if (!baseSha || !headSha) {
    console.error(
      "usage: check-migration-history.mjs <base-sha> <head-sha> " +
        "[--allow-ci-changes] [--trusted-main <sha>]",
    );
    process.exit(2);
  }

  const mergeBase = gitText(["merge-base", baseSha, headSha]).trim();

  const touchedCi = changedPaths(mergeBase, headSha, PROTECTED_CI_PATHS);
  if (touchedCi.length > 0 && !allowCiChanges) {
    console.error(
      "::error::This PR changes CI or database configuration that the gates rely on.",
    );
    for (const path of touchedCi) console.error(`  - ${path}`);
    console.error("");
    console.error("Why: these files decide what every other check is allowed to");
    console.error("approve, so a PR cannot quietly weaken them alongside a change.");
    console.error("");
    console.error(
      "Fix: a maintainer reviews the diff and adds the 'trusted-ci-change' label.",
    );
    process.exit(1);
  }

  const baseMap = migrationBlobMap(baseSha);
  const headMap = migrationBlobMap(headSha);
  const touched = changedPaths(mergeBase, headSha, [`${MIGRATIONS_DIR}/*.sql`]);
  const offenders = touched.filter((path) => baseMap.has(path)).sort();
  const backdates = timestampFailures(baseMap, headMap);

  if (offenders.length === 0 && backdates.length === 0) {
    console.log("OK: no already-applied migration was touched.");
    console.log(
      `OK: ${headMap.size} migration files with unique, ordered versions.`,
    );
    return;
  }

  if (offenders.length > 0) {
    const resetFailures = resetTransitionFailures(trustedMainSha, baseMap, headMap);
    if (resetFailures.length === 0) {
      console.log("OK: exact reset transition authorized by the reviewed trusted-main manifest.");
      return;
    }
    console.error(
      "::error::Migrations already present on the base branch must not be changed.",
    );
    for (const path of offenders) console.error(`  - ${path}`);
    console.error("");
    console.error("Why: the remote DB records each migration by its filename timestamp");
    console.error("and never re-runs it. Editing one ships schema drift; renaming or");
    console.error("deleting one creates phantom versions in");
    console.error("supabase_migrations.schema_migrations and breaks 'db push'.");
    console.error("");
    console.error("This change is not the manifest-authorized reset:");
    for (const failure of resetFailures) {
      console.error(`  - ${failure}`);
    }
    console.error("");
    console.error("Fix: add a new migration that reverses or supersedes the change instead.");
    process.exit(1);
  }

  console.error("::error::New migration files violate the history rules.");
  for (const failure of backdates) console.error(`  - ${failure}`);
  console.error("");
  console.error("Fix: give every new migration a unique 14-digit timestamp that sorts");
  console.error("after the base's greatest version.");
  process.exit(1);
}

main();
