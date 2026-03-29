# Testing Guide

Pixwise has three layers of automated tests: **unit**, **integration**, and **synthetic (E2E)**. Each layer has a specific purpose — avoid duplicating coverage across layers.

## Unit Tests

Fast, isolated tests for pure logic and component rendering. Run in Vitest with happy-dom.

```bash
npm run test            # run once
npm run test:watch      # watch mode
```

**What to test here:** currency math, debt simplification, Pix EMV encoding, component rendering, store logic.

**What NOT to test here:** database queries, RLS policies, auth flows, multi-user interactions.

## Integration Tests

Test database layer against a real local Supabase instance. Verify RLS policies, RPC atomicity, and constraint enforcement.

```bash
supabase start
npm run test:integration
```

**What to test here:** RLS policies, RPC functions (`activate_expense`, `confirm_settlement`), foreign key constraints, row-level access control.

**What NOT to test here:** UI rendering, browser navigation, multi-step user journeys.

## Synthetic Tests (E2E)

Self-contained Playwright tests that verify end-to-end user journeys through the real UI, API routes, auth, and database working together. Each test seeds its own users and data — no shared state, no ordering dependencies.

### Why "synthetic"?

Unlike traditional E2E tests that rely on pre-seeded shared users (alice/bob/carol), synthetic tests create fresh, isolated test data per test case via the `SeedHelper` class. This makes them:

- **Deterministic** — no flaky failures from leftover state
- **Independent** — run in any order, skip any test
- **Self-cleaning** — fixture teardown removes all seeded data, even on failure

### Running synthetic tests

Prerequisites: local Supabase running + dev server (auto-started by Playwright if not in CI).

```bash
# Run all synthetic tests
npm run test:synthetic

# With visible browser
npm run test:synthetic:headed

# Interactive UI mode (pause, inspect, step through)
npm run test:synthetic:ui

# Debug mode
npm run test:synthetic:debug

# Run all E2E tests (flow tests + synthetic)
npm run test:e2e
```

### Architecture

```
e2e/
├── fixtures.ts              # Custom Playwright fixtures (adminClient, seed, loginAs)
├── seed-helper.ts           # SeedHelper class — creates users, groups, expenses via admin API
├── auth.setup.ts            # Session setup for legacy flow tests (not used by synthetic)
├── flows/                   # Legacy flow tests (shared alice/bob/carol sessions)
└── synthetic/               # Synthetic tests (self-contained, isolated data)
    ├── expense-lifecycle.spec.ts
    ├── group-invite-accept.spec.ts
    └── settlement-flow.spec.ts
```

### Writing a synthetic test

```typescript
import { test, expect } from "../fixtures";

test("user can see their group", async ({ page, seed, loginAs }) => {
  // 1. Seed test data — each test creates its own users and groups
  const alice = await seed.createUser({ handle: "alice" });
  const bob = await seed.createUser({ handle: "bob" });
  const group = await seed.createGroup(alice.id, [bob.id], "Almoço");

  // 2. Authenticate as a seeded user (sets session cookies)
  await loginAs(alice);

  // 3. Interact with the UI and assert
  await page.goto(`/app/groups/${group.id}`);
  await expect(page.getByText("Almoço")).toBeVisible();

  // Cleanup runs automatically in fixture teardown — no manual cleanup needed
});
```

### Key fixtures

| Fixture | Description |
|---------|-------------|
| `adminClient` | Supabase client with service role key. Bypasses RLS for test setup. |
| `seed` | `SeedHelper` instance. Create users, groups, expenses. Auto-cleans up after test. |
| `loginAs(user)` | Authenticate the browser via `/api/dev/login`. Sets session cookies. |

### SeedHelper methods

| Method | Description |
|--------|-------------|
| `createUser(options)` | Create an auth user + profile. Returns `SeededUser` with tokens. |
| `createUsers(count, baseOptions)` | Create multiple users in parallel. |
| `createGroup(creatorId, memberIds, name)` | Create group with all members accepted. |
| `createExpense(groupId, creatorId, participantIds, options)` | Create a draft expense. |
| `createActiveExpense(...)` | Create and activate an expense (updates balances). |
| `createSettledExpense(...)` | Full lifecycle: draft → active → settled. |
| `authenticateAs(userId)` | Generate a fresh session for RPC calls. |
| `cleanup()` | Delete all tracked entities in dependency order. Called automatically. |

### Multi-user testing

To test interactions between two users (e.g., Alice creates, Bob views), use separate browser contexts:

```typescript
test("bob sees alice's expense", async ({ page, seed, loginAs, browser }) => {
  const alice = await seed.createUser({ handle: "alice" });
  const bob = await seed.createUser({ handle: "bob" });
  const group = await seed.createGroup(alice.id, [bob.id]);

  await seed.createActiveExpense(group.id, alice.id, [alice.id, bob.id]);

  // Alice's view
  await loginAs(alice);
  await page.goto(`/app/groups/${group.id}`);
  await expect(page.getByText("Ativo")).toBeVisible();

  // Bob's view — separate browser context
  const bobContext = await browser.newContext();
  const bobPage = await bobContext.newPage();
  // ... login bob in bobContext, navigate, assert
  await bobContext.close();
});
```

### Cleanup guarantees

The `seed` fixture calls `cleanup()` after every test, even if the test fails. Cleanup deletes entities in reverse dependency order:

1. Settlements
2. Expense child rows (payers, shares, items) → balances → expenses
3. Group members → groups
4. Public users → auth users

This prevents data accumulation across test runs. If a test is interrupted (e.g., process killed), orphaned data may remain — run `supabase db reset` to restore a clean state.

### What to test synthetically

- Cross-cutting user journeys (UI + API + auth + database)
- Multi-user interactions (invite/accept, settle debts)
- Status transitions visible in the UI (draft → active → settled)
- Navigation flows and page state after actions

### What NOT to test synthetically

- RLS policies — covered by integration tests
- RPC atomicity — covered by integration tests
- Component rendering in isolation — covered by unit tests
- Pure algorithms (simplification, Pix encoding) — covered by unit tests

## CI

All three test layers run in GitHub Actions on push to `main` and on pull requests:

| Workflow | File | What it runs |
|----------|------|-------------|
| CI | `.github/workflows/ci.yml` | Unit tests, type check, lint |
| Integration | `.github/workflows/integration.yml` | Integration tests against local Supabase |
| Synthetic | `.github/workflows/synthetic.yml` | Synthetic E2E tests against local Supabase + dev server |

Synthetic tests are marked `continue-on-error: true` in CI because they depend on a running dev server and browser, making them inherently slower and more sensitive to environment differences. A synthetic test failure will show as a warning but won't block the PR.

## Environment variables

All test layers need these (set by `./scripts/dev-setup.sh` or `supabase start`):

| Variable | Required by |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Integration, Synthetic |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Integration, Synthetic |
| `SUPABASE_SERVICE_ROLE_KEY` | Integration, Synthetic |
| `PIX_ENCRYPTION_KEY` | Integration |
| `NEXT_PUBLIC_AUTH_PHONE_TEST_MODE` | Synthetic (set to `true`) |
| `E2E_BASE_URL` | Synthetic (defaults to `http://localhost:3000`) |
