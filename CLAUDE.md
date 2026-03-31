@AGENTS.md

# Pagajaja

Expense-splitting web app targeting the Brazilian market with Pix integration and Google OAuth. Uses a Splitwise-inspired architecture: every expense belongs to a group, and activating an expense atomically updates running net balances between user pairs.

## Quick orientation

- `src/app/` — Next.js 16 App Router pages. Main flows: landing (`page.tsx`), demo (`demo/`), auth (`auth/`), app shell (`app/`)
- `src/app/auth/` — Google OAuth sign-in, callback route handler, onboarding (handle + Pix key)
- `src/app/app/groups/` — Groups with mutual confirmation (invite/accept flow)
- `src/app/api/pix/generate/` — Server-side Pix Copia e Cola generation (decrypts key server-side)
- `src/app/api/users/lookup/` — Exact @handle lookup for authenticated users
- `src/stores/bill-store.ts` — Zustand store for the expense wizard. Manages draft creation, item management, splits, payer tracking, and client-side debt preview via `computeLedger()`
- `src/lib/supabase/expense-actions.ts` — CRUD: `saveExpenseDraft`, `loadExpense`, `deleteExpense`, `listGroupExpenses`
- `src/lib/supabase/expense-rpc.ts` — Wraps `activate_expense` RPC. Transitions draft → active and atomically updates balances
- `src/lib/supabase/settlement-actions.ts` — Balance queries, `recordSettlement` (pending), `confirmSettlement` (RPC), settlement history
- `src/lib/supabase/expense-mappers.ts` — Row → TypeScript type mappers for all expense tables
- `src/lib/crypto.ts` — Server-only AES-256-GCM encryption for Pix keys. Never import from client components
- `src/lib/pix.ts` — EMV BR Code generation with CRC16-CCITT, plus key validation and masking
- `src/lib/simplify.ts` — Debt simplification algorithm for display. `computeRawEdges` generates proportional edges, `simplifyDebts` reduces them with step recording for visualization
- `src/lib/currency.ts` — All money is integer centavos. `formatBRL` for display, `decimalToCents` for input
- `src/hooks/use-auth.ts` — Client-side hook for current authenticated user profile
- `src/components/bill/` — Expense wizard components (type selector, item card, payer step, single amount step, summary, handle-based participant addition)
- `src/components/settlement/` — Pix QR modal, debt graph SVG, simplification viewer and toggle
- `src/components/shared/user-avatar.tsx` — Circular avatar with Google photo or initials fallback
- `src/types/index.ts` — Domain types: `Expense`, `ExpenseItem`, `ExpenseShare`, `ExpensePayer`, `Balance`, `Settlement`, `DebtEdge`, `GroupBalanceSummary`. `User` has handle, email, pixKeyHint (never raw key). Legacy `Bill`/`BillItem` aliases exist for gradual migration
- `src/types/database.ts` — Supabase database types including `user_profiles` view
- `supabase/migrations/` — PostgreSQL schema with RLS policies. Uses `gen_random_uuid()`, not `uuid_generate_v4()`. Key migrations: `*_create_expense_tables.sql` (tables + RLS), `*_create_expense_rpc_functions.sql` (atomic RPCs)

## Local development setup

```bash
./scripts/dev-setup.sh       # auto-detects Docker → local Supabase, else remote
npm run dev                  # start dev server
```

**With Docker** (full local Supabase): the script runs `supabase start`, writes `.env.local`, and seeds test users (alice/bob/carol@test.pagajaja.local, password: password123).

**Without Docker** (remote Supabase): set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` env vars before running the script, or it writes placeholder values (public pages only).

**Without any env vars**: the middleware gracefully degrades — `/` and `/demo` render, protected pages redirect to `/`.

### Remote Supabase (no Docker)

When Docker is not available, use a remote Supabase project. Set the required env vars before running the setup script:

```bash
export SUPABASE_URL=https://<project-ref>.supabase.co
export SUPABASE_ANON_KEY=<your-anon-key>
export SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>

./scripts/dev-setup.sh       # detects env vars, writes .env.local
npm run dev
```

These can also be provided as Fly secrets if running on Fly.io — the script reads them automatically.

Dev login is enabled by default in dev. It creates users on the fly — no seed data required for remote.

### Programmatic login (dev only)

When `NEXT_PUBLIC_DEV_LOGIN_ENABLED=true`, you can authenticate via API:

```bash
curl -X POST http://localhost:3000/api/dev/login \
  -H 'Content-Type: application/json' \
  -d '{"email": "alice@test.pagajaja.local"}'
```

The response sets session cookies. Or use the UI: navigate to `/auth` → sign in with Google (or use the dev email login in test mode).

## Commands

```bash
npm run dev                  # Start dev server
npm run build                # Production build (verifies types)
npm run lint                 # ESLint
npm run test                 # Run unit tests once
npm run test:watch           # Run unit tests in watch mode
npm run test:integration     # Run integration tests (requires supabase start)
npm run test:all             # Run unit + integration tests
./scripts/dev-setup.sh       # One-command local setup
supabase db push --linked    # Apply migrations to remote
```

## Testing

Unit tests use Vitest with React Testing Library. Tests are colocated with source files using `.test.ts`/`.test.tsx` suffix.

**Configuration**: `vitest.config.mts` with happy-dom environment and tsconfig paths.

**Test setup**: `src/test/setup.ts` provides jest-dom matchers and a Framer Motion mock.

Integration tests run against a real local Supabase instance and verify RLS policies.

**Configuration**: `vitest.integration.config.mts` with node environment, 30s timeout, sequential execution.

**Test setup**: `src/test/integration-setup.ts` — connects with service role key, cleans up test users after each run.

**Helpers**: `src/test/integration-helpers.ts` — `createTestUser`, `authenticateAs`, `createTestUsers`, `createTestBill`, `createTestGroup`.

**Running integration tests locally**:
```bash
supabase start
npm run test:integration
```

**Writing integration tests**: use `.integration.test.ts` suffix, wrap in `describe.skipIf(!isIntegrationTestReady)` so they are skipped when env vars are absent.

## Key concepts

**Authentication**: Google OAuth via Supabase Auth. On first login, a trigger auto-creates a user profile with handle derived from email. Users complete onboarding by confirming handle and setting their Pix key.

**Pix key security**: Keys are encrypted with AES-256-GCM (`src/lib/crypto.ts`) before storage. Raw keys never reach the client. QR codes are generated server-side via `POST /api/pix/generate`. The `pix_key_hint` column stores a masked display version.

**User discovery**: No search functionality. Users add others by exact @handle to prevent enumeration. The `user_profiles` view exposes only id, handle, name, avatar_url.

**Groups**: Persisted in Supabase. Invite by @handle → member must accept (mutual confirmation). Only `accepted` members appear in expense creation and can view group data (RLS enforced).

**Expense model (Splitwise-inspired)**: Every expense belongs to a group. Two types: `single_amount` (one total split among participants) and `itemized` (line items assigned per person). The wizard step array is computed dynamically from expense type.

**Expense lifecycle: Draft → Active → Settled**:
1. **Draft**: User builds the expense in the wizard. `saveExpenseDraft()` persists to `expenses` + child tables (`expense_items`, `expense_shares`, `expense_payers`). Can be edited or deleted.
2. **Active**: `activate_expense` RPC atomically validates shares/payers sum to total, transitions status, and updates the `balances` table. This is the point of no return.
3. **Settled**: All debts from this expense have been settled (balances reach zero).

**Balances (running net ledger)**: The `balances` table stores one row per (group, user_a, user_b) pair where `user_a < user_b` (canonical UUID ordering). Positive `amount_cents` means user_a owes user_b; negative means the reverse. Balances are never written directly — only via `activate_expense` and `confirm_settlement` RPC functions (SECURITY DEFINER). This prevents race conditions and ensures atomicity.

**Settlements (two-step confirmation)**: A debtor creates a pending settlement (`recordSettlement`). The creditor confirms it (`confirmSettlement` RPC), which atomically updates the balance toward zero. This mirrors Splitwise's "record a payment" flow.

**Simplification**: `computeRawEdges` generates one edge per (consumer, payer) pair. `simplifyDebts` finds chains and reverse pairs, recording each step for the paginated visualization. Used for display only — the canonical balance data lives in the `balances` table.

**Money**: Always integer centavos in the store, types, and database. Never floating point for arithmetic. `formatBRL` converts to display strings. Rounding happens inside the RPC: `ROUND(share * payer_amount / total)`.

**Fee distribution**: Service fee (percentage) is distributed proportionally based on item consumption. Fixed fees are divided equally among all participants.

**Demo page**: Public at `/demo`, no auth. Pre-computed settlement showcase with interactive QR codes.

## Conventions

- Portuguese (pt-BR) for all user-facing text
- All hooks must run before any early returns (React rules of hooks)
- **Never use `eslint-disable`, `eslint-disable-next-line`, or `eslint-disable-line` comments.** Fix the underlying code instead. For `exhaustive-deps`, use `useCallback`/`useRef` to stabilize references. For `no-explicit-any`, add proper types. If a lint rule is genuinely wrong for the project, change the ESLint config.
- Range inputs use global CSS styling in `globals.css`, not inline classes
- Dev-only code gated behind `process.env.NODE_ENV === "production"` checks
- Supabase proxy in `src/proxy.ts` with `export async function proxy()`
- Circular `UserAvatar` component for all user display (never square initial badges)
- Pix keys: encrypted at rest, decrypted server-side only, hints for display

## Data fetching rules

The remote Supabase instance has meaningful network latency (~1-5s per round trip from Brazil). Every unnecessary query is felt by the user. These rules are non-negotiable.

**Parallel over sequential.** When multiple Supabase queries don't depend on each other's results, run them with `Promise.all`. Never chain `await` calls to independent tables. This applies in both client components and API routes.

**Filter `onAuthStateChange` events.** Only act on `SIGNED_IN`, `SIGNED_OUT`, and `USER_UPDATED`. Ignore `TOKEN_REFRESHED` and `INITIAL_SESSION` — these fire frequently and don't change the user profile. The current `UserProvider` (`src/contexts/user-context.tsx`) also guards with a user ID ref to skip redundant DB fetches.

**Realtime handlers must patch, not reload.** When a Supabase realtime event arrives, update only the changed fields in the Zustand store directly. Never call a full data-loading function (like `loadExpense`) from a realtime handler unless the event represents a structural change (e.g., `draft → active` status transition). Each full reload issues multiple parallel queries — one per realtime event compounds quickly.

**Debounce API calls triggered by user input.** Any `useEffect` that fires an API call based on a value the user types must debounce it (500ms). Use a `useRef` timer + an `AbortController` to cancel in-flight requests when a new one starts. See `PixQrModal` for the established pattern.

**Fetch shared data once, pass it down.** If a parent and child both need the same data (e.g., expense shares with user profiles), fetch it in the parent and pass it as a prop. Never let sibling or parent/child components independently query the same table for the same rows. `loadExpense` returns `ExpenseWithDetails` including shares and payers with resolved profiles for this reason.

**Consolidate queries at the load boundary.** When a page loads, all the data it needs should be fetched in one place (`loadExpense`, `listGroupExpenses`, `queryBalances`, etc.), not scattered across multiple `useEffect` hooks in different components. Components receive data as props or read from the Zustand store — they don't fetch independently.
