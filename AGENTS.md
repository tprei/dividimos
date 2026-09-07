# Agent Instructions

This file is for AI coding agents working in this repository. Follow it unless a human gives a more specific instruction.

> **This is NOT the Next.js you know.** This project runs Next.js 16, which has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

## Mission

Build Dividimos as a sovereign, Brazil-first expense-splitting app. Every expense belongs to a group; the ledger keeps a signed net balance per participant as a projection that every financial RPC recomputes in-transaction (Splitwise-inspired). Settlements happen via Pix. Optimize for reviewability, product learning, and operational simplicity. Do not optimize for scale before the product asks for it.

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
- lifecycle: `active` ⇄ `deleted` (soft delete, version history)

Keep domain rules separate from delivery mechanisms:

- Next.js API routes and Supabase RPC functions translate requests, enforce atomicity, and persist data.
- Pure domain math — currency conversion, debt simplification, Pix EMV encoding — lives in `src/lib` functions with no I/O.
- Zustand stores and React components present state and collect intent; they do not own business rules.
- Declarative SQL schemas (`supabase/schemas/`, regenerated baseline) persist and query data; access is RPC-only.

Do not create generic `manager`, `processor`, `util`, or `service` packages when a domain name would be clearer.

## Frontend Rules

- Use Next.js App Router and React primitives first. Keep TypeScript simple.
- Keep business logic out of JSX. Move reusable presentation into components; keep screens as orchestration.
- All hooks must run before any early returns.
- Zustand is the client state library. Consolidate data fetching at the load boundary; components receive data as props or read from the store.
- Screens never call Supabase. All network lives in `src/lib/sync/` (`client`, `bootstrap`, `refresh`, `realtime`, `auth`, `mutations`, `mutations-group`); components read the Zustand store or receive data as props.
- Use design-system tokens and shadcn/ui primitives. Do not scatter raw colors, spacing, or typography.
- Range inputs use global CSS styling in `globals.css`, not inline classes.
- Use the circular `UserAvatar` component for all user display. Never render square initial badges.
- Keep the Supabase proxy in `src/proxy.ts` as `export async function proxy()`.
- Pix keys are encrypted at rest and decrypted server-side only. Never import `src/lib/crypto.ts` (server-only) from a client component; display the masked hint instead.
- Keep user-facing copy in PT-BR.
- Do not add animation, state, or UI libraries without a clear reason. Framer Motion is already present.

## Backend / Data Rules

- Every table has RLS enabled with zero policies and no `anon`/`authenticated` grants. Every read and write is a `SECURITY DEFINER` RPC that checks membership first (`supabase/schemas/03_rpc_read.sql` through `08_rpc_guest.sql`, `11_vendor_charges.sql`, `14_rpc_nudge.sql`).
- `expense_versions` (one row per edit, with `payload` and `change_summary`) and `settlements` are the only financial facts. `group_balances` is a projection: one row per `(group, kind, participant)` with a signed `net_cents` (positive = the participant is owed). Guests are participants with `kind = 'guest'` and can carry a balance until claimed.
- `group_balances` is never written directly. Every mutating ledger RPC calls `recompute_group_balances(group)` inside the same transaction, recomputing the projection from the facts.
- Transfers are minimized at read time: `group_transfers(group)` in SQL and `transfersFromBalances` in TypeScript implement the same greedy two-pointer over the balances (parity-tested over 200 random ledgers). Never store transfer rows or a minimized graph.
- Expense lifecycle is `active` ⇄ `deleted` (soft delete + version history). There is no draft state. Optimistic concurrency: mutations send `expected_version_no` and the RPC rejects a mismatch with `stale_version`.
- The client is local-first: screens read the Zustand store (`src/stores/app-store.ts`, persisted to IndexedDB via `src/lib/idb-storage.ts`) and never query Supabase. All network lives in `src/lib/sync/`. Mutations patch the store optimistically, roll back per entry on failure, and reconcile with `refreshGroup`.
- Realtime is broadcast-only: RPCs `realtime.send` to private `group:<id>` / `chat:<id>` topics authorized by a policy on `realtime.messages`. No tables in the publication.
- The schema is declarative: edit `supabase/schemas/*.sql`, run `./scripts/build-baseline.sh`, and commit both. Never hand-edit `supabase/migrations/20260906000000_ledger_baseline.sql`; CI fails if it is stale.
- The per-expense cap is `MAX_EXPENSE_CENTS = 99_999_999` cents (`src/lib/expense-money.ts` is the sole owner of this cap and the fee formula). Service fee is integer basis points, computed as nonnegative half-up rounding of `subtotal * basisPoints / 10_000`, identically in TypeScript and SQL. Persisted item/share/payer/fee equality is exact — never a tolerance, a client-side re-derivation the RPC then overwrites, or a second rounding convention.
- Schema changes with semantic logic must be covered by integration tests (see Tests).

The remote Supabase instance has meaningful network latency (~1-5s per round trip from Brazil). Every unnecessary query is felt by the user. These rules are non-negotiable.

**Parallel over sequential.** When multiple Supabase queries don't depend on each other's results, run them with `Promise.all`. Never chain `await` calls to independent tables. This applies in both client components and API routes.

**Route auth events through `src/lib/sync/auth.ts`.** Its `attachAuthListener` reacts only to `SIGNED_IN` (reset + re-bootstrap when the user id actually changed) and `SIGNED_OUT` (reset). It ignores `TOKEN_REFRESHED` and `INITIAL_SESSION` — these fire frequently and don't change the signed-in user. Do not add new `onAuthStateChange` subscribers in components.

**Realtime handlers must patch, not reload.** Chat broadcasts merge the message into the store directly. A `ledger` broadcast only schedules one `refreshGroup` for that group — never issue per-event query bursts, and never call multiple full refreshes from a single event.

**Debounce API calls triggered by user input.** Any `useEffect` that fires an API call based on a value the user types must debounce it (500ms). Use a `useRef` timer + an `AbortController` to cancel in-flight requests when a new one starts. See `PixQrModal` for the established pattern.

**Read shared data from the store, once.** The only code that issues reads is `src/lib/sync/` (bootstrap on sign-in, `refreshGroup` after a mutation or ledger broadcast, and the API routes' own service-role access). Components never fetch the same table independently — if data is missing from the store, extend the sync layer, not the component.

**Consolidate refreshes at the sync boundary.** When several parts of a screen need fresh data, trigger one `refreshGroup` and let the store notify subscribers — do not scatter `useEffect` fetches across components.

## Tests

Write tests when they reduce real risk.

Tests should verify behavior, not implementation details. Prefer a few clear tests over many fragile ones. Tests must not depend on order or shared mutable state.

**Schema changes with semantic logic must be covered by integration tests.** Any change to `supabase/schemas/*.sql` that adds or modifies an RPC, realtime topic, trigger, or constraint needs behavior coverage in `*.integration.test.ts` — happy path, denial for non-members, and the edge cases the SQL specifically guards (locks, validation, membership checks). The coverage can extend an existing file under `src/lib/ledger/` or live in a new one; what matters is that an integration test exercises the change. Pure structural changes (adding an index, renaming a column with no semantic change) are exempt. The baseline-replay CI job only proves the SQL applies cleanly and the baseline is fresh; it does not exercise behavior.

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
