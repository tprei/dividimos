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
- `npm run test:synthetic` — Playwright synthetic E2E tests against local Supabase + the dev server, sharded (`.github/workflows/synthetic.yml`).
- Baseline replay on a fresh database, a baseline-freshness check (`./scripts/build-baseline.sh` must produce no diff in `supabase/schema.sql`), declaration parity, and a filename-immutability check, triggered when `supabase/schemas/**`, `supabase/schema.sql`, `supabase/migrations/**`, or the script changes (`.github/workflows/migrations.yml`).
- Nightly, `npm run test:soak` and `npm run test:soak:integration` replay the property-based ledger tests at high run counts with the run id as the fast-check seed, and a failure opens a `soak-failure` issue carrying that seed (`.github/workflows/soak.yml`). Pull requests run the same properties at a fixed seed and low run count, so they stay deterministic.
- Database security invariants (`scripts/check-database-invariants.mjs`, run by the replay job): after the migrations replay, the effective schema is read back and the check fails, naming the object, if an application table has RLS off, carries a policy, grants anything to `anon`, `authenticated` or `PUBLIC`, or if a `SECURITY DEFINER` function lacks a pinned `search_path` or has an unreviewed owner. Exceptions live in `supabase/security-allowlist.json`; deleting that file fails the check rather than skipping it.
- Migration history (`.github/workflows/migration-history.yml`): any migration already present on the base branch is frozen, so editing, deleting, renaming or chmod-ing one fails, as does adding a filename that already exists there. New timestamps are free, including further edits to them in the same PR. The job runs the base branch's copy of the workflow and checker and reads the PR head as data, so a PR cannot alter the gate that judges it.
- A PR that changes `.github/workflows/`, `scripts/check-migration-history.mjs`, or `supabase/config.toml` fails that gate until a maintainer reviews it and adds the `trusted-ci-change` label.
- `npm run build` — production build on every PR, since `tsc` accepts code the build rejects (`.github/workflows/ci.yml`).
- Android compile on PRs touching `android/`, `capacitor.config.ts` or the dependency manifests: `cap sync android` plus a debug assemble, with no signing secrets. The signed release AAB still builds on push to `main` (`.github/workflows/android.yml`).

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

**Schema changes with semantic logic must be covered by integration tests.** Any change to `supabase/schemas/*.sql` that adds or modifies an RPC, realtime topic, trigger, or constraint needs behavior coverage in `*.integration.test.ts` — happy path, denial for non-members, and the edge cases the SQL specifically guards. The baseline-replay CI job only proves the SQL applies cleanly; it does not exercise behavior.

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
- Schema is declarative: edit `supabase/schemas/*.sql`, run `./scripts/build-baseline.sh` to regenerate `supabase/schema.sql`, generate and review a forward migration with `supabase db diff` while the local stack is stopped, and commit both. Never hand-edit the frozen `supabase/migrations/20260906000000_ledger_baseline.sql`. Use `gen_random_uuid()`, not `uuid_generate_v4()`.
- Return clear errors without leaking internals.
- Do not add background workers, Redis, queues, or search services until the product need is real.

## PR Checklist

Before requesting review:

- The PR is under 1,000 changed lines, excluding generated code.
- The change is scoped to one coherent idea.
- CI passes locally with `npm run lint`, `npm test`, and `npx tsc --noEmit`, or the expected CI path is documented.
- Tests prove behavior where risk justifies them, at the highest layer needed.
- Any schema change that adds or modifies an RPC, trigger, or constraint includes integration-test coverage; pure structural changes are exempt.
- The applied baseline migration is immutable and is never regenerated. The current schema snapshot is generated with `./scripts/build-baseline.sh` from `supabase/schemas/`, and the migration workflow fails if the snapshot is stale or declarations do not match the committed forward migrations.
- New dependencies are justified.
- The PR description explains what changed and why.
- If the PR changes `supabase/schemas/`, it explains the RPC / balance / realtime impact.
- Stacked PRs include the stack section described in `agent-guidance/writing/STACKED_DIFFS.md`.
- Any AI-generated sections were read and edited by a human or explicitly called out.
