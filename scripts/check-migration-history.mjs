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

function main() {
  const [baseSha, headSha] = process.argv.slice(2);
  if (!baseSha || !headSha) {
    console.error("usage: check-migration-history.mjs <base-sha> <head-sha>");
    process.exit(2);
  }

  const changes = gitText([
    "diff",
    "--name-status",
    "--diff-filter=RD",
    `${baseSha}...${headSha}`,
    "--",
    `${MIGRATIONS_DIR}/*.sql`,
  ]).trim();

  if (changes.length === 0) {
    console.log("OK: no migrations renamed or deleted.");
    return;
  }

  const failures = resetTransitionFailures(baseSha, headSha);
  if (failures.length === 0) {
    console.log("OK: approved legacy-to-fresh-baseline reset.");
    console.log(changes);
    return;
  }

  console.error("::error::Existing migration files must not be renamed or deleted.");
  console.error(changes);
  console.error("");
  console.error("Why: the remote DB records each migration by its filename timestamp.");
  console.error("Renaming or deleting after pushing creates phantom versions in");
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
