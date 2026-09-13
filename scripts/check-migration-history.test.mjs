// Adversarial tests for scripts/check-migration-history.mjs.
//
// Each case builds a throwaway git repository with fixture commits and runs
// the checker exactly the way the trusted workflow does: as a subprocess with
// base and head revisions, from inside that repository. Run with:
//
//   node --test scripts/check-migration-history.test.mjs

import { strict as assert } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "check-migration-history.mjs",
);

let repoCounter = 0;

function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), `migration-history-test-${++repoCounter}-`));
  const run = (args, options = {}) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: "pipe", ...options });
  run(["init", "--quiet", "--initial-branch=main"]);
  run(["config", "user.email", "test@test.dividimos.local"]);
  run(["config", "user.name", "Test"]);
  return {
    dir,
    rev: (ref) => run(["rev-parse", ref]).trim(),
    blobOf: (ref, path) => run(["rev-parse", `${ref}:${path}`]).trim(),
    hashContent: (content) => run(["hash-object", "--stdin"], { input: content }).trim(),
    commit(files, message) {
      for (const [path, content] of Object.entries(files)) {
        mkdirSync(join(dir, dirname(path)), { recursive: true });
        writeFileSync(join(dir, path), content);
      }
      run(["add", "-A"]);
      run(["commit", "--quiet", "--allow-empty", "-m", message ?? "fixture"]);
      return run(["rev-parse", "HEAD"]).trim();
    },
    chmod(path, mode) {
      chmodSync(join(dir, path), mode);
      run(["add", "-A"]);
      run(["commit", "--quiet", "-m", `chmod ${path}`]);
      return run(["rev-parse", "HEAD"]).trim();
    },
    rm(paths) {
      for (const path of paths) run(["rm", "--quiet", path]);
      run(["commit", "--quiet", "-m", `remove ${paths.join(",")}`]);
      return run(["rev-parse", "HEAD"]).trim();
    },
    run(args) {
      return spawnSync(process.execPath, [SCRIPT, ...args], {
        cwd: dir,
        encoding: "utf8",
      });
    },
    dispose() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const M_A = "supabase/migrations/20260912000000_first_change.sql";
const M_B = "supabase/migrations/20260912100000_second_change.sql";
const SQL_A = "select 1;\n";
const SQL_B = "select 2;\n";

function baseRepo() {
  const repo = initRepo();
  const base = repo.commit(
    {
      [M_A]: SQL_A,
      [M_B]: SQL_B,
      "README.md": "# fixture\n",
    },
    "base",
  );
  return { repo, base };
}

function expectOk(repo, base, head, extra = []) {
  const result = repo.run([base, head, ...extra]);
  assert.equal(
    result.status,
    0,
    `expected success, got:\n${result.stdout}${result.stderr}`,
  );
  return result.stdout;
}

function expectFailure(repo, base, head, extra = []) {
  const result = repo.run([base, head, ...extra]);
  assert.notEqual(result.status, 0, "expected failure, got success");
  return result.stdout + result.stderr;
}

test("unchanged applied migrations pass", () => {
  const { repo, base } = baseRepo();
  const head = repo.commit({ "src/unrelated.ts": "export {};\n" }, "unrelated");
  expectOk(repo, base, head);
  repo.dispose();
});

test("new migration with a later timestamp passes", () => {
  const { repo, base } = baseRepo();
  const head = repo.commit(
    { "supabase/migrations/20260913010100_new_rule.sql": "select 3;\n" },
    "add migration",
  );
  const output = expectOk(repo, base, head);
  assert.match(output, /no already-applied migration was touched/);
  repo.dispose();
});

test("revising a new file inside its own PR passes", () => {
  const { repo, base } = baseRepo();
  repo.commit(
    { "supabase/migrations/20260913010200_draft.sql": "select 3;\n" },
    "add draft",
  );
  const head = repo.commit(
    { "supabase/migrations/20260913010200_draft.sql": "select 3; select 4;\n" },
    "revise draft before landing",
  );
  expectOk(repo, base, head);
  repo.dispose();
});

test("editing an applied migration fails", () => {
  const { repo, base } = baseRepo();
  const head = repo.commit({ [M_B]: "select 20;\n" }, "edit applied");
  const output = expectFailure(repo, base, head);
  assert.match(output, /must not be changed/);
  assert.match(output, new RegExp(M_B));
  repo.dispose();
});

test("deleting an applied migration fails", () => {
  const { repo, base } = baseRepo();
  const head = repo.rm([M_A]);
  const output = expectFailure(repo, base, head);
  assert.match(output, /must not be changed/);
  repo.dispose();
});

test("renaming an applied migration fails", () => {
  const { repo, base } = baseRepo();
  repo.commit(
    { "supabase/migrations/20260912100000_renamed.sql": SQL_B },
    "rename applied",
  );
  const head = repo.rm([M_B]);
  const output = expectFailure(repo, base, head);
  assert.match(output, /must not be changed/);
  assert.match(output, new RegExp(M_B));
  repo.dispose();
});

test("chmod-ing an applied migration fails", () => {
  const { repo, base } = baseRepo();
  const head = repo.chmod(M_A, 0o755);
  const output = expectFailure(repo, base, head);
  assert.match(output, /must not be changed/);
  repo.dispose();
});

test("two new files sharing one timestamp fail", () => {
  const { repo, base } = baseRepo();
  const head = repo.commit(
    {
      "supabase/migrations/20260914000000_alpha.sql": "select 3;\n",
      "supabase/migrations/20260914000000_beta.sql": "select 4;\n",
    },
    "duplicate timestamps",
  );
  const output = expectFailure(repo, base, head);
  assert.match(output, /version 20260914000000 is used by multiple files/);
  repo.dispose();
});

test("a new file duplicating an applied timestamp fails", () => {
  const { repo, base } = baseRepo();
  const head = repo.commit(
    { "supabase/migrations/20260912100000_other_name.sql": "select 3;\n" },
    "duplicate applied timestamp",
  );
  const output = expectFailure(repo, base, head);
  assert.match(output, /sorts at or before the base's greatest version/);
  repo.dispose();
});

test("a backdated addition fails", () => {
  const { repo, base } = baseRepo();
  const head = repo.commit(
    { "supabase/migrations/20260901000000_ancient.sql": "select 3;\n" },
    "backdated",
  );
  const output = expectFailure(repo, base, head);
  assert.match(output, /sorts at or before the base's greatest version/);
  repo.dispose();
});

test("a nonconforming new filename fails", () => {
  const { repo, base } = baseRepo();
  const head = repo.commit(
    { "supabase/migrations/hand_written.sql": "select 3;\n" },
    "nonconforming",
  );
  const output = expectFailure(repo, base, head);
  assert.match(output, /naming rule/);
  repo.dispose();
});

test("a filename that landed on the base after the PR started collides", () => {
  const repo = initRepo();
  const forkPoint = repo.commit(
    { [M_A]: SQL_A, "README.md": "# fixture\n" },
    "fork point",
  );
  const base = repo.commit(
    { "supabase/migrations/20260913020000_landed_on_base.sql": SQL_B },
    "base advances",
  );
  runIn(repo, ["checkout", "--quiet", "--detach", forkPoint]);
  const head = repo.commit(
    { "supabase/migrations/20260913020000_landed_on_base.sql": "select 99;\n" },
    "pr writes the same path",
  );
  const output = expectFailure(repo, base, head);
  assert.match(output, /must not be changed/);
  repo.dispose();
});

test("a head edit of the trusted checker fails without the CI label", () => {
  const { repo, base } = baseRepo();
  const head = repo.commit(
    { "scripts/check-migration-history.mjs": "// weakened\n" },
    "weaken the gate",
  );
  const output = expectFailure(repo, base, head);
  assert.match(output, /trusted-ci-change/);
  expectOk(repo, base, head, ["--allow-ci-changes"]);
  repo.dispose();
});

test("deleting applied migrations without a trusted manifest fails", () => {
  const { repo, base } = baseRepo();
  const head = repo.rm([M_A, M_B]);
  const output = expectFailure(repo, base, head);
  assert.match(output, /no --trusted-main commit was supplied|no reset can be authorized/);
  repo.dispose();
});

test("a manifest written by the PR head does not authorize a reset", () => {
  const repo = initRepo();
  const base = repo.commit({ [M_A]: SQL_A }, "base without manifest");
  const forgedBlob = repo.blobOf("HEAD", M_A);
  const NEW = "supabase/migrations/20260914000000_epoch.sql";
  repo.commit(
    {
      [NEW]: "select 7;\n",
      "supabase/migrations-reset-manifest.json": JSON.stringify({
        old: { [M_A]: { blob: forgedBlob, mode: "100644" } },
        new: { [NEW]: { blob: "0".repeat(40), mode: "100644" } },
      }),
    },
    "head forges its own authorization",
  );
  const head = repo.rm([M_A]);
  const output = expectFailure(repo, base, head);
  assert.match(output, /trusted-ci-change/);
  const bypassing = expectFailure(repo, base, head, ["--allow-ci-changes"]);
  assert.match(
    bypassing,
    /no --trusted-main commit was supplied, so no reset can be authorized/,
  );
  repo.dispose();
});

test("a manifest carried by an unmerged parent base does not authorize a reset", () => {
  const repo = initRepo();
  const base = repo.commit({ [M_A]: SQL_A }, "parent base");
  const blobA = repo.blobOf("HEAD", M_A);
  const NEW = "supabase/migrations/20260914000000_epoch.sql";
  const blobNew = repo.hashContent("select 7;\n");
  // The stacked parent (the PR base) carries a manifest, but trusted main is
  // the parent commit itself and has none: only trusted main authorizes.
  const parentWithManifest = repo.commit(
    {
      "supabase/migrations-reset-manifest.json": JSON.stringify({
        old: { [M_A]: { blob: blobA, mode: "100644" } },
        new: { [NEW]: { blob: blobNew, mode: "100644" } },
      }),
    },
    "unmerged parent smuggles a manifest",
  );
  repo.commit({ [NEW]: "select 7;\n" }, "epoch attempt");
  const head = repo.rm([M_A]);
  const output = expectFailure(repo, parentWithManifest, head, [
    "--trusted-main",
    base,
  ]);
  assert.match(output, /trusted main carries no reviewed reset manifest/);
  repo.dispose();
});

test("the exact trusted-main manifest transition passes", () => {
  const repo = initRepo();
  const base = repo.commit({ [M_A]: SQL_A, [M_B]: SQL_B }, "base");
  const blobA = repo.blobOf("HEAD", M_A);
  const blobB = repo.blobOf("HEAD", M_B);
  const NEW = "supabase/migrations/20260914000000_epoch.sql";
  const blobNew = repo.hashContent("select 7;\n");
  const trustedMain = repo.commit(
    {
      "supabase/migrations-reset-manifest.json": `${JSON.stringify(
        {
          old: {
            [M_A]: { blob: blobA, mode: "100644" },
            [M_B]: { blob: blobB, mode: "100644" },
          },
          new: { [NEW]: { blob: blobNew, mode: "100644" } },
        },
        null,
        2,
      )}\n`,
    },
    "maintainer lands the reviewed manifest on main",
  );
  runIn(repo, ["checkout", "--quiet", "--detach", base]);
  repo.commit({ [NEW]: "select 7;\n" }, "epoch replacement");
  const head = repo.rm([M_A, M_B]);
  const output = expectOk(repo, base, head, ["--trusted-main", trustedMain]);
  assert.match(output, /authorized by the reviewed trusted-main manifest/);
  repo.dispose();
});

test("a manifest whose old blobs drifted fails", () => {
  const repo = initRepo();
  const base = repo.commit({ [M_A]: SQL_A }, "base");
  const NEW = "supabase/migrations/20260914000000_epoch.sql";
  const blobNew = repo.hashContent("select 7;\n");
  const trustedMain = repo.commit(
    {
      "supabase/migrations-reset-manifest.json": `${JSON.stringify({
        old: { [M_A]: { blob: "0".repeat(40), mode: "100644" } },
        new: { [NEW]: { blob: blobNew, mode: "100644" } },
      })}\n`,
    },
    "manifest pins a stale blob",
  );
  runIn(repo, ["checkout", "--quiet", "--detach", base]);
  repo.commit({ [NEW]: "select 7;\n" }, "epoch attempt");
  const head = repo.rm([M_A]);
  const output = expectFailure(repo, base, head, ["--trusted-main", trustedMain]);
  assert.match(output, /does not match the manifest blob identity/);
  repo.dispose();
});

test("an extra head file beyond the manifest fails", () => {
  const repo = initRepo();
  const base = repo.commit({ [M_A]: SQL_A }, "base");
  const blobA = repo.blobOf("HEAD", M_A);
  const NEW = "supabase/migrations/20260914000000_epoch.sql";
  const EXTRA = "supabase/migrations/20260914000100_extra.sql";
  const blobNew = repo.hashContent("select 7;\n");
  const trustedMain = repo.commit(
    {
      "supabase/migrations-reset-manifest.json": `${JSON.stringify({
        old: { [M_A]: { blob: blobA, mode: "100644" } },
        new: { [NEW]: { blob: blobNew, mode: "100644" } },
      })}\n`,
    },
    "manifest authorizes exactly one new file",
  );
  runIn(repo, ["checkout", "--quiet", "--detach", base]);
  repo.commit(
    { [NEW]: "select 7;\n", [EXTRA]: "select 8;\n" },
    "epoch with smuggled extra",
  );
  const head = repo.rm([M_A]);
  const output = expectFailure(repo, base, head, ["--trusted-main", trustedMain]);
  assert.match(output, /does not authorize/);
  repo.dispose();
});

test("a head file with a non-regular mode fails even with a matching blob", () => {
  const repo = initRepo();
  const base = repo.commit({ [M_A]: SQL_A }, "base");
  const blobA = repo.blobOf("HEAD", M_A);
  const NEW = "supabase/migrations/20260914000000_epoch.sql";
  const blobNew = repo.hashContent("select 7;\n");
  const trustedMain = repo.commit(
    {
      "supabase/migrations-reset-manifest.json": `${JSON.stringify({
        old: { [M_A]: { blob: blobA, mode: "100644" } },
        new: { [NEW]: { blob: blobNew, mode: "100755" } },
      })}\n`,
    },
    "manifest requires an executable mode",
  );
  runIn(repo, ["checkout", "--quiet", "--detach", base]);
  repo.commit({ [NEW]: "select 7;\n" }, "epoch attempt");
  const head = repo.rm([M_A]);
  const output = expectFailure(repo, base, head, ["--trusted-main", trustedMain]);
  assert.match(output, /mode 100644, manifest requires 100755/);
  repo.dispose();
});

function runIn(repo, args) {
  execFileSync("git", args, { cwd: repo.dir, encoding: "utf8", stdio: "pipe" });
}
