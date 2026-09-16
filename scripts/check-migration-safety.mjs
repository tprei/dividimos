#!/usr/bin/env node
// Statically checks newly added database migrations before the replay gates
// spend forty minutes on Postgres.
//
// Usage:
//   node scripts/check-migration-safety.mjs <base-sha> <head-sha>
//   node scripts/check-migration-safety.mjs --paths <file.sql> [<file.sql>...]
//
// Only files ADDED relative to the base tree are checked: everything already
// in that tree is frozen by scripts/check-migration-history.mjs and must never
// be reported here.
//
// Findings print as `::error::<file>:<line> [<rule>] <message>` and exit 1.
// A tooling failure (bad ref, unreadable file) exits 2, so a broken invocation
// is never mistaken for a clean run.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** @typedef {{ rule: string, file: string, line: number, message: string }} Finding */
/** @typedef {{ text: string, line: number }} Statement */
/** @typedef {{ text: string, line: number }} Comment */
/** @typedef {{ code: string, comments: Comment[], unterminatedDollarQuote: { tag: string, line: number } | null }} Lexed */

const MIGRATIONS_DIR = "supabase/migrations";
const DOLLAR_TAG = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;
const BASE_VERSION = /^supabase\/migrations\/(\d{14})_/;

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

function blank(text) {
  return text.replace(/[^\n\r]/g, " ");
}

/**
 * Splits a migration into executable code and the regions that only look like
 * code. Comments, string literals and dollar-quoted bodies are blanked in the
 * `code` result with newlines preserved, so every reported line number is the
 * line the reader sees.
 *
 * A single pass is required rather than two passes in either order: masking
 * dollar quotes first misreads a `--` inside a string, and stripping comments
 * first misreads a `$$` inside a string.
 *
 * A `DO` block is executed at apply time, so its body stays code.
 *
 * @param {string} sql
 * @returns {Lexed}
 */
function lex(sql) {
  let code = "";
  // Same text with string literals intact, for the rules that read a value
  // (`SET lock_timeout = '5s'`) rather than scanning for keywords.
  let literals = "";
  /** @type {Comment[]} */
  const comments = [];
  /** @type {{ tag: string, line: number } | null} */
  let unterminatedDollarQuote = null;
  let statementStart = 0;

  const lineOf = (index) => 1 + (sql.slice(0, index).match(/\n/g) ?? []).length;
  const emit = (forCode, forLiterals) => {
    code += forCode;
    literals += forLiterals;
  };

  for (let i = 0; i < sql.length; ) {
    const rest = sql.slice(i);

    if (rest.startsWith("--") || rest.startsWith("/*")) {
      const end = consumeNonCode(sql, i);
      const text = sql.slice(i, end);
      comments.push({ text, line: lineOf(i) });
      emit(blank(text), blank(text));
      i = end;
      continue;
    }

    if (rest.startsWith("'")) {
      const end = consumeNonCode(sql, i);
      const text = sql.slice(i, end);
      emit(blank(text), text);
      i = end;
      continue;
    }

    const tagMatch = rest.match(DOLLAR_TAG);
    if (tagMatch) {
      const tag = tagMatch[0];
      const bodyStart = i + tag.length;
      const closeIndex = sql.indexOf(tag, bodyStart);
      if (closeIndex === -1) {
        unterminatedDollarQuote = { tag, line: lineOf(i) };
        emit(tag + blank(sql.slice(bodyStart)), tag + blank(sql.slice(bodyStart)));
        i = sql.length;
        continue;
      }
      const body = sql.slice(bodyStart, closeIndex);
      // A DO block runs at apply time, so its body is live DDL, not a stored
      // definition. Its statements must stand alone for the anchored rules,
      // so every block opener that precedes a statement becomes a separator.
      const executesImmediately = /(^|;)\s*DO\s*$/i.test(
        code.slice(statementStart),
      );
      const kept = executesImmediately ? exposeBlockBody(body) : blank(body);
      emit(tag + kept + tag, tag + kept + tag);
      i = closeIndex + tag.length;
      continue;
    }

    if (sql[i] === ";") {
      emit(";", ";");
      statementStart = code.length;
      i += 1;
      continue;
    }

    emit(sql[i], sql[i]);
    i += 1;
  }

  return { code, literals, comments, unterminatedDollarQuote };
}

function exposeBlockBody(body) {
  return body.replace(/\b(BEGIN|THEN|ELSE|LOOP)\b/gi, ";");
}

/**
 * Blanks dollar-quoted bodies, leaving the delimiters in place. String and
 * comment aware, so a `$$` inside either is not a delimiter.
 *
 * @param {string} sql
 * @returns {string}
 */
export function maskDollarQuoted(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i);
    const tagMatch = rest.match(DOLLAR_TAG);
    if (tagMatch) {
      const tag = tagMatch[0];
      const bodyStart = i + tag.length;
      const closeIndex = sql.indexOf(tag, bodyStart);
      if (closeIndex === -1) {
        out += tag + blank(sql.slice(bodyStart));
        return out;
      }
      out += tag + blank(sql.slice(bodyStart, closeIndex)) + tag;
      i = closeIndex + tag.length;
      continue;
    }
    if (rest.startsWith("--") || rest.startsWith("/*") || rest.startsWith("'")) {
      const consumed = consumeNonCode(sql, i);
      out += sql.slice(i, consumed);
      i = consumed;
      continue;
    }
    out += sql[i];
    i += 1;
  }
  return out;
}

function consumeNonCode(sql, i) {
  if (sql.startsWith("--", i)) {
    const nl = sql.slice(i).search(/[\n\r]/);
    return nl === -1 ? sql.length : i + nl;
  }
  if (sql.startsWith("/*", i)) {
    let depth = 1;
    let j = i + 2;
    while (j < sql.length && depth > 0) {
      if (sql.startsWith("/*", j)) {
        depth += 1;
        j += 2;
      } else if (sql.startsWith("*/", j)) {
        depth -= 1;
        j += 2;
      } else {
        j += 1;
      }
    }
    return j;
  }
  let j = i + 1;
  while (j < sql.length) {
    if (sql[j] === "'" && sql[j + 1] === "'") {
      j += 2;
      continue;
    }
    if (sql[j] === "'") return j + 1;
    j += 1;
  }
  return sql.length;
}

/**
 * Blanks `--` and `/* *​/` comments, preserving newlines. String and
 * dollar-quote aware.
 *
 * @param {string} sql
 * @returns {string}
 */
export function stripLineComments(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i);
    if (rest.startsWith("--") || rest.startsWith("/*")) {
      const end = consumeNonCode(sql, i);
      out += blank(sql.slice(i, end));
      i = end;
      continue;
    }
    if (rest.startsWith("'")) {
      const end = consumeNonCode(sql, i);
      out += sql.slice(i, end);
      i = end;
      continue;
    }
    const tagMatch = rest.match(DOLLAR_TAG);
    if (tagMatch) {
      const tag = tagMatch[0];
      const closeIndex = sql.indexOf(tag, i + tag.length);
      const end = closeIndex === -1 ? sql.length : closeIndex + tag.length;
      out += sql.slice(i, end);
      i = end;
      continue;
    }
    out += sql[i];
    i += 1;
  }
  return out;
}

/**
 * Splits already-lexed code on `;` and records the 1-based line each statement
 * starts on.
 *
 * @param {string} sql
 * @returns {Statement[]}
 */
export function statements(sql) {
  /** @type {Statement[]} */
  const result = [];
  let start = -1;
  let startLine = 1;
  let line = 1;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    if (char === ";") {
      if (start !== -1) {
        const text = sql.slice(start, i).trim();
        if (text.length > 0) result.push({ text, line: startLine });
        start = -1;
      }
    } else if (start === -1 && !/\s/.test(char)) {
      start = i;
      startLine = line;
    }
    if (char === "\n") line += 1;
  }

  if (start !== -1) {
    const text = sql.slice(start).trim();
    if (text.length > 0) result.push({ text, line: startLine });
  }

  return result;
}

/**
 * @param {Finding[]} findings
 * @returns {string[]}
 */
export function formatFindings(findings) {
  return [...findings]
    .sort(
      (a, b) =>
        a.file.localeCompare(b.file) ||
        a.line - b.line ||
        a.rule.localeCompare(b.rule),
    )
    .map((f) => `::error::${f.file}:${f.line} [${f.rule}] ${f.message}`);
}

function normalize(name) {
  return name.replace(/["'\s]/g, "").toLowerCase();
}

function shortName(name) {
  return name.includes(".") ? name.split(".").pop() : name;
}

/**
 * Reads supersede directives from comments only, so a directive inside a
 * function body, a string literal or a block comment authorizes nothing.
 *
 * @param {Comment[]} comments
 * @returns {{ object: string, introduced: string, line: number }[]}
 */
function supersedeDirectives(comments) {
  const directives = [];
  for (const comment of comments) {
    if (!comment.text.startsWith("--")) continue;
    const match = comment.text.match(
      /^--\s*supersedes:\s*([A-Za-z_][A-Za-z0-9_."]*)\s*(\([^)]*\))?\s+introduced\s+(\d{14})\s*$/,
    );
    if (match === null) continue;
    directives.push({
      object: normalize(match[1]),
      introduced: match[3],
      line: comment.line,
    });
  }
  return directives;
}

const VOLATILE_DEFAULT =
  /\b(now|clock_timestamp|statement_timestamp|localtimestamp|random|gen_random_uuid|uuid_generate_v\d|nextval)\s*\(|\b(current_timestamp|current_date|current_time|localtimestamp)\b/i;

const CREATE_INDEX =
  /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?:[a-z0-9_"]+\s+)?ON\s+(?:ONLY\s+)?([a-z0-9_."]+)/i;

const LOCK_TIMEOUT =
  /^SET\s+(?:LOCAL\s+)?lock_timeout\s*(?:=|TO)\s*'?\d+\s*(?:ms|s)?'?$/i;

/**
 * @param {string} file path as git reports it
 * @param {string} sql file contents
 * @param {Set<string>} baseVersions 14-digit versions already applied on base
 * @returns {Finding[]}
 */
export function checkMigration(file, sql, baseVersions) {
  /** @type {Finding[]} */
  const findings = [];
  const basename = file.split("/").pop() ?? file;

  const nameMatch = basename.match(/^(\d{14})_(.+)\.sql$/);
  if (nameMatch === null) {
    findings.push({
      rule: "naming/descriptive-slug",
      file,
      line: 1,
      message: `filename ${basename} is not <14-digit-version>_<descriptive_slug>.sql`,
    });
  } else {
    const words = nameMatch[2].split("_");
    const numeric = words.find((word) => /^\d+$/.test(word));
    if (numeric !== undefined) {
      findings.push({
        rule: "naming/descriptive-slug",
        file,
        line: 1,
        message: `slug word ${numeric} is a bare number; name what the migration does`,
      });
    } else if (!/^\d{14}_[a-z][a-z0-9]*(_[a-z0-9]+)+\.sql$/.test(basename)) {
      findings.push({
        rule: "naming/descriptive-slug",
        file,
        line: 1,
        message: `slug ${nameMatch[2]} needs at least two lowercase words`,
      });
    }
  }

  const fileVersion = nameMatch === null ? null : nameMatch[1];
  const { code, literals, comments, unterminatedDollarQuote } = lex(sql);

  if (unterminatedDollarQuote !== null) {
    findings.push({
      rule: "syntax/unterminated-dollar-quote",
      file,
      line: unterminatedDollarQuote.line,
      message: `dollar quote ${unterminatedDollarQuote.tag} is never closed`,
    });
  }

  const directives = supersedeDirectives(comments);
  const stmts = statements(code);

  const createdTables = new Set();
  for (const statement of stmts) {
    const matches = statement.text.matchAll(
      /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z0-9_."]+)/gi,
    );
    for (const match of matches) {
      const name = normalize(match[1]);
      createdTables.add(name);
      createdTables.add(shortName(name));
    }
  }

  const createdInFile = (table) =>
    table !== null &&
    (createdTables.has(table) || createdTables.has(shortName(table)));

  /**
   * A destructive operation needs a directive that names the same object and
   * points at a migration already applied on base, so the replacement is live
   * before the old contract disappears. Installed Capacitor clients cannot be
   * force-updated.
   */
  function requireSupersede(line, rule, object, label) {
    const named = directives.filter(
      (d) => d.object === object || shortName(d.object) === shortName(object),
    );
    if (named.length === 0) {
      findings.push({
        rule,
        file,
        line,
        message: `${label} needs a '-- supersedes: ${object} introduced <version>' comment naming the migration that landed the replacement`,
      });
      return;
    }
    const authorized = named.some(
      (d) =>
        baseVersions.has(d.introduced) &&
        fileVersion !== null &&
        d.introduced < fileVersion,
    );
    if (!authorized) {
      const versions = named.map((d) => d.introduced).join(", ");
      findings.push({
        rule,
        file,
        line,
        message: `${label} cites version ${versions}, which is not an earlier migration already applied on base`,
      });
    }
  }

  const withLiterals = statements(literals);
  const leadingSets = withLiterals.findIndex((s) => !/^SET\s/i.test(s.text));
  const lockTimeoutSet = withLiterals
    .slice(0, leadingSets === -1 ? withLiterals.length : leadingSets)
    .some((s) => LOCK_TIMEOUT.test(s.text));

  const notValidConstraints = new Map();
  const validatedConstraints = new Set();

  const hasTableDdl = stmts.some((s) =>
    /^(CREATE\s+TABLE|ALTER\s+TABLE)\b/i.test(s.text),
  );
  if (hasTableDdl) {
    for (const statement of stmts) {
      const isBackfill =
        /^(UPDATE|DELETE\s+FROM|MERGE\s+INTO)\b/i.test(statement.text) ||
        /^INSERT\s+INTO\b[\s\S]*\bSELECT\b/i.test(statement.text) ||
        /^WITH\b[\s\S]*\b(UPDATE|DELETE\s+FROM|INSERT\s+INTO)\b/i.test(
          statement.text,
        );
      if (isBackfill) {
        findings.push({
          rule: "mix/backfill-with-ddl",
          file,
          line: statement.line,
          message:
            "DDL and backfill in one migration; split the backfill into its own re-runnable migration",
        });
      }
    }
  }

  for (const statement of stmts) {
    const text = statement.text;
    const alterTable = text.match(/^ALTER\s+TABLE\s+(?:ONLY\s+)?([a-z0-9_."]+)/i);
    const table = alterTable === null ? null : normalize(alterTable[1]);

    const notValidMatch = text.match(
      /\bADD\s+CONSTRAINT\s+([a-z0-9_"]+)([\s\S]*?)\bNOT\s+VALID\b/i,
    );
    if (notValidMatch !== null && table !== null) {
      notValidConstraints.set(`${table}.${normalize(notValidMatch[1])}`, {
        body: notValidMatch[2],
      });
    }

    const validateMatch = text.match(/\bVALIDATE\s+CONSTRAINT\s+([a-z0-9_"]+)/i);
    if (validateMatch !== null && table !== null) {
      validatedConstraints.add(`${table}.${normalize(validateMatch[1])}`);
    }

    if (/\bDROP\s+FUNCTION\b/i.test(text)) {
      const target = text.match(
        /\bDROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?([a-z0-9_."]+)/i,
      );
      requireSupersede(
        statement.line,
        "contract/drop-function-without-supersede",
        target === null ? "" : normalize(target[1]),
        "DROP FUNCTION",
      );
    }

    const dropTable = text.match(/^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z0-9_."]+)/i);
    if (dropTable !== null) {
      requireSupersede(
        statement.line,
        "ddl/destructive-column",
        normalize(dropTable[1]),
        "DROP TABLE",
      );
    }

    if (table !== null) {
      const dropColumn = text.match(
        /\bDROP\s+(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?(?!DEFAULT\b|NOT\b|CONSTRAINT\b|EXPRESSION\b|IDENTITY\b)([a-z0-9_"]+)/i,
      );
      const retype = text.match(
        /\bALTER\s+(?:COLUMN\s+)?([a-z0-9_"]+)\s+(?:SET\s+DATA\s+)?TYPE\b/i,
      );
      const renameColumn = text.match(
        /\bRENAME\s+(?:COLUMN\s+)?([a-z0-9_"]+)\s+TO\b/i,
      );
      const renameTable = /\bRENAME\s+TO\b/i.test(text) && renameColumn === null;

      const destructive = dropColumn ?? retype ?? renameColumn;
      if (destructive !== null) {
        requireSupersede(
          statement.line,
          "ddl/destructive-column",
          `${table}.${normalize(destructive[1])}`,
          "destructive column change",
        );
      } else if (renameTable) {
        requireSupersede(
          statement.line,
          "ddl/destructive-column",
          table,
          "table rename",
        );
      }

      const addColumnDefault = text.match(
        /\bADD\s+(?:COLUMN\s+)?[a-z0-9_"]+[\s\S]*?\bDEFAULT\s+([\s\S]+)$/i,
      );
      if (addColumnDefault !== null && VOLATILE_DEFAULT.test(addColumnDefault[1])) {
        findings.push({
          rule: "ddl/volatile-default",
          file,
          line: statement.line,
          message:
            "volatile default on ADD COLUMN rewrites the table; add the column nullable, backfill separately, then set the default",
        });
      }

      if (
        /\bADD\s+CONSTRAINT\b/i.test(text) &&
        /\b(CHECK|FOREIGN\s+KEY)\b/i.test(text) &&
        !/\bNOT\s+VALID\b/i.test(text) &&
        !createdInFile(table)
      ) {
        findings.push({
          rule: "ddl/constraint-not-valid",
          file,
          line: statement.line,
          message:
            "CHECK or FOREIGN KEY constraint scans the table under a write lock; add it NOT VALID and VALIDATE it afterwards",
        });
      }

      const setNotNull = text.match(
        /\bALTER\s+(?:COLUMN\s+)?([a-z0-9_"]+)\s+SET\s+NOT\s+NULL\b/i,
      );
      if (setNotNull !== null && !createdInFile(table)) {
        const column = normalize(setNotNull[1]);
        const covered = [...validatedConstraints].some((key) => {
          if (!key.startsWith(`${table}.`)) return false;
          const declared = notValidConstraints.get(key);
          return (
            declared !== undefined &&
            new RegExp(`\\b${column}\\b`, "i").test(declared.body)
          );
        });
        if (!covered) {
          findings.push({
            rule: "ddl/set-not-null-scan",
            file,
            line: statement.line,
            message: `SET NOT NULL on ${table}.${column} scans the table under a write lock; add a NOT VALID check constraint on that column, VALIDATE it, then set NOT NULL`,
          });
        }
      }
    }

    if (!lockTimeoutSet) {
      const indexMatch = text.match(CREATE_INDEX);
      const touchesExistingTable =
        (dropTable !== null && true) ||
        (indexMatch !== null && !createdInFile(normalize(indexMatch[1]))) ||
        (table !== null &&
          !createdInFile(table) &&
          !/^ALTER\s+TABLE\s+[a-z0-9_."]+\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY$/i.test(
            text,
          ));
      if (touchesExistingTable) {
        findings.push({
          rule: "lock/missing-lock-timeout",
          file,
          line: statement.line,
          message:
            "table DDL without a lock_timeout preamble queues behind a long read and blocks every writer; make SET lock_timeout the first statement",
        });
      }
    }
  }

  return findings;
}

function versionsOf(paths) {
  const versions = new Set();
  for (const path of paths) {
    const match = path.match(BASE_VERSION);
    if (match !== null) versions.add(match[1]);
  }
  return versions;
}

function listTree(ref) {
  try {
    return gitText(["ls-tree", "-r", "--name-only", ref, "--", MIGRATIONS_DIR])
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function report(findings, checkedCount) {
  if (findings.length === 0) {
    console.log(`OK: ${checkedCount} new migration(s) pass the safety rules.`);
    return 0;
  }
  for (const line of formatFindings(findings)) console.error(line);
  console.error(
    `${findings.length} safety finding(s) in ${new Set(findings.map((f) => f.file)).size} migration(s).`,
  );
  return 1;
}

function runPaths(args) {
  const paths = args.filter((arg) => arg !== "--paths");
  // Naming a path is the request to check it, so the local form checks every
  // path given. Versions the author is checking never count as already
  // applied, otherwise a directive could cite its own file.
  const committed = listTree("HEAD").filter((path) => !paths.includes(path));
  const baseVersions = versionsOf(committed);

  /** @type {Finding[]} */
  const findings = [];
  for (const path of paths) {
    findings.push(
      ...checkMigration(path, readFileSync(path, "utf8"), baseVersions),
    );
  }
  return report(findings, paths.length);
}

function runRange(baseSha, headSha) {
  const mergeBase = gitText(["merge-base", baseSha, headSha]).trim();
  const added = gitText([
    "diff",
    "--name-only",
    "--diff-filter=A",
    mergeBase,
    headSha,
    "--",
    MIGRATIONS_DIR,
  ])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".sql"));

  const baseTree = listTree(baseSha);
  const frozen = new Set(baseTree);
  const baseVersions = versionsOf(baseTree);
  const checked = added.filter((path) => !frozen.has(path));

  /** @type {Finding[]} */
  const findings = [];
  for (const path of checked) {
    const sql = gitText(["show", `${headSha}:${path}`]);
    findings.push(...checkMigration(path, sql, baseVersions));
  }
  return report(findings, checked.length);
}

function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const pathsIndex = args.indexOf("--paths");

  if (pathsIndex !== -1) {
    const paths = args.slice(pathsIndex + 1);
    if (paths.length === 0 || pathsIndex !== 0) {
      console.error(
        "::error::--paths takes a list of files and cannot be combined with base/head revisions",
      );
      return 2;
    }
    return runPaths(paths);
  }

  if (positional.length !== 2) {
    console.error(
      "usage: check-migration-safety.mjs <base-sha> <head-sha> | --paths <file.sql>...",
    );
    return 2;
  }

  return runRange(positional[0], positional[1]);
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(`::error::${String(error?.message ?? error).split("\n")[0]}`);
    process.exit(2);
  }
}
