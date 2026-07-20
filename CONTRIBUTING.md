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
- `npm run test:integration` — integration tests against a fresh local Supabase instance, verifying RLS, RPC atomicity, and constraints (`.github/workflows/integration.yml`).
- `npm run test:synthetic` — Playwright synthetic E2E tests against local Supabase + the dev server, sharded (`.github/workflows/synthetic.yml`).
- Migration replay on a fresh database plus a filename-immutability check, triggered when `supabase/migrations/**` changes (`.github/workflows/migrations.yml`).
- Signed Android release AAB via Capacitor, on push to `main` (`.github/workflows/android.yml`).

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
- Integration tests (`*.integration.test.ts`, run with `npm run test:integration` against local Supabase) for database behavior — RLS policies, RPC functions (`activate_expense`, `confirm_settlement`), foreign key constraints, row-level access control. Wrap them in `describe.skipIf(!isIntegrationTestReady)` so they skip when env vars are absent.
- Synthetic tests (`e2e/synthetic/*.spec.ts`, run with `npm run test:synthetic`) for end-to-end user journeys through the real UI, API routes, auth, and database, seeded per-test via `SeedHelper`.

**Migrations with semantic logic must be covered by integration tests.** Any new migration that adds or modifies an RPC, RLS policy, trigger, or constraint needs behavior coverage in `*.integration.test.ts` — happy path, RLS denial for outsiders, and the edge cases the SQL specifically guards. Pure structural migrations (adding an index, renaming a column with no semantic change) are exempt. The migration-replay CI job only proves the SQL applies cleanly; it does not exercise behavior.

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
- Every table has RLS. Data is isolated by group and user.
- Balances are written only by `activate_expense` and `confirm_settlement` RPC functions (`SECURITY DEFINER`). Never write the `balances` table directly from client code.
- Keep validation and domain decisions in RPC functions or `src/lib`, not in route handlers.
- Prefer explicit SQL migrations under `supabase/migrations/`. Use `gen_random_uuid()`, not `uuid_generate_v4()`.
- Return clear errors without leaking internals.
- Do not add background workers, Redis, queues, or search services until the product need is real.

## PR Checklist

Before requesting review:

- The PR is under 1,000 changed lines, excluding generated code.
- The change is scoped to one coherent idea.
- CI passes locally with `npm run lint`, `npm test`, and `npx tsc --noEmit`, or the expected CI path is documented.
- Tests prove behavior where risk justifies them, at the highest layer needed.
- Any migration that adds or modifies an RPC, RLS policy, trigger, or constraint includes integration-test coverage; pure structural migrations are exempt.
- Existing migration files are not renamed or deleted (the migrations CI job rejects this). Add a new migration that reverses or supersedes instead.
- New dependencies are justified.
- The PR description explains what changed and why.
- If the PR changes a Supabase migration, it explains the RLS / RPC / balance impact.
- Stacked PRs include the stack section described in `agent-guidance/writing/STACKED_DIFFS.md`.
- Any AI-generated sections were read and edited by a human or explicitly called out.
