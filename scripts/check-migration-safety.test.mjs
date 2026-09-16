import { strict as assert } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  stripLineComments,
  maskDollarQuoted,
  statements,
  checkMigration,
  formatFindings,
} from "./check-migration-safety.mjs";

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "check-migration-safety.mjs",
);

const BASE_VERSIONS = new Set(["20260912000000", "20260912100000"]);
const NEW_FILE = "supabase/migrations/20260914001800_pr_adds_report_note.sql";
const NEW_SQL_DROP = "DROP FUNCTION public.old_calc(uuid);\n";

function ruleFindings(findings, rule) {
  return findings.filter((finding) => finding.rule === rule);
}

let repoCounter = 0;

function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), `migration-safety-test-${++repoCounter}-`));
  const run = (args, options = {}) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: "pipe", ...options });
  run(["init", "--quiet", "--initial-branch=main"]);
  run(["config", "user.email", "test@test.dividimos.local"]);
  run(["config", "user.name", "Test"]);
  return {
    dir,
    commit(files, message) {
      for (const [path, content] of Object.entries(files)) {
        mkdirSync(join(dir, dirname(path)), { recursive: true });
        writeFileSync(join(dir, path), content);
      }
      run(["add", "-A"]);
      run(["commit", "--quiet", "--allow-empty", "-m", message ?? "fixture"]);
      return run(["rev-parse", "HEAD"]).trim();
    },
    writeUncommitted(path, content) {
      mkdirSync(join(dir, dirname(path)), { recursive: true });
      writeFileSync(join(dir, path), content);
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

function runIn(repo, args) {
  execFileSync("git", args, { cwd: repo.dir, encoding: "utf8", stdio: "pipe" });
}

const BASE_MIGRATION = "supabase/migrations/20260912000000_first_change.sql";

function baseRepo() {
  const repo = initRepo();
  const base = repo.commit({ [BASE_MIGRATION]: "SELECT 1;\n" }, "base");
  return { repo, base };
}

const FUNCTION_ONLY_SQL = `CREATE OR REPLACE FUNCTION public.pr_helper() RETURNS integer LANGUAGE sql AS $$
SELECT 1;
$$;
`;

test("UPDATE inside a function body is not a backfill", () => {
  const sql = `CREATE OR REPLACE FUNCTION public.recalc() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.group_balances SET amount = 0 WHERE group_id = '00000000-0000-0000-0000-000000000000';
END;
$$;
`;
  assert.deepEqual(checkMigration(NEW_FILE, sql, BASE_VERSIONS), []);
});

test("a violation after a 30-line dollar-quoted body reports its true line", () => {
  const body = Array.from(
    { length: 29 },
    (_, index) => `  RAISE NOTICE 'body line ${index + 1}';`,
  );
  body.push("  UPDATE public.group_balances SET amount = 0;");
  const sql = [
    "CREATE OR REPLACE FUNCTION public.recalc() RETURNS void LANGUAGE plpgsql AS $$",
    ...body,
    "$$;",
    "",
    "DROP FUNCTION public.old_recalc();",
    "",
  ].join("\n");
  const findings = checkMigration(NEW_FILE, sql, BASE_VERSIONS);
  const contract = ruleFindings(findings, "contract/drop-function-without-supersede");
  assert.equal(contract.length, 1);
  assert.equal(contract[0].file, NEW_FILE);
  assert.equal(contract[0].line, 34);
  assert.equal(ruleFindings(findings, "mix/backfill-with-ddl").length, 0);
});

test("nested dollar quotes with distinct tags mask correctly", () => {
  const sql = `CREATE OR REPLACE FUNCTION public.nested() RETURNS void LANGUAGE plpgsql AS $outer$
BEGIN
  RAISE NOTICE $inner$ DROP FUNCTION public.evil(); $inner$;
END;
$outer$;
`;
  const masked = maskDollarQuoted(sql);
  assert.equal(masked.includes("DROP FUNCTION"), false);
  assert.equal(masked.split("\n").length, sql.split("\n").length);
  assert.deepEqual(checkMigration(NEW_FILE, sql, BASE_VERSIONS), []);
});

test("an unterminated dollar quote is reported", () => {
  const sql =
    "CREATE OR REPLACE FUNCTION public.broken() RETURNS void LANGUAGE plpgsql AS $$\nSELECT 1;\n";
  const findings = checkMigration(NEW_FILE, sql, BASE_VERSIONS);
  const syntax = ruleFindings(findings, "syntax/unterminated-dollar-quote");
  assert.equal(syntax.length, 1);
  assert.equal(syntax[0].file, NEW_FILE);
  assert.equal(syntax[0].line, 1);
});

test("a hex-looking slug is rejected", () => {
  const file = "supabase/migrations/20260914001800_748_716a.sql";
  const findings = checkMigration(file, "SELECT 1;\n", BASE_VERSIONS);
  const naming = ruleFindings(findings, "naming/descriptive-slug");
  assert.equal(naming.length, 1);
  assert.equal(naming[0].file, file);
  assert.equal(naming[0].line, 1);
});

test("a descriptive slug is accepted", () => {
  const file = "supabase/migrations/20260914001800_version_occurrence_dates.sql";
  assert.deepEqual(checkMigration(file, "SELECT 1;\n", BASE_VERSIONS), []);
});

test("DROP FUNCTION with no supersede directive fails", () => {
  const findings = checkMigration(NEW_FILE, NEW_SQL_DROP, BASE_VERSIONS);
  const contract = ruleFindings(findings, "contract/drop-function-without-supersede");
  assert.equal(contract.length, 1);
  assert.equal(contract[0].file, NEW_FILE);
  assert.equal(contract[0].line, 1);
});

test("DROP FUNCTION with a directive naming a base-tree version passes", () => {
  const sql = `${NEW_SQL_DROP}-- supersedes: public.old_calc(uuid) introduced 20260912100000\n`;
  assert.deepEqual(checkMigration(NEW_FILE, sql, BASE_VERSIONS), []);
});

test("DROP FUNCTION with a directive naming a version absent from the base tree fails", () => {
  const sql = `${NEW_SQL_DROP}-- supersedes: public.old_calc(uuid) introduced 20260915999999\n`;
  const findings = checkMigration(NEW_FILE, sql, BASE_VERSIONS);
  const contract = ruleFindings(findings, "contract/drop-function-without-supersede");
  assert.equal(contract.length, 1);
  assert.equal(contract[0].file, NEW_FILE);
  assert.equal(contract[0].line, 1);
});

test("DROP FUNCTION with a directive naming a later version than the file fails", () => {
  const sql = `${NEW_SQL_DROP}-- supersedes: public.old_calc(uuid) introduced 20260914001900\n`;
  const versions = new Set([...BASE_VERSIONS, "20260914001900"]);
  const findings = checkMigration(NEW_FILE, sql, versions);
  const contract = ruleFindings(findings, "contract/drop-function-without-supersede");
  assert.equal(contract.length, 1);
  assert.equal(contract[0].file, NEW_FILE);
  assert.equal(contract[0].line, 1);
});

test("a backfill mixed with ALTER TABLE fails", () => {
  const sql =
    "ALTER TABLE public.report_lines ADD COLUMN note text; UPDATE public.report_lines SET note = 'migrated';\n";
  const findings = checkMigration(NEW_FILE, sql, BASE_VERSIONS);
  const mixed = ruleFindings(findings, "mix/backfill-with-ddl");
  assert.ok(mixed.length >= 1, "expected a mix/backfill-with-ddl finding");
  for (const finding of mixed) {
    assert.equal(finding.file, NEW_FILE);
    assert.equal(finding.line, 1);
  }
});

test("the same backfill alone in its own file passes", () => {
  const sql = "UPDATE public.report_lines SET note = 'migrated';\n";
  assert.deepEqual(checkMigration(NEW_FILE, sql, BASE_VERSIONS), []);
});

test("lock/missing-lock-timeout fires for a file containing ALTER TABLE", () => {
  const sql = "ALTER TABLE public.report_lines ADD COLUMN note text;\n";
  const findings = checkMigration(NEW_FILE, sql, BASE_VERSIONS);
  const locks = ruleFindings(findings, "lock/missing-lock-timeout");
  assert.equal(locks.length, 1);
  assert.equal(locks[0].file, NEW_FILE);
  assert.equal(locks[0].line, 1);
});

test("lock/missing-lock-timeout stays silent for a function-only file", () => {
  const findings = checkMigration(NEW_FILE, FUNCTION_ONLY_SQL, BASE_VERSIONS);
  assert.equal(ruleFindings(findings, "lock/missing-lock-timeout").length, 0);
});

test("a file added on the base branch after the PR started is never reported", () => {
  const repo = initRepo();
  try {
    const forkPoint = repo.commit({ [BASE_MIGRATION]: "SELECT 1;\n" }, "fork point");
    const base = repo.commit(
      {
        "supabase/migrations/20260913020000_landed_on_base.sql":
          "DROP FUNCTION public.evil();\n",
      },
      "base advances",
    );
    runIn(repo, ["checkout", "--quiet", "--detach", forkPoint]);
    const head = repo.commit(
      {
        "supabase/migrations/20260914001800_pr_adds_clean_helper.sql": FUNCTION_ONLY_SQL,
      },
      "pr adds a clean migration",
    );
    const result = repo.run([base, head]);
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 0, `expected success, got:\n${output}`);
    assert.match(output, /OK: 1 new migration\(s\) pass the safety rules\./);
    assert.equal(output.includes("landed_on_base"), false);
  } finally {
    repo.dispose();
  }
});

test("zero added migrations exits 0", () => {
  const { repo, base } = baseRepo();
  try {
    const head = repo.commit({ "README.md": "# fixture docs\n" }, "docs only");
    const result = repo.run([base, head]);
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 0, `expected success, got:\n${output}`);
    assert.match(output, /OK: 0 new migration\(s\) pass the safety rules\./);
  } finally {
    repo.dispose();
  }
});

test("a violating addition fails with one ::error:: line per finding", () => {
  const { repo, base } = baseRepo();
  try {
    const file = "supabase/migrations/20260914001800_bad_drop.sql";
    const head = repo.commit({ [file]: NEW_SQL_DROP }, "pr adds a bad drop");
    const result = repo.run([base, head]);
    assert.notEqual(result.status, 0, "expected failure, got success");
    const output = `${result.stdout}${result.stderr}`;
    assert.ok(
      output.includes(
        `::error::${file}:1 [contract/drop-function-without-supersede]`,
      ),
      `expected an ::error:: line, got:\n${output}`,
    );
  } finally {
    repo.dispose();
  }
});

test("--paths passes a clean file", () => {
  const { repo } = baseRepo();
  try {
    const file = "supabase/migrations/20260914001800_clean_helper.sql";
    repo.writeUncommitted(file, FUNCTION_ONLY_SQL);
    const result = repo.run(["--paths", file]);
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 0, `expected success, got:\n${output}`);
    assert.match(output, /OK: 1 new migration\(s\) pass the safety rules\./);
  } finally {
    repo.dispose();
  }
});

test("--paths fails a violating file", () => {
  const { repo } = baseRepo();
  try {
    const file = "supabase/migrations/20260914001800_bad_drop.sql";
    repo.writeUncommitted(file, NEW_SQL_DROP);
    const result = repo.run(["--paths", file]);
    assert.notEqual(result.status, 0, "expected failure, got success");
    const output = `${result.stdout}${result.stderr}`;
    assert.ok(
      output.includes(`::error::${file}:1 [contract/drop-function-without-supersede]`),
      `expected an ::error:: line, got:\n${output}`,
    );
  } finally {
    repo.dispose();
  }
});

test("formatFindings sorts by file, then line, then rule", () => {
  assert.deepEqual(
    formatFindings([
      { rule: "b-rule", file: "b.sql", line: 2, message: "second" },
      { rule: "c-rule", file: "a.sql", line: 5, message: "fifth" },
      { rule: "b-rule", file: "a.sql", line: 3, message: "third" },
      { rule: "a-rule", file: "a.sql", line: 3, message: "first" },
    ]),
    [
      "::error::a.sql:3 [a-rule] first",
      "::error::a.sql:3 [b-rule] third",
      "::error::a.sql:5 [c-rule] fifth",
      "::error::b.sql:2 [b-rule] second",
    ],
  );
});

test("stripLineComments removes trailing comments but keeps code", () => {
  const output = stripLineComments("SELECT 1; -- trailing comment\nSELECT 2;\n");
  assert.equal(output.includes("trailing comment"), false);
  assert.equal(output.includes("SELECT 2;"), true);
});

test("maskDollarQuoted preserves line numbers", () => {
  const sql = "SELECT $tag$masked\ncontent\n$tag$;\nSELECT 2;\n";
  const masked = maskDollarQuoted(sql);
  assert.equal(masked.includes("masked"), false);
  assert.equal(masked.split("\n").length, sql.split("\n").length);
});

test("statements splits on semicolons with 1-based start lines", () => {
  const parsed = statements("SELECT 1;\nSELECT 2;\n");
  assert.equal(parsed.length, 2);
  assert.deepEqual(
    parsed.map((statement) => statement.line),
    [1, 2],
  );
});

test("a $$ in a comment does not invert the mask", () => {
  const sql = [
    "-- Rewrites public.recalc. The body below is $$-quoted.",
    "CREATE OR REPLACE FUNCTION public.recalc() RETURNS void LANGUAGE plpgsql AS $$",
    "BEGIN",
    "  UPDATE public.group_balances SET amount = 0;",
    "  ALTER TABLE public.x ADD COLUMN y int;",
    "END;",
    "$$;",
    "",
  ].join("\n");
  assert.deepEqual(checkMigration(NEW_FILE, sql, BASE_VERSIONS), []);
});

test("two $$ in comments do not hide a destructive column change", () => {
  const sql = [
    "-- we used to use $$ quoting here",
    "ALTER TABLE public.users DROP COLUMN email;",
    "-- and $$ again down here",
    "",
  ].join("\n");
  const findings = checkMigration(NEW_FILE, sql, BASE_VERSIONS);
  assert.equal(ruleFindings(findings, "ddl/destructive-column").length, 1);
  assert.equal(ruleFindings(findings, "ddl/destructive-column")[0].line, 2);
});

test("-- inside a string literal does not hide the next statement", () => {
  const sql =
    "INSERT INTO public.audit(note) VALUES ('a -- b'); DROP FUNCTION public.old_calc(uuid);\n";
  const findings = checkMigration(NEW_FILE, sql, BASE_VERSIONS);
  assert.equal(
    ruleFindings(findings, "contract/drop-function-without-supersede").length,
    1,
  );
});

test("a supersede directive inside a function body authorizes nothing", () => {
  const sql = [
    "CREATE OR REPLACE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $$",
    "BEGIN",
    "  -- supersedes: public.old_calc(uuid) introduced 20260912000000",
    "  RETURN;",
    "END;",
    "$$;",
    "",
    "DROP FUNCTION public.old_calc(uuid);",
    "",
  ].join("\n");
  const findings = checkMigration(NEW_FILE, sql, BASE_VERSIONS);
  assert.equal(
    ruleFindings(findings, "contract/drop-function-without-supersede").length,
    1,
  );
});

test("a directive authorizes only the object it names", () => {
  const sql = [
    "-- supersedes: public.old_calc(uuid) introduced 20260912000000",
    "SET lock_timeout = '5s';",
    "DROP FUNCTION public.old_calc(uuid);",
    "DROP FUNCTION public.other_calc(uuid);",
    "",
  ].join("\n");
  const findings = ruleFindings(
    checkMigration(NEW_FILE, sql, BASE_VERSIONS),
    "contract/drop-function-without-supersede",
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 4);
});

test("a stale directive alongside a valid one still authorizes", () => {
  const sql = [
    "-- supersedes: public.old_calc(uuid) introduced 20259999000000",
    "-- supersedes: public.old_calc(uuid) introduced 20260912000000",
    "SET lock_timeout = '5s';",
    "DROP FUNCTION public.old_calc(uuid);",
    "",
  ].join("\n");
  assert.deepEqual(checkMigration(NEW_FILE, sql, BASE_VERSIONS), []);
});

test("an empty directive signature authorizes nothing", () => {
  const sql = [
    "-- supersedes:   introduced 20260912000000",
    "SET lock_timeout = '5s';",
    "DROP FUNCTION public.old_calc(uuid);",
    "",
  ].join("\n");
  assert.equal(
    ruleFindings(
      checkMigration(NEW_FILE, sql, BASE_VERSIONS),
      "contract/drop-function-without-supersede",
    ).length,
    1,
  );
});

test("a DO block body is live DDL, not a masked definition", () => {
  const sql = "DO $$ BEGIN DROP FUNCTION public.old_calc(uuid); END $$;\n";
  assert.equal(
    ruleFindings(
      checkMigration(NEW_FILE, sql, BASE_VERSIONS),
      "contract/drop-function-without-supersede",
    ).length,
    1,
  );
});

test("table DDL inside a DO block is seen by every anchored rule", () => {
  const sql = [
    "DO $$",
    "BEGIN",
    "  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attname = 'flag') THEN",
    "    ALTER TABLE public.groups ADD COLUMN flag boolean DEFAULT random();",
    "    UPDATE public.groups SET flag = false;",
    "  END IF;",
    "END",
    "$$;",
    "",
  ].join("\n");
  const findings = checkMigration(NEW_FILE, sql, BASE_VERSIONS);
  assert.deepEqual(
    findings.map((finding) => [finding.rule, finding.line]).sort(),
    [
      ["ddl/volatile-default", 4],
      ["lock/missing-lock-timeout", 4],
      ["mix/backfill-with-ddl", 5],
    ],
  );
});

test("DROP COLUMN IF EXISTS names the column, not IF", () => {
  const sql = [
    "-- supersedes: public.report_lines.note introduced 20260912000000",
    "SET lock_timeout = '5s';",
    "ALTER TABLE public.report_lines DROP COLUMN IF EXISTS note;",
    "",
  ].join("\n");
  assert.deepEqual(checkMigration(NEW_FILE, sql, BASE_VERSIONS), []);
});

test("RENAME COLUMN needs a supersede directive", () => {
  const sql = [
    "SET lock_timeout = '5s';",
    "ALTER TABLE public.users RENAME COLUMN email TO email_address;",
    "",
  ].join("\n");
  assert.equal(
    ruleFindings(
      checkMigration(NEW_FILE, sql, BASE_VERSIONS),
      "ddl/destructive-column",
    ).length,
    1,
  );
});

test("metadata-only ALTER COLUMN clauses are not destructive", () => {
  for (const clause of [
    "ALTER COLUMN note DROP DEFAULT",
    "ALTER COLUMN note DROP NOT NULL",
    "DROP CONSTRAINT report_lines_note_check",
  ]) {
    const sql = `SET lock_timeout = '5s';\nALTER TABLE public.report_lines ${clause};\n`;
    assert.deepEqual(
      checkMigration(NEW_FILE, sql, BASE_VERSIONS),
      [],
      `expected no findings for ${clause}`,
    );
  }
});

test("every accepted lock_timeout spelling satisfies the preamble", () => {
  for (const preamble of [
    "SET lock_timeout = '5s';",
    "SET lock_timeout TO '5s';",
    "SET lock_timeout = '5000';",
    "SET statement_timeout = '30s';\nSET lock_timeout = '5s';",
  ]) {
    const sql = `${preamble}\nALTER TABLE public.report_lines ADD COLUMN note text;\n`;
    assert.deepEqual(
      checkMigration(NEW_FILE, sql, BASE_VERSIONS),
      [],
      `expected no findings for ${preamble}`,
    );
  }
});

test("table DDL without a lock_timeout preamble is reported", () => {
  const sql = "ALTER TABLE public.report_lines ADD COLUMN note text;\n";
  assert.equal(
    ruleFindings(
      checkMigration(NEW_FILE, sql, BASE_VERSIONS),
      "lock/missing-lock-timeout",
    ).length,
    1,
  );
});

test("a concurrent index on an existing table still needs the preamble", () => {
  const sql =
    "CREATE INDEX CONCURRENTLY report_lines_note_idx ON public.report_lines (note);\n";
  assert.equal(
    ruleFindings(
      checkMigration(NEW_FILE, sql, BASE_VERSIONS),
      "lock/missing-lock-timeout",
    ).length,
    1,
  );
});

test("volatile defaults on ADD COLUMN are reported", () => {
  for (const expression of [
    "now()",
    "CURRENT_TIMESTAMP",
    "gen_random_uuid()",
    "uuid_generate_v4()",
    "now ()",
  ]) {
    const sql = `SET lock_timeout = '5s';\nALTER TABLE public.report_lines ADD COLUMN seen_at timestamptz DEFAULT ${expression};\n`;
    assert.equal(
      ruleFindings(
        checkMigration(NEW_FILE, sql, BASE_VERSIONS),
        "ddl/volatile-default",
      ).length,
      1,
      `expected a finding for DEFAULT ${expression}`,
    );
  }
});

test("a constant default on ADD COLUMN is allowed", () => {
  const sql =
    "SET lock_timeout = '5s';\nALTER TABLE public.report_lines ADD COLUMN note text DEFAULT '';\n";
  assert.deepEqual(checkMigration(NEW_FILE, sql, BASE_VERSIONS), []);
});

test("a CHECK constraint must be added NOT VALID", () => {
  const sql =
    "SET lock_timeout = '5s';\nALTER TABLE public.report_lines ADD CONSTRAINT report_lines_note_check CHECK (note <> '');\n";
  assert.equal(
    ruleFindings(
      checkMigration(NEW_FILE, sql, BASE_VERSIONS),
      "ddl/constraint-not-valid",
    ).length,
    1,
  );
});

test("SET NOT NULL is allowed behind a validated NOT VALID check on the same column", () => {
  const sql = [
    "SET lock_timeout = '5s';",
    "ALTER TABLE public.report_lines ADD CONSTRAINT report_lines_note_present CHECK (note IS NOT NULL) NOT VALID;",
    "ALTER TABLE public.report_lines VALIDATE CONSTRAINT report_lines_note_present;",
    "ALTER TABLE public.report_lines ALTER COLUMN note SET NOT NULL;",
    "",
  ].join("\n");
  assert.deepEqual(
    ruleFindings(
      checkMigration(NEW_FILE, sql, BASE_VERSIONS),
      "ddl/set-not-null-scan",
    ),
    [],
  );
});

test("a validated constraint on another table does not cover SET NOT NULL", () => {
  const sql = [
    "SET lock_timeout = '5s';",
    "ALTER TABLE public.unrelated VALIDATE CONSTRAINT zzz_note_zzz;",
    "ALTER TABLE public.report_lines ALTER COLUMN note SET NOT NULL;",
    "",
  ].join("\n");
  assert.equal(
    ruleFindings(
      checkMigration(NEW_FILE, sql, BASE_VERSIONS),
      "ddl/set-not-null-scan",
    ).length,
    1,
  );
});

test("SET NOT NULL on a table created in the same file is allowed", () => {
  const sql = [
    "CREATE TABLE public.new_thing (id bigint, note text);",
    "ALTER TABLE public.new_thing ALTER COLUMN note SET NOT NULL;",
    "",
  ].join("\n");
  assert.deepEqual(checkMigration(NEW_FILE, sql, BASE_VERSIONS), []);
});

test("an unqualified backfill beside DDL is still a backfill", () => {
  const sql = [
    "SET lock_timeout = '5s';",
    "ALTER TABLE report_lines ADD COLUMN note text;",
    "UPDATE report_lines SET note = 'migrated';",
    "",
  ].join("\n");
  const findings = ruleFindings(
    checkMigration(NEW_FILE, sql, BASE_VERSIONS),
    "mix/backfill-with-ddl",
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 3);
});

test("MERGE beside DDL is a backfill", () => {
  const sql = [
    "SET lock_timeout = '5s';",
    "ALTER TABLE public.report_lines ADD COLUMN note text;",
    "MERGE INTO public.report_lines t USING public.source s ON t.id = s.id WHEN MATCHED THEN UPDATE SET note = s.note;",
    "",
  ].join("\n");
  assert.equal(
    ruleFindings(
      checkMigration(NEW_FILE, sql, BASE_VERSIONS),
      "mix/backfill-with-ddl",
    ).length,
    1,
  );
});

test("the reviewed epoch migrations report nothing", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const listed = execFileSync(
    "git",
    ["ls-tree", "-r", "--name-only", "HEAD", "--", "supabase/migrations"],
    { cwd: root, encoding: "utf8" },
  )
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".sql"));
  assert.ok(listed.length > 0, "expected committed migrations to check");

  const versions = new Set(
    listed.map((path) => path.match(/(\d{14})_/)?.[1]).filter(Boolean),
  );
  for (const path of listed) {
    const sql = execFileSync("git", ["show", `HEAD:${path}`], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    assert.deepEqual(
      checkMigration(path, sql, versions),
      [],
      `expected no findings for the reviewed migration ${path}`,
    );
  }
});

test("--paths refuses to run alongside base and head revisions", () => {
  const repo = initRepo();
  try {
    repo.commit({ "supabase/migrations/20260912000000_landed.sql": "SELECT 1;\n" });
    const result = repo.run(["HEAD", "HEAD", "--paths"]);
    assert.equal(result.status, 2);
  } finally {
    repo.dispose();
  }
});

test("an unreadable path exits 2 with an error annotation", () => {
  const repo = initRepo();
  try {
    repo.commit({ "supabase/migrations/20260912000000_landed.sql": "SELECT 1;\n" });
    const result = repo.run(["--paths", "supabase/migrations/absent.sql"]);
    assert.equal(result.status, 2);
    assert.match(`${result.stdout}${result.stderr}`, /^::error::/m);
  } finally {
    repo.dispose();
  }
});
