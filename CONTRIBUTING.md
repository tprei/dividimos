# Contributing

This project values small, reviewable changes. The goal is not just to make code work, but to keep the codebase understandable enough that humans can stay in charge of it.

## Branches And Pull Requests

- `main` is protected.
- Changes enter `main` only through pull requests.
- Pushing non-`main` branches is fine.
- Every PR must be human reviewed before merge.
- AI review automation is welcome, but it never replaces human review.
- PRs must pass CI before merge.

## PR Size

PRs should stay under 1,000 changed lines.

Generated code, lockfile churn, snapshots, and other clearly machine-generated artifacts may exceed that limit, but the human-authored part of the PR should still be small and reviewable.

If a change would exceed the limit, split it into several PRs. Prefer stacked PRs when the changes naturally depend on each other.

## Stacked Diffs

Stacked diffs are encouraged for larger work because they preserve review quality while still letting us move quickly.

Use the standard workflow in `agent-guidance/writing/STACKED_DIFFS.md`. The GitHub-visible PR structure is the standard. Graphite CLI is the preferred helper when available, especially for coding agents, but plain Git is fine when it produces the same branch shape, PR titles, and PR descriptions.

## CI

CI is the main feedback loop for preventing regressions. It runs on every pull request and on every push to `main`.

CI currently runs:

- `npm run lint` — ESLint with `--max-warnings 0` (`.github/workflows/ci.yml`).
- `npm test` — unit tests via Vitest + happy-dom (`.github/workflows/ci.yml`).
- `npx tsc --noEmit` — type check (`.github/workflows/ci.yml`).
- `npm run test:integration` — integration tests against a fresh local Supabase instance, verifying the ledger RPC layer: membership checks, balance recomputation, and constraints (`.github/workflows/integration.yml`).
- `npm run test:synthetic` — Playwright synthetic E2E tests against local Supabase and a production build of the app (`npm run build` + `npm run start`), on PRs and on `main` alike. The same job asserts `/api/dev/login` answers 404 on that production server, so dev login can never be what makes the suite pass (`.github/workflows/synthetic.yml`).
- Migration verification (`.github/workflows/migrations.yml`): `scripts/verify-migrations.mjs` replays the complete migration directory on independent fresh databases, verifies the trusted migration epoch against the reset manifest, regenerates `src/types/database.ts` from the resulting catalog, runs the integration contract suite, and checks database security invariants. Its Node tests live in `scripts/verify-migrations.test.mjs`.
- Nightly, `npm run test:soak` and `npm run test:soak:integration` replay the property-based ledger tests at high run counts with the run id as the fast-check seed, and a failure opens a `soak-failure` issue carrying that seed (`.github/workflows/soak.yml`). Pull requests run the same properties at a fixed seed and low run count, so they stay deterministic.
- Database security invariants (`scripts/check-database-invariants.mjs`, run by the replay job): after the migrations replay, the effective schema is read back and the check fails, naming the object, if an application table has RLS off, carries a policy, grants anything to `anon`, `authenticated` or `PUBLIC`, or if a `SECURITY DEFINER` function lacks a pinned `search_path` or has an unreviewed owner. Exceptions live in `supabase/security-allowlist.json`; deleting that file fails the check rather than skipping it.
- Migration history (`.github/workflows/migration-history.yml`): any migration already present on the base branch is frozen, so editing, deleting, renaming or chmod-ing one fails. New migration files need a unique 14-digit timestamp that sorts after the base's greatest version; duplicate versions (even with different suffixes), backdated additions and nonconforming names all fail. Replacing applied history wholesale is authorized only by an exact path/blob manifest at `supabase/migrations-reset-manifest.json` read from the base tree, introduced by a maintainer-reviewed gate PR; nothing a PR head can write authorizes a reset. The workflow and the checker are checked out from an explicitly pinned `main` commit, never from the PR's base branch, which for a stacked PR is an unmerged parent, and the PR head is read as git data only, so a PR cannot alter the gate that judges it.
- A PR that changes `.github/workflows/`, `scripts/check-migration-history.mjs`, `supabase/config.toml`, or `supabase/migrations-reset-manifest.json` fails that gate until a maintainer reviews it and adds the `trusted-ci-change` label.
- New migration safety (`scripts/check-migration-safety.mjs`, run by the `migration-safety` job before the replay jobs spend forty minutes): every file added under `supabase/migrations/` is read as text and checked for a descriptive two-word slug, DDL kept out of backfill files, no volatile default on `ADD COLUMN`, constraints added `NOT VALID`, `SET NOT NULL` behind a validated check, a `lock_timeout` preamble on any file carrying table DDL, and a `-- supersedes: <signature> introduced <version>` directive on any `DROP FUNCTION` or destructive column change, naming a version already applied on the base branch. Files already present in the base tree are never reported, so the frozen history stays frozen. Function bodies are masked by dollar-quote tag before any rule runs, so a body that contains `UPDATE` or `ALTER` is not mistaken for DDL. Tests live in `scripts/check-migration-safety.test.mjs`. There is no exception file and no suppression comment: a rule that fires has a safe formulation, and an author who cannot find one escalates instead of silencing it.
- `npm run build` — production build on every PR, since `tsc` accepts code the build rejects (`.github/workflows/ci.yml`).
- Android compile on every PR: `cap sync android` plus a debug assemble, with no signing secrets. The signed release AAB still builds on push to `main` only (`.github/workflows/android.yml`).

Do not merge failing CI because "it is probably unrelated" without a clear human decision recorded on the PR.

## Tests

Tests should prove behavior, not decorate coverage reports. Dividimos has three test layers — unit, integration, and synthetic (E2E). `TESTING.md` is the source of truth for what each layer covers, how to run it, and the fixtures and helpers available. Do not duplicate coverage across layers.

Good tests:

- Assert user-visible or domain-visible behavior.
- Use clear arrange/act/assert structure.
- Avoid depending on execution order.
- Avoid shared mutable state between tests.
- Prefer a few high-value tests over many brittle tests.

Avoid tests that only verify mocks, implementation details, or framework wiring without proving product behavior.

Choose the highest test layer needed to prove the product risk before opening a PR:

- Unit tests (`*.test.ts` / `*.test.tsx`, run with `npm test`) for pure logic and component rendering — currency math, debt simplification, Pix EMV encoding, store logic.
- Integration tests (`src/lib/ledger/*.integration.test.ts`, run with `npm run test:integration` against local Supabase after `supabase db reset`) for database behavior — RPC functions (`create_expense`, `edit_expense`, `delete_expense`, `record_settlement`, `group_transfers`), balance recomputation, zero-policy RLS (tables reject direct access), and constraints. Wrap them in `describe.skipIf(!isIntegrationTestReady)` so they skip when env vars are absent.
- Synthetic tests (`e2e/synthetic/*.spec.ts`, run with `npm run test:synthetic`) for end-to-end user journeys through the real UI, API routes, auth, and database, seeded per-test via `SeedHelper`.

**Migration changes with semantic logic must be covered by integration tests.** Any new or changed RPC, realtime topic, trigger, or constraint in `supabase/migrations/` needs behavior coverage in `*.integration.test.ts` — happy path, denial for non-members, and the edge cases the SQL specifically guards. Fresh replay and security checks prove that the SQL applies and the effective permissions are safe; they do not exercise product behavior.

Run `npm test`, `npm run test:integration`, and `npm run test:synthetic` locally when touching the surfaces above, and call that out in the PR validation notes when local Supabase is unavailable.

## Domain-Driven Design

Respect DDD principles, scaled to a small codebase:

- Use product language in code: expense, group, balance, settlement, share, payer, item, pix key, handle, user.
- Keep domain rules out of API routes, RPC functions, and UI components. Pure domain math (currency, simplification, Pix encoding) lives in `src/lib`.
- Keep infrastructure concerns at the edges.
- Make boundaries visible through modules, not through excessive abstraction.
- Do not introduce generic service layers unless they clarify domain behavior.

## Dependencies

New dependencies need a short justification in the PR description.

JavaScript dependencies are managed with npm. Run `npm install` from the repo root to install packages and set up the pre-commit hook (`prepare` sets `core.hooksPath .githooks`), and keep `package-lock.json` committed.

Before adding a dependency, ask:

- Can the standard library or existing stack solve this clearly?
- Does this make code easier to review?
- Does this increase operational burden?
- Does this weaken sovereignty or data ownership?

Avoid dependencies that introduce hidden services, unnecessary global state, or large framework conventions.

## Frontend Review Rules

- Keep screens and components small and readable.
- Keep business logic out of JSX.
- Put Supabase and API calls in dedicated modules under `src/lib`.
- Use design tokens and shadcn/ui primitives.
- Do not scatter raw colors, spacing, or typography.
- Do not add animation, state, or UI libraries without a clear reason.
- All hooks must run before any early returns.
- Never use `eslint-disable` comments. Fix the underlying code.
- Keep user-facing copy in PT-BR.
- Money is integer centavos in the store, types, and database. Never floating point for arithmetic.

## Backend Review Rules

- Keep API route handlers thin. Push behavior into `src/lib` functions or Supabase RPC.
- Every table has RLS enabled with zero policies and no `anon`/`authenticated` grants. All access goes through `SECURITY DEFINER` RPCs that check membership.
- `group_balances` is a projection, never a write target: every ledger RPC recomputes it in-transaction via `recompute_group_balances`. Never write it from client code or ad-hoc SQL.
- Keep validation and domain decisions in RPC functions or `src/lib`, not in route handlers.
- Migrations are the database source of truth: add a new timestamped file under `supabase/migrations/`, write complete schema and function definitions there, and replay the committed history with `supabase db reset --local`. Never edit, rename, or delete a migration that has landed on `main` or was applied to a shared database. The retired `supabase/schemas/` declarations and `supabase/schema.sql` snapshot are not development inputs. Use `gen_random_uuid()`, not `uuid_generate_v4()`.
- Applying migrations to production is a human-only, three-step flow: `npm run db:assert-ref`, then `supabase db push --linked --dry-run` and read the plan, then the same command without `--dry-run`. CI never pushes migrations.
- Agents never run the commands listed under "Destructive Operations" in `AGENTS.md`.
- Return clear errors without leaking internals.
- Do not add background workers, Redis, queues, or search services until the product need is real.

## PR Checklist

Before requesting review:

- The PR is under 1,000 changed lines, excluding generated code.
- The change is scoped to one coherent idea.
- CI passes locally with `npm run lint`, `npm test`, and `npx tsc --noEmit`, or the expected CI path is documented.
- Tests prove behavior where risk justifies them, at the highest layer needed.
- Any migration change that adds or modifies an RPC, trigger, or constraint includes integration-test coverage; pure structural changes are exempt.
- The migration directory is the database source of truth. The migration workflow must pass fresh replay, trusted-epoch verification, the integration contract suite, generated-type equality, and database security invariants.
- New dependencies are justified.
- The PR description explains what changed and why.
- If the PR changes `supabase/migrations/`, it explains the RPC, balance, realtime, or deployment impact.
- Stacked PRs include the stack section described in `agent-guidance/writing/STACKED_DIFFS.md`.
- Any AI-generated sections were read and edited by a human or explicitly called out.
