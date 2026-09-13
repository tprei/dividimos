#!/usr/bin/env node
// Rejects renamed or deleted files under supabase/migrations, with one
// narrowly-scoped exception for the approved legacy-to-fresh-baseline reset.
//
// Usage: node scripts/check-migration-history.mjs <base-sha> <head-sha>
//
// The exception is not authorized by PR number, branch name, label or
// environment flag. It is authorized only by the trees themselves: the base
// must be byte-identical to the pinned pre-rebuild migration set, and the head
// must contain exactly the generated baseline plus the real cutover script.
// Once the reset has landed, the base tree no longer matches the pinned legacy
// tree, so the exception cannot be invoked a second time.

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LEGACY_PIN_SHA = "31340be329a1c4ad5b76f72ac63f766e8d1efb05";
const BASELINE_PATH = "supabase/migrations/20260906000000_ledger_baseline.sql";
const SNAPSHOT_PATH = "supabase/schema.sql";
const CUTOVER_SCRIPT_PATH = "scripts/migrate-ledger.ts";
const MIGRATIONS_DIR = "supabase/migrations";

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

function migrationBlobMap(sha) {
  const out = gitText(["ls-tree", "-r", sha, "--", MIGRATIONS_DIR]);
  const map = new Map();
  for (const line of out.split("\n")) {
    if (line.length === 0) continue;
    const [meta, path] = line.split("\t");
    const parts = meta.split(/\s+/);
    if (parts[1] !== "blob") continue;
    map.set(path, parts[2]);
  }
  return map;
}

function pathExists(sha, path) {
  try {
    git(["cat-file", "-e", `${sha}:${path}`], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// Regenerates the current declarative schema snapshot from the head's own
// schemas and generator. The applied baseline is frozen and is no longer the
// generator's output.
function generatedBaseline(sha) {
  const work = mkdtempSync(join(tmpdir(), "migration-history-"));
  try {
    const archive = git(["archive", sha, "supabase/schemas", "scripts"]);
    execFileSync("tar", ["-x", "-C", work], { input: archive });
    mkdirSync(join(work, MIGRATIONS_DIR), { recursive: true });
    execFileSync("bash", [join(work, "scripts", "build-baseline.sh")], {
      stdio: "pipe",
    });
    return readFileSync(join(work, SNAPSHOT_PATH));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function resetTransitionFailures(baseSha, headSha) {
  const failures = [];

  // Every migration the remote database has already applied must still be
  // present and byte-identical in the base. Extra migrations that only ever
  // existed on this stack were never applied remotely, so squashing them away
  // cannot create a phantom version. After the reset lands the base no longer
  // carries the pinned files at all, so this cannot be replayed.
  const baseMap = migrationBlobMap(baseSha);
  const pinnedMap = migrationBlobMap(LEGACY_PIN_SHA);
  for (const [path, blob] of pinnedMap) {
    const found = baseMap.get(path);
    if (found === undefined) {
      failures.push(`the base is missing already-applied migration ${path}`);
    } else if (found !== blob) {
      failures.push(`already-applied migration ${path} was modified in the base`);
    }
  }

  // The pinned-tree comparison is the whole authorization, and it is checked
  // before anything from the head runs. After the reset landed no base can
  // match the pin again, so the steps below are unreachable and the head's
  // build script is never executed by this gate.
  if (failures.length > 0) return failures;

  const headMigrations = [...migrationBlobMap(headSha).keys()].sort();
  if (headMigrations.length !== 1 || headMigrations[0] !== BASELINE_PATH) {
    failures.push(
      `the head must contain exactly ${BASELINE_PATH}, found: ${headMigrations.join(", ") || "(none)"}`,
    );
  }

  if (!pathExists(headSha, CUTOVER_SCRIPT_PATH)) {
    failures.push(`the head is missing the cutover script ${CUTOVER_SCRIPT_PATH}`);
  }

  if (headMigrations.includes(BASELINE_PATH)) {
    const committed = git(["cat-file", "blob", `${headSha}:${BASELINE_PATH}`]);
    let generated;
    try {
      generated = generatedBaseline(headSha);
    } catch (error) {
      failures.push(`could not regenerate the schema snapshot from the head: ${error.message}`);
      return failures;
    }
    if (!committed.equals(generated)) {
      failures.push(
        `${BASELINE_PATH} is not byte-identical to the current schema snapshot generated from the head's supabase/schemas`,
      );
    }
  }

  return failures;
}

// Files the deployed database can never re-read, and files whose edits decide
// what the gates themselves do. An ordinary PR may not touch them.
const PROTECTED_CI_PATHS = [
  ".github/workflows/",
  "scripts/check-migration-history.mjs",
  "supabase/config.toml",
];

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

function main() {
  const args = process.argv.slice(2);
  const allowCiChanges = args.includes("--allow-ci-changes");
  const [baseSha, headSha] = args.filter((a) => !a.startsWith("--"));
  if (!baseSha || !headSha) {
    console.error(
      "usage: check-migration-history.mjs <base-sha> <head-sha> [--allow-ci-changes]",
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

  // Anything the deployed database has already applied is frozen: it records
  // migrations by filename and never re-reads one. Editing, deleting, renaming
  // or chmod-ing such a file ships drift that no environment will replay, and
  // adding a file whose name already exists on the base collides with the
  // applied version. New timestamps are unrestricted, including later edits to
  // them inside the same PR, because the base has never seen them.
  const appliedOnBase = migrationBlobMap(baseSha);
  const touched = changedPaths(mergeBase, headSha, [`${MIGRATIONS_DIR}/*.sql`]);
  const offenders = touched.filter((path) => appliedOnBase.has(path)).sort();

  if (offenders.length === 0) {
    console.log("OK: no already-applied migration was touched.");
    return;
  }

  const failures = resetTransitionFailures(baseSha, headSha);
  if (failures.length === 0) {
    console.log("OK: approved legacy-to-fresh-baseline reset.");
    console.log(offenders.join("\n"));
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
  console.error("This change does not qualify as the approved baseline reset:");
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  console.error("");
  console.error("Fix: add a new migration that reverses or supersedes the change instead.");
  process.exit(1);
}

main();
