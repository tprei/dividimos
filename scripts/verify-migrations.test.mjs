// Tests for scripts/verify-migrations.mjs: the pure logic and the CLI compare
// and epoch-guard modes. Nothing here starts containers or touches the
// network; the fresh, upgrade, and epoch database builds run only in CI
// against real Supabase projects.

import { strict as assert } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  compareApplicationCatalogs,
  compareEpochObservations,
  compareEpochResults,
  compareFixtureObservations,
  epochAuthorizationFailures,
  epochExtensionFailures,
  PIX_FIXTURE_CIPHERTEXT,
  postgresMajor,
  readMigrationFiles,
  readTrustedResetManifest,
  validateEpochEvidence,
  validateMigrationHistory,
  verifyMigrations,
} from "./verify-migrations.mjs";

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "verify-migrations.mjs",
);

let repoCounter = 0;

function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), `verify-migrations-test-${++repoCounter}-`));
  const run = (args, options = {}) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: "pipe", ...options });
  run(["init", "--quiet", "--initial-branch=main"]);
  run(["config", "user.email", "test@test.dividimos.local"]);
  run(["config", "user.name", "Test"]);
  return {
    dir,
    blobOf: (ref, path) => run(["rev-parse", `${ref}:${path}`]).trim(),
    commit(files, message) {
      for (const [path, content] of Object.entries(files)) {
        mkdirSync(join(dir, dirname(path)), { recursive: true });
        writeFileSync(join(dir, path), content);
      }
      run(["add", "-A"]);
      run(["commit", "--quiet", "--allow-empty", "-m", message ?? "fixture"]);
      return run(["rev-parse", "HEAD"]).trim();
    },
    commitIndex(message) {
      run(["commit", "--quiet", "-m", message]);
      return run(["rev-parse", "HEAD"]).trim();
    },
    run,
    dispose() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const M_A = "supabase/migrations/20260912000000_first_change.sql";
const M_B = "supabase/migrations/20260912100000_second_change.sql";
const M_C = "supabase/migrations/20260913000000_third_change.sql";
const OID_A = "a".repeat(40);
const OID_B = "b".repeat(40);
const OID_C = "c".repeat(40);

const RESET_MANIFEST = "supabase/migrations-reset-manifest.json";

function migrationFile(version, path, blobOid, mode = "100644") {
  return { version, path, blobOid, mode };
}

const BASE_FILES = [
  migrationFile("20260912000000", M_A, OID_A),
  migrationFile("20260912100000", M_B, OID_B),
];

function catalogEntry(kind, identity, definition) {
  return { kind, identity, definition };
}

test("readMigrationFiles lists blob migrations with versions, paths, and modes", async () => {
  const repo = initRepo();
  try {
    repo.commit({
      [M_A]: "select 1;\n",
      [M_B]: "select 2;\n",
      [M_C]: "select 3;\n",
      "supabase/config.toml": 'project_id = "fixture"\n',
    }, "base");
    const gitlinkOid = "0123456789abcdef0123456789abcdef01234567";
    repo.run([
      "update-index", "--add", "--cacheinfo",
      `160000,${gitlinkOid},supabase/migrations/20260913100000_submodule`,
    ]);
    const head = repo.commitIndex("submodule entry");

    const files = await readMigrationFiles(head, { cwd: repo.dir });
    assert.deepEqual(
      files.map((file) => file.version),
      ["20260912000000", "20260912100000", "20260913000000"],
    );
    assert.deepEqual(files.map((file) => file.path), [M_A, M_B, M_C]);
    assert.deepEqual(files.map((file) => file.mode), ["100644", "100644", "100644"]);
    assert.equal(files[0].blobOid, repo.blobOf(head, M_A));
    assert.equal(files[2].blobOid, repo.blobOf(head, M_C));
    assert.ok(files.every((file) => file.mode !== "160000"));
  } finally {
    repo.dispose();
  }
});

test("validateMigrationHistory accepts unchanged history plus later migrations", () => {
  const head = [...BASE_FILES, migrationFile("20260913000000", M_C, OID_C)];
  assert.deepEqual(validateMigrationHistory(BASE_FILES, head), []);
});

test("validateMigrationHistory rejects an edited base blob", () => {
  const head = [migrationFile("20260912000000", M_A, "d".repeat(40)), BASE_FILES[1]];
  const failures = validateMigrationHistory(BASE_FILES, head);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /20260912000000_first_change\.sql/);
});

test("validateMigrationHistory rejects a removed base migration", () => {
  const failures = validateMigrationHistory(BASE_FILES, [BASE_FILES[1]]);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /20260912000000_first_change\.sql/);
});

test("validateMigrationHistory rejects a mode change on a base migration", () => {
  const head = [migrationFile("20260912000000", M_A, OID_A, "100755"), BASE_FILES[1]];
  const failures = validateMigrationHistory(BASE_FILES, head);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /20260912000000_first_change\.sql/);
  assert.match(failures[0], /100755/);
});

test("validateMigrationHistory rejects duplicate head versions", () => {
  const head = [
    ...BASE_FILES,
    migrationFile("20260913100000", "supabase/migrations/20260913100000_alpha.sql", OID_C),
    migrationFile("20260913100000", "supabase/migrations/20260913100000_beta.sql", "d".repeat(40)),
  ];
  const failures = validateMigrationHistory(BASE_FILES, head);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /20260913100000/);
  assert.match(failures[0], /20260913100000_alpha\.sql/);
  assert.match(failures[0], /20260913100000_beta\.sql/);
});

test("validateMigrationHistory rejects a backdated head migration", () => {
  const head = [...BASE_FILES, migrationFile("20260911000000", "supabase/migrations/20260911000000_old.sql", OID_C)];
  const failures = validateMigrationHistory(BASE_FILES, head);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /20260911000000_old\.sql/);
});

test("validateMigrationHistory rejects a head filename outside the migration pattern", () => {
  const head = [...BASE_FILES, migrationFile("extra.sql", "supabase/migrations/extra.sql", OID_C)];
  const failures = validateMigrationHistory(BASE_FILES, head);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /extra\.sql/);
});

test("postgresMajor reads major_version from the ref's config.toml", async () => {
  const repo = initRepo();
  try {
    const withMajor = repo.commit({
      "supabase/config.toml": 'project_id = "fixture"\n[db]\nport = 54322\nmajor_version = 15\n',
    }, "config");
    assert.equal(await postgresMajor(withMajor, { cwd: repo.dir }), 15);
    const withoutMajor = repo.commit({
      "supabase/config.toml": 'project_id = "fixture"\n',
    }, "no major");
    assert.equal(await postgresMajor(withoutMajor, { cwd: repo.dir }), null);
  } finally {
    repo.dispose();
  }
});

test("postgresMajor returns null when the ref has no config.toml", async () => {
  const repo = initRepo();
  try {
    const ref = repo.commit({ "README.md": "# fixture\n" }, "empty");
    assert.equal(await postgresMajor(ref, { cwd: repo.dir }), null);
  } finally {
    repo.dispose();
  }
});

test("compareApplicationCatalogs accepts identical catalogs", () => {
  const entries = [
    catalogEntry("schema", "public", "public"),
    catalogEntry("function", "public.get_group(p_group_id uuid)", "CREATE FUNCTION public.get_group(p_group_id uuid)"),
  ];
  const expected = { postgresMajor: 15, entries };
  const actual = { postgresMajor: 15, entries: entries.map((entry) => ({ ...entry })) };
  assert.deepEqual(compareApplicationCatalogs(expected, actual), []);
});

test("compareApplicationCatalogs reports a changed function definition naming the identity", () => {
  const expected = {
    postgresMajor: 15,
    entries: [catalogEntry("function", "public.get_group(p_group_id uuid)", "definition v1")],
  };
  const actual = {
    postgresMajor: 15,
    entries: [catalogEntry("function", "public.get_group(p_group_id uuid)", "definition v2")],
  };
  const failures = compareApplicationCatalogs(expected, actual);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /public\.get_group\(p_group_id uuid\)/);
});

test("compareApplicationCatalogs reports a missing column entry", () => {
  const column = catalogEntry("column", "public.expenses.total_cents", "integer|NO|NULL");
  const failures = compareApplicationCatalogs(
    { postgresMajor: 15, entries: [column, catalogEntry("schema", "public", "public")] },
    { postgresMajor: 15, entries: [catalogEntry("schema", "public", "public")] },
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0], /column/);
  assert.match(failures[0], /public\.expenses\.total_cents/);
});

test("compareApplicationCatalogs reports an extra grant entry", () => {
  const grant = catalogEntry("grant", "public.expenses.anon.SELECT", "SELECT");
  const failures = compareApplicationCatalogs(
    { postgresMajor: 15, entries: [catalogEntry("schema", "public", "public")] },
    { postgresMajor: 15, entries: [catalogEntry("schema", "public", "public"), grant] },
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0], /grant/);
  assert.match(failures[0], /anon\.SELECT/);
});

test("compareApplicationCatalogs reports a postgres major mismatch", () => {
  const failures = compareApplicationCatalogs(
    { postgresMajor: 15, entries: [] },
    { postgresMajor: 16, entries: [] },
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0], /postgresMajor/);
  assert.match(failures[0], /15/);
  assert.match(failures[0], /16/);
});

test("compareFixtureObservations accepts equal observations", () => {
  const observations = [
    { label: "db:count:expenses", value: 2 },
    { label: "expense:main:version", value: 2 },
    { label: "group:main:members", value: ["user:alice|accepted", "user:bob|accepted"] },
  ];
  const actual = observations.map((observation) => ({ ...observation }));
  assert.deepEqual(compareFixtureObservations(observations, actual), []);
});

test("compareFixtureObservations reports a changed value with label and both JSON forms", () => {
  const failures = compareFixtureObservations(
    [{ label: "expense:main:version", value: 2 }],
    [{ label: "expense:main:version", value: 3 }],
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0], /expense:main:version/);
  assert.match(failures[0], /before=2/);
  assert.match(failures[0], /after=3/);
});

test("compareFixtureObservations treats list order as part of the fact", () => {
  const failures = compareFixtureObservations(
    [{ label: "conversation:alice:messages", value: ["1|user:alice|a", "2|user:bob|b"] }],
    [{ label: "conversation:alice:messages", value: ["1|user:bob|b", "2|user:alice|a"] }],
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0], /conversation:alice:messages/);
});

test("compareFixtureObservations reports a missing label", () => {
  const failures = compareFixtureObservations(
    [{ label: "vendor:visible", value: [] }],
    [],
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0], /vendor:visible/);
});

test("compareFixtureObservations reports an unexpected label", () => {
  const failures = compareFixtureObservations(
    [{ label: "vendor:visible", value: [] }],
    [{ label: "vendor:visible", value: [] }, { label: "surprise", value: 1 }],
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0], /surprise/);
});

test("compareFixtureObservations accepts the named lookup success-to-denial upgrade", () => {
  const failures = compareFixtureObservations(
    [
      { label: "lookup:direct:authenticated", value: "success" },
      { label: "db:count:expenses", value: 2 },
    ],
    [
      { label: "lookup:direct:authenticated", value: "denied" },
      { label: "db:count:expenses", value: 2 },
    ],
  );
  assert.deepEqual(failures, []);
});

test("compareFixtureObservations rejects when the lookup denial never lands", () => {
  const failures = compareFixtureObservations(
    [{ label: "lookup:direct:authenticated", value: "success" }],
    [{ label: "lookup:direct:authenticated", value: "success" }],
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0], /lookup:direct:authenticated/);
  assert.match(failures[0], /upgrade should be "denied"/);
});

test("compareFixtureObservations accepts a base that already carries the lookup denial", () => {
  const failures = compareFixtureObservations(
    [{ label: "lookup:direct:authenticated", value: "denied" }],
    [{ label: "lookup:direct:authenticated", value: "denied" }],
  );
  assert.deepEqual(failures, []);
});

test("compareFixtureObservations accepts a reviewed migration introducing an empty table", () => {
  const failures = compareFixtureObservations(
    [{ label: "db:count:public.groups", value: 3 }],
    [
      { label: "db:count:public.groups", value: 3 },
      { label: "db:count:public.group_member_exclusions", value: 0 },
    ],
  );
  assert.deepEqual(failures, []);
});

test("compareFixtureObservations accepts a reviewed migration retiring the participant copy", () => {
  const failures = compareFixtureObservations(
    [
      { label: "db:count:public.groups", value: 3 },
      { label: "db:count:public.expense_participants", value: 4 },
    ],
    [{ label: "db:count:public.groups", value: 3 }],
  );
  assert.deepEqual(failures, []);
});

test("compareFixtureObservations accepts the DM repair deleting exactly one membership row", () => {
  const failures = compareFixtureObservations(
    [
      { label: "db:count:public.group_members", value: 8 },
      { label: "dm:noncanonical-members", value: 1 },
    ],
    [
      { label: "db:count:public.group_members", value: 7 },
      { label: "dm:noncanonical-members", value: 0 },
    ],
  );
  assert.deepEqual(failures, []);
});

test("compareFixtureObservations accepts a stable count when the base already enforces the pair", () => {
  const failures = compareFixtureObservations(
    [{ label: "db:count:public.group_members", value: 7 }],
    [{ label: "db:count:public.group_members", value: 7 }],
  );
  assert.deepEqual(failures, []);
});

test("compareFixtureObservations rejects a membership count that drops by more than the repair deletes", () => {
  const failures = compareFixtureObservations(
    [{ label: "db:count:public.group_members", value: 8 }],
    [{ label: "db:count:public.group_members", value: 5 }],
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0], /repair should delete exactly 1 row/);
});

test("compareFixtureObservations accepts the noncanonical DM repair upgrade", () => {
  const failures = compareFixtureObservations(
    [
      { label: "dm:noncanonical-members", value: 1 },
      { label: "db:count:expenses", value: 2 },
    ],
    [
      { label: "dm:noncanonical-members", value: 0 },
      { label: "db:count:expenses", value: 2 },
    ],
  );
  assert.deepEqual(failures, []);
});

test("compareFixtureObservations rejects when noncanonical DM members remain after upgrade", () => {
  const failures = compareFixtureObservations(
    [{ label: "dm:noncanonical-members", value: 1 }],
    [{ label: "dm:noncanonical-members", value: 1 }],
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0], /dm:noncanonical-members/);
  assert.match(failures[0], /upgrade should be 0/);
});

test("compareFixtureObservations accepts a base that already has 0 noncanonical DM members", () => {
  const failures = compareFixtureObservations(
    [{ label: "dm:noncanonical-members", value: 0 }],
    [{ label: "dm:noncanonical-members", value: 0 }],
  );
  assert.deepEqual(failures, []);
});

test("the CLI compare mode exits 0 for identical catalogs", () => {
  const dir = mkdtempSync(join(tmpdir(), "verify-migrations-cli-"));
  try {
    const payload = {
      postgresMajor: 15,
      entries: [{ kind: "schema", identity: "public", definition: "public" }],
    };
    const expectedPath = join(dir, "expected.json");
    const actualPath = join(dir, "actual.json");
    writeFileSync(expectedPath, `${JSON.stringify(payload, null, 2)}\n`);
    writeFileSync(actualPath, `${JSON.stringify(payload, null, 2)}\n`);
    const result = spawnSync(
      process.execPath,
      [SCRIPT, "compare", "--expected", expectedPath, "--actual", actualPath],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /OK: catalogs identical/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validateEpochEvidence accepts valid token, ciphertext, and timestamp evidence", () => {
  const now = Date.parse("2026-09-13T12:00:00.000Z");
  const evidence = [
    { label: "invite", format: "invite-token", value: "A".repeat(32) },
    { label: "claim", format: "claim-token", value: `gst1_${"B".repeat(43)}` },
    { label: "pix", format: "pix-envelope", value: PIX_FIXTURE_CIPHERTEXT },
    { label: "created", format: "created-at", value: new Date(now - 1_000).toISOString() },
    {
      label: "expires",
      format: "expires-at",
      value: new Date(now + 7 * 24 * 60 * 60 * 1_000).toISOString(),
    },
  ];
  assert.deepEqual(validateEpochEvidence(evidence, now), []);
});

test("validateEpochEvidence rejects malformed or unsafe nondeterministic values", () => {
  const now = Date.parse("2026-09-13T12:00:00.000Z");
  const failures = validateEpochEvidence(
    [
      { label: "invite", format: "invite-token", value: "A".repeat(31) },
      { label: "claim", format: "claim-token", value: "gst1_A" },
      { label: "pix", format: "pix-envelope", value: "not-an-envelope" },
      {
        label: "created",
        format: "created-at",
        value: new Date(now - 60 * 60 * 1_000 - 1).toISOString(),
      },
      { label: "expires", format: "expires-at", value: new Date(now - 1).toISOString() },
    ],
    now,
  );
  assert.equal(failures.length, 5);
  for (const label of ["invite", "claim", "pix", "created", "expires"]) {
    assert.ok(failures.some((failure) => failure.startsWith(`${label}:`)));
  }
});

test("compareEpochObservations normalizes each side through its own identity map", () => {
  const baseAlice = "11111111-1111-4111-8111-111111111111";
  const baseGroup = "22222222-2222-4222-8222-222222222222";
  const headAlice = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const headGroup = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const base = {
    identities: { "user:alice": baseAlice, "group:main": baseGroup },
    observations: [
      {
        label: "ids",
        value: { actor: baseAlice, group: baseGroup, members: [baseAlice] },
      },
    ],
  };
  const head = {
    identities: { "user:alice": headAlice, "group:main": headGroup },
    observations: [
      {
        label: "ids",
        value: { actor: headAlice, group: headGroup, members: [headAlice] },
      },
    ],
  };
  assert.deepEqual(compareEpochObservations(base, head), []);
});

test("compareEpochObservations rejects an unmapped UUID instead of comparing randomness", () => {
  const failures = compareEpochObservations(
    {
      identities: {},
      observations: [{ label: "ids", value: "11111111-1111-4111-8111-111111111111" }],
    },
    {
      identities: {},
      observations: [{ label: "ids", value: "22222222-2222-4222-8222-222222222222" }],
    },
  );
  assert.equal(failures.length, 1);
  assert.ok(failures.every((failure) => /unmapped uuid/.test(failure)));
});

test("compareEpochResults requires evidence, normalized observations, and full catalog parity", () => {
  const now = Date.parse("2026-09-13T12:00:00.000Z");
  const side = (userId, groupId) => ({
    catalog: { postgresMajor: 15, entries: [] },
    identities: { "user:alice": userId, "group:main": groupId },
    observations: [{ label: "ids", value: { actor: userId, group: groupId } }],
    evidence: [
      { label: "invite:token", kind: "token", format: "invite-token", value: "A".repeat(32) },
      { label: "guest:claim:token", kind: "token", format: "claim-token", value: `gst1_${"B".repeat(43)}` },
      { label: "user:alice:pix", kind: "ciphertext", format: "pix-envelope", value: PIX_FIXTURE_CIPHERTEXT },
      { label: "group:main:created-at", kind: "timestamp", format: "created-at", value: new Date(now).toISOString() },
      { label: "guest:claim:expires-at", kind: "timestamp", format: "expires-at", value: new Date(now + 1_000).toISOString() },
    ],
  });
  const base = side("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222");
  const head = side("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  assert.deepEqual(compareEpochResults(base, head, { now }), []);

  const changed = {
    ...head,
    catalog: {
      ...head.catalog,
      entries: [{ kind: "schema", identity: "unexpected", definition: "unexpected" }],
    },
    evidence: [{ label: "pix", kind: "ciphertext", format: "pix-envelope", value: "bad" }],
  };
  const failures = compareEpochResults(base, changed, { now });
  assert.ok(failures.some((failure) => /head evidence: pix/.test(failure)));
  assert.ok(failures.some((failure) => /schema: extra unexpected/.test(failure)));
});

test("epochAuthorizationFailures accepts only exact manifest blob and mode bindings", () => {
  const oldFiles = [migrationFile("20260912000000", M_A, OID_A)];
  const newFiles = [migrationFile("20260914000000", M_C, OID_C)];
  const manifest = {
    old: { [M_A]: { blob: OID_A, mode: "100644" } },
    new: { [M_C]: { blob: OID_C, mode: "100644" } },
  };
  assert.deepEqual(epochAuthorizationFailures(manifest, oldFiles, newFiles), []);
  const failures = epochAuthorizationFailures(
    manifest,
    oldFiles,
    [migrationFile("20260914000000", M_C, OID_C, "100755")],
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0], /mode 100755/);
});

test("readTrustedResetManifest ignores a checkout manifest and reads the trusted ref", () => {
  const repo = initRepo();
  try {
    const base = repo.commit({ [M_A]: "select 1;\n" }, "base");
    const candidate = repo.commit({ [M_C]: "select 3;\n" }, "candidate");
    const expected = {
      old: { [M_A]: { blob: repo.blobOf(base, M_A), mode: "100644" } },
      new: { [M_C]: { blob: repo.blobOf(candidate, M_C), mode: "100644" } },
    };
    const trusted = repo.commit({ [RESET_MANIFEST]: `${JSON.stringify(expected)}\n` }, "trusted");
    repo.commit({
      [RESET_MANIFEST]: `${JSON.stringify({ old: {}, new: {} })}\n`,
    }, "head checkout");
    assert.deepEqual(readTrustedResetManifest(trusted, { cwd: repo.dir }), expected);
  } finally {
    repo.dispose();
  }
});

test("epochExtensionFailures reports the reset transition on a pre-reset base", async () => {
  const repo = initRepo();
  try {
    const base = repo.commit({ [M_A]: "select 1;\n" }, "pre-reset base");
    const head = repo.commit({ [M_C]: "select 3;\n" }, "new epoch");
    const trusted = repo.commit({
      [RESET_MANIFEST]: `${JSON.stringify({
        old: { [M_A]: { blob: repo.blobOf(base, M_A), mode: "100644" } },
        new: { [M_C]: { blob: repo.blobOf(head, M_C), mode: "100644" } },
      })}\n`,
    }, "trusted");
    assert.equal(
      await epochExtensionFailures({
        baseRef: base,
        headRef: head,
        trustedMainRef: trusted,
        cwd: repo.dir,
      }),
      null,
    );
  } finally {
    repo.dispose();
  }
});

test("epochExtensionFailures accepts an append-only PR stacked on the new epoch", async () => {
  const repo = initRepo();
  try {
    const base = repo.commit({ [M_A]: "select 1;\n" }, "pre-reset base");
    repo.run(["rm", "--quiet", M_A]);
    const epoch = repo.commit({ [M_C]: "select 3;\n" }, "new epoch");
    const trusted = repo.commit({
      [RESET_MANIFEST]: `${JSON.stringify({
        old: { [M_A]: { blob: repo.blobOf(base, M_A), mode: "100644" } },
        new: { [M_C]: { blob: repo.blobOf(epoch, M_C), mode: "100644" } },
      })}\n`,
    }, "trusted");
    const later = "supabase/migrations/20260914000000_fourth_change.sql";
    const extension = repo.commit({ [later]: "select 4;\n" }, "extends the epoch");
    assert.deepEqual(
      await epochExtensionFailures({
        baseRef: epoch,
        headRef: extension,
        trustedMainRef: trusted,
        cwd: repo.dir,
      }),
      [],
    );
  } finally {
    repo.dispose();
  }
});

test("epochExtensionFailures treats a base that grew past the manifest as post-reset", async () => {
  const repo = initRepo();
  try {
    const base = repo.commit({ [M_A]: "select 1;\n" }, "pre-reset base");
    repo.run(["rm", "--quiet", M_A]);
    const epoch = repo.commit({ [M_C]: "select 3;\n" }, "new epoch");
    const trusted = repo.commit({
      [RESET_MANIFEST]: `${JSON.stringify({
        old: { [M_A]: { blob: repo.blobOf(base, M_A), mode: "100644" } },
        new: { [M_C]: { blob: repo.blobOf(epoch, M_C), mode: "100644" } },
      })}\n`,
    }, "trusted");
    // main merged one migration after the reset; a later PR stacks on that.
    const grown = repo.commit(
      { "supabase/migrations/20260914000000_fourth_change.sql": "select 4;\n" },
      "main after the reset",
    );
    const extension = repo.commit(
      { "supabase/migrations/20260915000000_fifth_change.sql": "select 5;\n" },
      "extends grown main",
    );
    assert.deepEqual(
      await epochExtensionFailures({
        baseRef: grown,
        headRef: extension,
        trustedMainRef: trusted,
        cwd: repo.dir,
      }),
      [],
    );
  } finally {
    repo.dispose();
  }
});

test("verifyMigrations refuses epoch mode without a trusted-main manifest", async () => {
  const repo = initRepo();
  try {
    const base = repo.commit({
      [M_A]: "select 1;\n",
      "supabase/config.toml": 'project_id = "fixture"\n[db]\nmajor_version = 15\n',
    }, "base");
    const head = repo.commit({
      [M_B]: "select 2;\n",
      [RESET_MANIFEST]: `${JSON.stringify({ old: {}, new: {} })}\n`,
    }, "self-authorizing head");
    const artifacts = mkdtempSync(join(tmpdir(), "verify-migrations-epoch-artifacts-"));
    try {
      await assert.rejects(
        verifyMigrations({
          baseRef: base,
          headRef: head,
          trustedMainRef: base,
          mode: "epoch",
          artifactDirectory: artifacts,
          cwd: repo.dir,
        }),
        /trusted main carries no reviewed reset manifest/,
      );
    } finally {
      rmSync(artifacts, { recursive: true, force: true });
    }
  } finally {
    repo.dispose();
  }
});

test("the CLI compare mode exits 1 and names the differing identity", () => {
  const dir = mkdtempSync(join(tmpdir(), "verify-migrations-cli-"));
  try {
    const expectedPath = join(dir, "expected.json");
    const actualPath = join(dir, "actual.json");
    writeFileSync(expectedPath, `${JSON.stringify({
      postgresMajor: 15,
      entries: [{ kind: "function", identity: "public.get_group(p_group_id uuid)", definition: "v1" }],
    }, null, 2)}\n`);
    writeFileSync(actualPath, `${JSON.stringify({
      postgresMajor: 15,
      entries: [{ kind: "function", identity: "public.get_group(p_group_id uuid)", definition: "v2" }],
    }, null, 2)}\n`);
    const result = spawnSync(
      process.execPath,
      [SCRIPT, "compare", "--expected", expectedPath, "--actual", actualPath],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    const output = `${result.stdout}${result.stderr}`;
    assert.match(output, /public\.get_group\(p_group_id uuid\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the CLI compare mode exits 1 when the recorded server majors differ", () => {
  const dir = mkdtempSync(join(tmpdir(), "verify-migrations-cli-"));
  try {
    const entries = [{ kind: "schema", identity: "public", definition: "public" }];
    const expectedPath = join(dir, "expected.json");
    const actualPath = join(dir, "actual.json");
    writeFileSync(expectedPath, `${JSON.stringify({ postgresMajor: 15, entries }, null, 2)}\n`);
    writeFileSync(actualPath, `${JSON.stringify({ postgresMajor: 16, entries }, null, 2)}\n`);
    const result = spawnSync(
      process.execPath,
      [SCRIPT, "compare", "--expected", expectedPath, "--actual", actualPath],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    const output = `${result.stdout}${result.stderr}`;
    assert.match(output, /::error::postgresMajor: expected 15 actual 16/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("verifyMigrations rejects a broken migration history without starting containers", async () => {
  const repo = initRepo();
  try {
    const base = repo.commit({
      [M_A]: "select 1;\n",
      "supabase/config.toml": 'project_id = "fixture"\n[db]\nmajor_version = 15\n',
    }, "base");
    const head = repo.commit({ [M_A]: "select 99;\n" }, "edits an applied migration");
    const artifacts = mkdtempSync(join(tmpdir(), "verify-migrations-artifacts-"));
    try {
      await assert.rejects(
        verifyMigrations({
          baseRef: base,
          headRef: head,
          mode: "fresh",
          artifactDirectory: artifacts,
          cwd: repo.dir,
        }),
        /20260912000000_first_change\.sql/,
      );
    } finally {
      rmSync(artifacts, { recursive: true, force: true });
    }
  } finally {
    repo.dispose();
  }
});

test("verifyMigrations rejects a postgres major version change", async () => {
  const repo = initRepo();
  try {
    const base = repo.commit({
      [M_A]: "select 1;\n",
      "supabase/config.toml": 'project_id = "fixture"\n[db]\nmajor_version = 15\n',
    }, "base");
    const head = repo.commit({
      "supabase/config.toml": 'project_id = "fixture"\n[db]\nmajor_version = 16\n',
    }, "bumps major");
    const artifacts = mkdtempSync(join(tmpdir(), "verify-migrations-artifacts-"));
    try {
      await assert.rejects(
        verifyMigrations({
          baseRef: base,
          headRef: head,
          mode: "fresh",
          artifactDirectory: artifacts,
          cwd: repo.dir,
        }),
        /major version change needs its own tested toolchain PR/,
      );
    } finally {
      rmSync(artifacts, { recursive: true, force: true });
    }
  } finally {
    repo.dispose();
  }
});

test("verifyMigrations refuses to start without the pinned supabase CLI anywhere", () => {
  const dir = mkdtempSync(join(tmpdir(), "verify-migrations-cli-"));
  const pinned = JSON.parse(
    readFileSync(join(dirname(SCRIPT), "..", "package.json"), "utf8"),
  ).devDependencies.supabase;
  try {
    // Neither PATH nor <cwd>/node_modules/.bin carries the pinned CLI, so
    // the gate must fail closed before touching git or containers. The
    // wrong-version fixture proves the version assertion itself, so the
    // plain unit job (which installs no CLI at all) still exercises the
    // failure shape hermetically.
    const binDir = join(dir, "bin");
    mkdirSync(binDir, { recursive: true });
    const wrong = join(binDir, "supabase");
    writeFileSync(wrong, "#!/bin/sh\necho '1.2.3'\n");
    chmodSync(wrong, 0o755);

    const result = spawnSync(
      process.execPath,
      [
        SCRIPT,
        "fresh",
        "--base",
        "HEAD",
        "--head",
        "HEAD",
        "--artifacts",
        join(dir, "artifacts"),
      ],
      { cwd: dir, env: { ...process.env, PATH: binDir }, encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    const output = `${result.stdout}${result.stderr}`;
    assert.match(output, new RegExp(`::error::pinned supabase CLI ${pinned} required`));
    assert.match(output, /supabase on PATH printed 1\.2\.3/);
    assert.match(output, /checkout-local node_modules\/\.bin\/supabase is not runnable/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
