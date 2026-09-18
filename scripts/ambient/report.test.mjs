// Tests for scripts/ambient/report.mjs: failure collection from the vitest
// results file, transition resolution, secret redaction, and the exit code
// contract. Nothing here touches the network; sink delivery is exercised
// only by the real workflow in CI.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { collectFailures, main, redactFailures, resolveTransition } from "./report.mjs";

// collectFailures reads ambient-results.json from process.cwd(), so every
// test runs inside a throwaway directory that is restored afterwards.
function inTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "ambient-report-test-"));
  const previousCwd = process.cwd();
  process.chdir(dir);
  return {
    writeResults(content) {
      writeFileSync(join(dir, "ambient-results.json"), content);
    },
    dispose() {
      process.chdir(previousCwd);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("collectFailures reports a missing results file once", async () => {
  const temp = inTempDir();
  try {
    const failures = await collectFailures({ VITEST_OUTCOME: "failure" });
    assert.deepEqual(failures, [
      { name: "vitest", message: "no results file" },
    ]);
  } finally {
    temp.dispose();
  }
});

test("collectFailures reports a skipped run without claiming an outage", async () => {
  const temp = inTempDir();
  try {
    assert.deepEqual(await collectFailures({ VITEST_OUTCOME: "skipped" }), [
      { name: "ambient run", message: "probes did not run; see the workflow run" },
    ]);
    assert.deepEqual(await collectFailures({}), [
      { name: "ambient run", message: "probes did not run; see the workflow run" },
    ]);
    // A skipped probe run does not hide an independent web smoke failure.
    assert.deepEqual(
      await collectFailures({ VITEST_OUTCOME: "", WEB_OUTCOME: "failure" }),
      [
        { name: "ambient run", message: "probes did not run; see the workflow run" },
        { name: "web smoke", message: "Playwright ambient project failed; see run" },
      ],
    );
  } finally {
    temp.dispose();
  }
});

test("collectFailures reports assertion failures with file and test names", async () => {
  const temp = inTempDir();
  try {
    temp.writeResults(
      JSON.stringify({
        testResults: [
          {
            name: "/home/runner/repo/src/lib/ledger.test.ts",
            status: "failed",
            assertionResults: [
              {
                status: "passed",
                fullName: "keeps balances signed",
                failureMessages: [],
              },
              {
                status: "failed",
                fullName: "settles every participant exactly",
                failureMessages: ["Error: expected 100 to be 99"],
              },
            ],
          },
          {
            name: "/home/runner/repo/src/lib/other.test.ts",
            status: "passed",
            assertionResults: [],
          },
        ],
      }),
    );
    const failures = await collectFailures({ VITEST_OUTCOME: "failure" });
    assert.deepEqual(failures, [
      {
        name: "ledger.test.ts > settles every participant exactly",
        message: "Error: expected 100 to be 99",
      },
    ]);
  } finally {
    temp.dispose();
  }
});

test("collectFailures reports a suite that failed without failing assertions", async () => {
  const temp = inTempDir();
  try {
    temp.writeResults(
      JSON.stringify({
        testResults: [
          {
            name: "/home/runner/repo/ambient/troupe.ambient.test.ts",
            status: "failed",
            message: "Unhandled rejection: boom\n    at some/stack.js:1:1",
            assertionResults: [],
          },
        ],
      }),
    );
    const failures = await collectFailures({ VITEST_OUTCOME: "failure" });
    assert.deepEqual(failures, [
      {
        name: "troupe.ambient.test.ts",
        // trim() only strips the edges; the stack below the first line is
        // kept and the issue sink renders multi-line messages in a block.
        message: "Unhandled rejection: boom\n    at some/stack.js:1:1",
      },
    ]);
  } finally {
    temp.dispose();
  }
});

test("collectFailures reports an unparseable results file", async () => {
  const temp = inTempDir();
  try {
    temp.writeResults("{not json");
    const failures = await collectFailures({ VITEST_OUTCOME: "failure" });
    assert.deepEqual(failures, [
      { name: "vitest", message: "results file is not valid JSON" },
    ]);
  } finally {
    temp.dispose();
  }
});

test("collectFailures falls back when vitest exited non-zero without failures", async () => {
  const temp = inTempDir();
  try {
    temp.writeResults(
      JSON.stringify({
        testResults: [
          {
            name: "/home/runner/repo/ambient/probes.ambient.test.ts",
            status: "passed",
            assertionResults: [],
          },
        ],
      }),
    );
    const failures = await collectFailures({ VITEST_OUTCOME: "failure" });
    assert.deepEqual(failures, [
      { name: "vitest", message: "vitest exited non-zero without a failing test; see run" },
    ]);
  } finally {
    temp.dispose();
  }
});

test("resolveTransition covers the four transitions", () => {
  const issue = { number: 979 };
  assert.equal(resolveTransition("red", null), "went_red");
  assert.equal(resolveTransition("red", issue), "still_red");
  assert.equal(resolveTransition("green", issue), "recovered");
  assert.equal(resolveTransition("green", null), "green");
});

test("redactFailures scrubs AMBIENT_* values from messages only", () => {
  const failures = [
    {
      name: "troupe.ambient.test.ts > fails on the configured base url",
      message: "fetch https://secret.example/api failed with key eyJhbGci",
    },
  ];
  const redacted = redactFailures(failures, {
    AMBIENT_BASE_URL: "https://secret.example",
    AMBIENT_SUPABASE_ANON_KEY: "eyJhbGci",
    UNRELATED_TOKEN: "https://secret.example",
  });
  assert.deepEqual(redacted, [
    {
      name: "troupe.ambient.test.ts > fails on the configured base url",
      message: "fetch ***/api failed with key ***",
    },
  ]);
  // The collected failures themselves stay unredacted for the exit status
  // logic, and empty AMBIENT_* values replace nothing.
  assert.equal(failures[0].message, "fetch https://secret.example/api failed with key eyJhbGci");
  assert.deepEqual(redactFailures(failures, { AMBIENT_EMPTY: "" }), failures);
});

test("main returns the exit code from the run status alone", async () => {
  const temp = inTempDir();
  try {
    // No sinks are configured without tokens, so main never touches the
    // network; a skipped probe run is still red.
    assert.equal(await main({}), 1);
    temp.writeResults(
      JSON.stringify({
        testResults: [
          {
            name: "/home/runner/repo/ambient/probes.ambient.test.ts",
            status: "passed",
            assertionResults: [],
          },
        ],
      }),
    );
    assert.equal(await main({ VITEST_OUTCOME: "success" }), 0);
  } finally {
    temp.dispose();
  }
});
