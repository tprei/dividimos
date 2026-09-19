/** @typedef {import("./report.mjs").AmbientFailure} AmbientFailure */

// A failure message is a stack trace or a Playwright dump, and the alert has
// to be readable on a phone. Each rule turns a recognised shape into one
// plain sentence; anything unrecognised falls back to the first line, which
// is where these tools put the useful part.
const EXPLANATIONS = [
  [/strict mode violation/i, "two things on the page matched what the check looked for"],
  [/element\(s\) not found|toBeVisible|not visible/i, "a screen never showed what the walk waited for"],
  [/Timed out|timeout .*exceeded|exceeded timeout/i, "a step ran out of time"],
  [/diverged/i, "the ledger stopped matching the model it is checked against"],
  [/no cached session|invalid JWT|token is expired/i, "a bot could not sign in"],
  [/stale_version/i, "an edit lost a race and was refused, which is the rule working"],
  [/not_member|not_creator|denied|permission/i, "production refused the call as not allowed"],
  [/no results file/i, "the probes never wrote their results, so they died early"],
  [/did not run/i, "the probes never ran at all"],
  [/fetch failed|ECONNREFUSED|ENOTFOUND|socket hang up|502|503|504/i, "production did not answer"],
  [/outstanding_balance/i, "somebody still owes something, so the step was refused"],
];

/**
 * @param {AmbientFailure} failure
 * @returns {string} one sentence a person can read
 */
export function explainFailure(failure) {
  const message = (failure.message ?? "").trim();
  for (const [pattern, sentence] of EXPLANATIONS) {
    if (pattern.test(message)) return sentence;
  }
  const firstLine = message.split("\n").find((line) => line.trim().length > 0) ?? "";
  const plain = firstLine.replace(/^Error:\s*/i, "").trim();
  return plain.length > 0 ? plain : "no message came with this failure";
}
