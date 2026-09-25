/** @typedef {import("../report.mjs").AmbientReport} AmbientReport */
/** @typedef {import("../report.mjs").SinkContext} SinkContext */

const TITLE = "Ambient synthetic failing on production";
const LABEL = "synthetic-prod";

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {boolean}
 */
export function isConfigured(env) {
  return Boolean(env?.GITHUB_TOKEN && env?.GITHUB_REPOSITORY);
}

async function api(env, method, path, body) {
  const headers = {
    authorization: `Bearer ${env.GITHUB_TOKEN}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "dividimos-ambient",
    ...(body ? { "content-type": "application/json" } : {}),
  };
  const res = await fetch("https://api.github.com" + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`github ${method} ${path}: ${res.status} ${await res.text()}`);
  }
  return res.status === 204 ? null : await res.json();
}

function formatBody(report) {
  const lines = [`Ambient run: ${report.runUrl}`, ""];
  for (const failure of report.failures ?? []) {
    lines.push(`- **${failure.name}**`);
    if (failure.message.includes("\n")) {
      lines.push("```");
      lines.push(failure.message);
      lines.push("```");
    } else {
      lines.push(`  ${failure.message}`);
    }
  }
  return lines.join("\n");
}

/**
 * Finds the reporter's own open issue. Matching the title in addition to
 * the label keeps a human's synthetic-prod issue from being adopted or
 * auto-closed: only issues this script titled are touched.
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<{ number: number } | null>}
 */
export async function findOpenIssue(env) {
  const issues = await api(
    env,
    "GET",
    `/repos/${env.GITHUB_REPOSITORY}/issues?labels=${LABEL}&state=open&per_page=5`,
  );
  if (!Array.isArray(issues)) {
    return null;
  }
  const match = issues.find(
    (issue) => !issue.pull_request && issue.title === TITLE,
  );
  return match ?? null;
}

/**
 * Delivers the report for the resolved transition: opens the issue on
 * went_red, comments on still_red, comments and closes on recovered, and
 * sends nothing on green.
 * @param {AmbientReport} report
 * @param {SinkContext} ctx
 * @returns {Promise<void>}
 */
export async function notify(report, ctx) {
  if (report.transition === "green") {
    return;
  }

  const repository = ctx.env.GITHUB_REPOSITORY;

  if (report.transition === "went_red") {
    await api(ctx.env, "POST", `/repos/${repository}/issues`, {
      title: TITLE,
      labels: [LABEL],
      body: formatBody(report),
    });
    return;
  }

  if (report.transition === "still_red") {
    if (!ctx.openIssue?.number) {
      throw new Error("Missing ctx.openIssue for still_red transition");
    }
    await api(ctx.env, "POST", `/repos/${repository}/issues/${ctx.openIssue.number}/comments`, {
      body: formatBody(report),
    });
    return;
  }

  if (report.transition === "recovered") {
    if (!ctx.openIssue?.number) {
      throw new Error("Missing ctx.openIssue for recovered transition");
    }
    const issueNumber = ctx.openIssue.number;
    await api(ctx.env, "POST", `/repos/${repository}/issues/${issueNumber}/comments`, {
      body: `Recovered: ${report.runUrl}`,
    });
    await api(ctx.env, "PATCH", `/repos/${repository}/issues/${issueNumber}`, {
      state: "closed",
      state_reason: "completed",
    });
    return;
  }

  throw new Error(`Unknown transition: ${report.transition}`);
}
