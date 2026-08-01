# Agent Instructions

This file is for AI coding agents working in this repository. Follow it unless a human gives a more specific instruction.

> **This is NOT the Next.js you know.** This project runs Next.js 16, which has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

## Mission

Build Dividimos as a sovereign, Brazil-first expense-splitting app. Every expense belongs to a group; activating an expense atomically updates running net balances between user pairs (Splitwise-inspired). Settlements happen via Pix. Optimize for reviewability, product learning, and operational simplicity. Do not optimize for scale before the product asks for it.

## Current Stack Decision

Use this as the default architecture:

- Framework: Next.js 16 (App Router), React 19.
- Language: TypeScript.
- Backend / database: Supabase (PostgreSQL + Row-Level Security + Auth + Realtime). The Next.js API routes and Supabase RPC functions are the backend.
- Auth: Google OAuth via Supabase Auth on web; Google Credential Manager on Android. No phone, no 2FA.
- Client state: Zustand.
- Styling: Tailwind CSS v4 + shadcn/ui + Framer Motion.
- Tests: Vitest + React Testing Library (unit and integration), Playwright (synthetic E2E).
- Mobile: Capacitor 8 (Android; iOS later).
- Deploy: Vercel (frontend), Supabase (database).

Do not introduce a separate backend service, an ORM (Prisma, Drizzle), Redis, a message queue, a background worker, a dedicated search service, a different state library (Redux, Recoil, Jotai), iOS builds, or protobuf/gRPC unless the user explicitly asks or the product requirement makes it unavoidable.

## Product Constraints

- The app is PT-BR first. Keep user-facing copy informal, Brazilian, and useful.
- Authentication is Google OAuth only. Do not add phone, password, or 2FA flows.
- Money is integer centavos everywhere — store, types, and database. Never floating point for arithmetic.
- Users are discovered by exact `@handle` only. No search, no listing, no enumeration.
- Pix keys are encrypted at rest (AES-256-GCM) and decrypted server-side only. Raw keys never reach the client.

## Reviewability Rules

AI code must be easy for a human to audit.

- Prefer boring, explicit code.
- Keep files small.
- Keep functions small.
- Do not create broad abstractions before there is repeated pain.
- Do not add dependencies without explaining why.
- Do not generate styling blobs.
- Do not create or version Markdown artifacts unless a human explicitly asks for them.
- Do not create `docs/*` trees. Architecture and product decisions belong in `README.md` unless a human explicitly chooses another home.
- Do not hide business rules in UI components, hooks, middleware, or database triggers.
- Do not mix unrelated refactors into feature work.
- All hooks must run before any early returns (React rules of hooks).
- **Never use `eslint-disable`, `eslint-disable-next-line`, or `eslint-disable-line` comments.** Fix the underlying code instead. For `exhaustive-deps`, use `useCallback`/`useRef` to stabilize references. For `no-explicit-any`, add proper types. If a lint rule is genuinely wrong for the project, change the ESLint config.
- Gate dev-only code behind `process.env.NODE_ENV === "production"` checks.
- Follow the writing guides in `agent-guidance/writing/WRITING_TYPESCRIPT.md` and `agent-guidance/writing/STACKED_DIFFS.md`.

## Domain-Driven Design

Use product language in code and boundaries:

- `expense`
- `group`
- `balance`
- `settlement`
- `share`
- `payer`
- `item`
- `pix key`
- `handle`
- `user`
- lifecycle: `draft` → `active` → `settled`

Keep domain rules separate from delivery mechanisms:

- Next.js API routes and Supabase RPC functions translate requests, enforce atomicity, and persist data.
- Pure domain math — currency conversion, debt simplification, Pix EMV encoding — lives in `src/lib` functions with no I/O.
- Zustand stores and React components present state and collect intent; they do not own business rules.
- Supabase migrations persist and query data under RLS.

Do not create generic `manager`, `processor`, `util`, or `service` packages when a domain name would be clearer.

## Frontend Rules

- Use Next.js App Router and React primitives first. Keep TypeScript simple.
- Keep business logic out of JSX. Move reusable presentation into components; keep screens as orchestration.
- All hooks must run before any early returns.
- Zustand is the client state library. Consolidate data fetching at the load boundary; components receive data as props or read from the store.
- Put API and Supabase calls in `src/lib/supabase/` modules or feature-specific API modules. Never scatter queries across components.
- Use design-system tokens and shadcn/ui primitives. Do not scatter raw colors, spacing, or typography.
- Range inputs use global CSS styling in `globals.css`, not inline classes.
- Use the circular `UserAvatar` component for all user display. Never render square initial badges.
- Keep the Supabase proxy in `src/proxy.ts` as `export async function proxy()`.
- Pix keys are encrypted at rest and decrypted server-side only. Never import `src/lib/crypto.ts` (server-only) from a client component; display the masked hint instead.
- Keep user-facing copy in PT-BR.
- Do not add animation, state, or UI libraries without a clear reason. Framer Motion is already present.

## Backend / Data Rules

- Every Supabase table has Row-Level Security. Data is isolated by group and user; RLS is enforced, not optional.
- Balances are never written directly. They are updated only by the `activate_saved_expense` and `confirm_settlement` RPC functions (`SECURITY DEFINER`). This prevents race conditions and ensures atomicity.
- The `balances` table stores one row per `(group, user_a, user_b)` pair where `user_a < user_b` (canonical UUID ordering). Positive `amount_cents` means `user_a` owes `user_b`; negative means the reverse.
- The per-expense cap is `MAX_EXPENSE_CENTS = 99_999_999` cents (`src/lib/expense-money.ts` is the sole owner of this cap and the fee formula). Service fee is integer basis points, computed as nonnegative half-up rounding of `subtotal * basisPoints / 10_000`, identically in TypeScript and SQL. Persisted item/share/payer/fee equality is exact — never a tolerance, a client-side re-derivation the RPC then overwrites, or a second rounding convention.
- Migrations with semantic logic must be covered by integration tests (see Tests).

The remote Supabase instance has meaningful network latency (~1-5s per round trip from Brazil). Every unnecessary query is felt by the user. These rules are non-negotiable.

**Parallel over sequential.** When multiple Supabase queries don't depend on each other's results, run them with `Promise.all`. Never chain `await` calls to independent tables. This applies in both client components and API routes.

**Filter `onAuthStateChange` events.** Only act on `SIGNED_IN`, `SIGNED_OUT`, and `USER_UPDATED`. Ignore `TOKEN_REFRESHED` and `INITIAL_SESSION` — these fire frequently and don't change the user profile. The current `UserProvider` (`src/contexts/user-context.tsx`) also guards with a user ID ref to skip redundant DB fetches.

**Realtime handlers must patch, not reload.** When a Supabase realtime event arrives, update only the changed fields in the Zustand store directly. Never call a full data-loading function (like `loadExpense`) from a realtime handler unless the event represents a structural change (e.g., `draft → active` status transition). Each full reload issues multiple parallel queries — one per realtime event compounds quickly.

**Debounce API calls triggered by user input.** Any `useEffect` that fires an API call based on a value the user types must debounce it (500ms). Use a `useRef` timer + an `AbortController` to cancel in-flight requests when a new one starts. See `PixQrModal` for the established pattern.

**Fetch shared data once, pass it down.** If a parent and child both need the same data (e.g., expense shares with user profiles), fetch it in the parent and pass it as a prop. Never let sibling or parent/child components independently query the same table for the same rows. `loadExpense` returns `ExpenseWithDetails` including shares and payers with resolved profiles for this reason.

**Consolidate queries at the load boundary.** When a page loads, all the data it needs should be fetched in one place (`loadExpense`, `listGroupExpenses`, `queryBalances`, etc.), not scattered across multiple `useEffect` hooks in different components. Components receive data as props or read from the Zustand store — they don't fetch independently.

## Tests

Write tests when they reduce real risk.

Tests should verify behavior, not implementation details. Prefer a few clear tests over many fragile ones. Tests must not depend on order or shared mutable state.

**Migrations with semantic logic must be covered by integration tests.** Any new migration that adds or modifies an RPC, RLS policy, trigger, or constraint needs behavior coverage in `*.integration.test.ts` — happy path, RLS denial for outsiders, and the edge cases the SQL specifically guards (locks, validation, accepted-membership checks). The coverage can extend an existing test file or live in a new one; what matters is that an integration test exercises the change. Pure structural migrations (adding an index, renaming a column with no semantic change) are exempt. The migration-replay CI job only proves the SQL applies cleanly; it does not exercise behavior.

## Pull Requests

- Never push directly to `main`.
- Changes to `main` must go through PRs.
- Keep PRs under 1,000 changed lines, excluding generated code.
- Split larger work into stacked PRs.
- CI must pass before merge.
- Human review is required.
- AI review can assist, but cannot approve its own work.

## Stacked Diffs

For large work, follow `agent-guidance/writing/STACKED_DIFFS.md`.

Use Graphite CLI for stack management when it is available. If it is unavailable, use plain Git. Either way, the output must be normal GitHub PRs with the standard stack section, position-prefixed titles, passing CI, and human review.

## Documentation

Update `README.md` when architecture decisions change. Update `CONTRIBUTING.md` when workflow rules change. Keep guidance direct and current; do not write aspirational architecture that the repo does not follow.
