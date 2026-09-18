// Ambient run reporter. Adding a sink: create scripts/ambient/sinks/<name>.mjs
// exporting isConfigured(env) and notify(report, ctx), then append it to SINKS.
// Sinks only deliver; the exit code is the run's own status (red exits 1).
import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import * as githubIssue from "./sinks/github-issue.mjs";
import * as telegram from "./sinks/telegram.mjs";

/** @typedef {{ name: string, message: string }} AmbientFailure */
/** @typedef {{ path: string, failure: boolean }} AmbientScreenshot */
/** @typedef {{
 *   status: "green" | "red",
 *   transition: "green" | "went_red" | "still_red" | "recovered",
 *   failures: AmbientFailure[],
 *   diary: string[],
 *   screenshots: AmbientScreenshot[],
 *   video: string | null,
 *   runUrl: string,
 * }} AmbientReport */
/** @typedef {{ env: NodeJS.ProcessEnv, openIssue: { number: number } | null, fetch?: typeof fetch, now?: Date }} SinkContext */

const SINKS = [githubIssue, telegram];

// Probe errors echo configuration (Supabase URLs, anon keys, the Google
// client id). Every non-empty AMBIENT_* value is scrubbed from failure
// messages once here, so neither sink can publish one.
/**
 * Replaces every non-empty AMBIENT_* env value with *** so no sink can
 * publish configuration.
 * @param {string} text
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
export function scrub(text, env) {
  const secrets = Object.entries(env)
    .filter(([name, value]) => name.startsWith("AMBIENT_") && value)
    .map(([, value]) => value);
  return secrets.reduce((message, secret) => message.replaceAll(secret, "***"), text);
}

/**
 * @param {AmbientFailure[]} failures
 * @param {NodeJS.ProcessEnv} env
 * @returns {AmbientFailure[]}
 */
export function redactFailures(failures, env) {
  return failures.map((failure) => ({
    ...failure,
    message: scrub(failure.message, env),
  }));
}

/**
 * Reads ambient-results.json plus the step outcomes into failure entries.
 * Every entry returned turns the run red. Nothing throws: a missing file,
 * an unparseable file, and a suite that died without failing assertions all
 * become named entries.
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<AmbientFailure[]>}
 */
export async function collectFailures(env) {
  const failures = [];

  // Setup can fail before the probes start (checkout, npm ci): that is a
  // workflow problem, not a production outage, so it gets its own entry.
  const probesRan =
    env.VITEST_OUTCOME === "success" || env.VITEST_OUTCOME === "failure";
  if (!probesRan) {
    failures.push({
      name: "ambient run",
      message: "probes did not run; see the workflow run",
    });
  }

  // Entries derived from the results file, kept apart so the non-zero-exit
  // fallback below fires only when the file itself reported nothing.
  const fileFailures = [];
  let raw;
  let resultsRead = false;
  if (probesRan) {
    const resultsPath = resolve(process.cwd(), "ambient-results.json");
    try {
      raw = await readFile(resultsPath, "utf8");
      resultsRead = true;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        failures.push({ name: "vitest", message: "no results file" });
      } else {
        throw error;
      }
    }
  }

  if (raw !== undefined) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      fileFailures.push({
        name: "vitest",
        message: "results file is not valid JSON",
      });
    }
    if (parsed !== undefined) {
      const testResults = Array.isArray(parsed?.testResults) ? parsed.testResults : [];
      for (const testResult of testResults) {
        const fileName = basename(testResult?.name ?? "");
        const assertionResults = Array.isArray(testResult?.assertionResults)
          ? testResult.assertionResults
          : [];
        let failedAssertions = 0;
        for (const assertion of assertionResults) {
          if (assertion?.status === "failed") {
            failedAssertions++;
            const fullName = assertion.fullName ?? assertion.title ?? "";
            const failureMessages = Array.isArray(assertion.failureMessages)
              ? assertion.failureMessages
              : [];
            fileFailures.push({
              name: `${fileName} > ${fullName}`,
              message: (failureMessages[0] ?? "").trim().slice(0, 500),
            });
          }
        }
        // A suite can fail without any failing assertion: an unhandled
        // rejection, an import error, a timeout. The entry message names it.
        if (testResult?.status === "failed" && failedAssertions === 0) {
          fileFailures.push({
            name: fileName,
            message: String(testResult.message ?? "").trim().slice(0, 500),
          });
        }
      }
    }
  }

  // The fallback is only meaningful when a results file was actually
  // inspected and showed nothing: a missing file already has its own entry.
  if (
    env.VITEST_OUTCOME === "failure" &&
    resultsRead &&
    fileFailures.length === 0
  ) {
    fileFailures.push({
      name: "vitest",
      message: "vitest exited non-zero without a failing test; see run",
    });
  }
  failures.push(...fileFailures);

  if (env.WEB_OUTCOME === "failure") {
    failures.push({
      name: "web smoke",
      message: "Playwright ambient project failed; see run",
    });
  }

  return failures;
}

/**
 * @param {"green" | "red"} status
 * @param {{ number: number } | null} openIssue
 * @returns {"green" | "went_red" | "still_red" | "recovered"}
 */
export function resolveTransition(status, openIssue) {
  if (status === "red") {
    return openIssue ? "still_red" : "went_red";
  }
  return openIssue ? "recovered" : "green";
}

const DIARY_LINE_LIMIT = 8;
const DIARY_LINE_LENGTH = 120;

/**
 * Reads the facts the tests noted as they ran. Missing or unreadable file
 * means no diary, never an error: green runs without facts are fine.
 * @param {NodeJS.ProcessEnv} env
 * @returns {string[]}
 */
export function collectDiary(env) {
  let raw;
  try {
    raw = readFileSync("ambient-diary.txt", "utf8");
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => scrub(line.slice(0, DIARY_LINE_LENGTH), env))
    .slice(0, DIARY_LINE_LIMIT);
}

/**
 * Run screenshots come from ambient-shots (green ones, by name order),
 * failure screenshots from Playwright's test-results tree (recursive).
 * @returns {AmbientScreenshot[]}
 */
export async function collectScreenshots() {
  const shots = [];
  for (const [dir, failure] of [
    ["ambient-shots", false],
    ["test-results", true],
  ]) {
    const files = await listPngs(dir);
    shots.push(...files.map((path) => ({ path, failure })));
  }
  return shots;
}

async function listPngs(dir) {
  const root = resolve(dir);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true, recursive: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".png"))
    .map((entry) => join(entry.parentPath ?? dir, entry.name))
    .sort();
}

/**
 * The workflow encodes Playwright's recording of the phone walk into
 * ambient-video.mp4. Missing file means the smoke never got that far.
 * @returns {Promise<string | null>}
 */
export async function collectVideo() {
  try {
    await readFile("ambient-video.mp4");
    return "ambient-video.mp4";
  } catch {
    return null;
  }
}

/**
 * Collects failures, delivers them through every configured sink, and
 * returns the exit code. Isolation rules: a failing issue lookup falls back
 * to no open issue (the next red run opens a fresh one), a throwing sink is
 * logged while the remaining sinks still run, and the exit code derives
 * from the run status alone so delivery problems never mask a green run.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<number>} process exit code
 */
export async function main(env = process.env) {
  const failures = redactFailures(await collectFailures(env), env);
  const status = failures.length > 0 ? "red" : "green";

  let openIssue = null;
  if (githubIssue.isConfigured(env)) {
    try {
      openIssue = await githubIssue.findOpenIssue(env);
    } catch (error) {
      console.error(error);
    }
  }

  const transition = resolveTransition(status, openIssue);

  const report = {
    status,
    transition,
    failures,
    diary: collectDiary(env),
    screenshots: await collectScreenshots(),
    video: await collectVideo(),
    runUrl: `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
  };

  for (const sink of SINKS) {
    if (sink.isConfigured(env)) {
      try {
        await sink.notify(report, { env, openIssue });
      } catch (error) {
        console.error(error);
      }
    }
  }

  console.log(
    JSON.stringify({
      status,
      transition,
      failures: failures.length,
      diary: report.diary.length,
      screenshots: report.screenshots.length,
      video: report.video !== null,
    }),
  );

  return status === "red" ? 1 : 0;
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  process.exit(await main());
}
