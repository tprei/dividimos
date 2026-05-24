# Plan: API rate limiting — 2026-05-16

## Summary

The 2026-05-16 audit (P1.5 + security M8) flagged that no API route in
`src/app/api/**` enforces rate limits. Three abuse classes are in scope:

- Directory enumeration (`/api/users/lookup` — `src/app/api/users/lookup/route.ts:21-29`),
  which returns id/handle/name/avatar for any matched `@handle` and has no per-caller throttle.
- Gemini quota burn (`/api/voice/parse`, `/api/chat/parse`, `/api/receipt/ocr`),
  each of which calls a paid third-party API on every request.
- Cross-user nuisance (`/api/push/send` — `src/app/api/push/send/route.ts:6-86`),
  where any accepted co-member can deliver arbitrary `title`/`body`/`url` to another user.

Pix QR minting (`/api/pix/generate*`) and SEFAZ scraping (`/api/receipt/sefaz`)
round out the list. This plan covers the helper, per-route limits, response
shape, tests, rollout, and risks. No code in this PR — the artifact is the plan.

## Recommended approach

Use a **Supabase-backed fixed-window token counter** as the canonical store, with
an **optional per-instance in-memory short-circuit** for the hot path. Single
helper, two layers:

1. **Layer 1 — process-local LRU (60 s window).** A `Map<bucketKey, { count, resetAt }>`
   guarded by the request hot path. Resets per process. Catches the common
   "user mashes the button" case in zero DB round trips. On a single Fly machine
   this is the only check that fires for the burst.
2. **Layer 2 — Supabase `rate_limit_counters` table.** Authoritative across
   instances. One row per `(bucket_key, window_start)` keyed by user id (or
   user id + recipient for `push/send`). Incremented through a `SECURITY DEFINER`
   RPC that does `INSERT … ON CONFLICT … DO UPDATE SET count = count + 1 RETURNING count`.

Why not the alternatives:

- **Upstash Redis (`@upstash/ratelimit`)** is the industry default and would be
  trivially correct, but it adds a paid SaaS dependency with credentials,
  network egress from Fly to Upstash, and a new failure mode (Redis down →
  fail open or fail closed?). For a small team and traffic in the tens of
  req/min, the operational cost outweighs the benefit. Revisit if traffic
  grows past ~1 RPS sustained per route.
- **Pure in-memory.** Fly.io scales horizontally; the `fly.toml` strategy and
  Capacitor build CI imply >1 machine is plausible. Per-instance counters
  under-protect by a factor of `N` and degrade silently when autoscaling.
  This is exactly the audit risk we are paid to avoid.
- **Pure Supabase.** Correct but adds a DB round trip to every protected
  request. Brazil-hosted PG round trips are 200-400 ms in practice (`CLAUDE.md`,
  "Data fetching rules"). The hybrid keeps the fast path at zero RTT.

Layer 1 is **soft**: it cannot block on its own; it only short-circuits the
"definitely over the limit" cases. Layer 2 is **hard**: it's the source of
truth. Multiple machines converge in Postgres.

## Per-route limits

Limits expressed as `requests / 60 s window` unless noted. Buckets keyed by
`user_id` unless noted.

| Route | File | Bucket key | Limit | Notes |
|---|---|---|---|---|
| `GET /api/users/lookup` | `src/app/api/users/lookup/route.ts` | `user_id` | **30/min** | Directory enumeration guard. Matches audit recommendation. |
| `POST /api/pix/generate` | `src/app/api/pix/generate/route.ts` | `user_id` | **60/min** | Server-side decrypts a peer's Pix key; high-value action. |
| `POST /api/pix/generate-self` | `src/app/api/pix/generate-self/route.ts` | `user_id` | **60/min** | Same budget as `generate`; combined cap is reasonable. |
| `POST /api/voice/parse` | `src/app/api/voice/parse/route.ts` | `user_id` | **30/min** | Gemini cost; `maxDuration = 10`. |
| `POST /api/chat/parse` | `src/app/api/chat/parse/route.ts` | `user_id` | **30/min** | Gemini cost. |
| `POST /api/receipt/ocr` | `src/app/api/receipt/ocr/route.ts` | `user_id` | **30/min** | Gemini cost; image upload. |
| `POST /api/receipt/sefaz` | `src/app/api/receipt/sefaz/route.ts` | `user_id` | **10/min** | Outbound scrape to a government portal; be polite. |
| `POST /api/push/send` | `src/app/api/push/send/route.ts` | `user_id + recipient_user_id` | **5/min per pair** plus **60/min per caller** | Pair limit prevents targeted spam; caller cap prevents fan-out abuse. |
| `POST /api/push/subscribe` | `src/app/api/push/subscribe/route.ts` | `user_id` | **20/min** | Subscription churn protection. |
| `POST /api/push/unsubscribe` | `src/app/api/push/unsubscribe/route.ts` | `user_id` | **20/min** | Same. |
| `POST /api/dev/login` | `src/app/api/dev/login/route.ts` | n/a | **bypass** | Already gated on `NODE_ENV !== "production"` and `NEXT_PUBLIC_DEV_LOGIN_ENABLED === "true"` (`src/app/api/dev/login/route.ts:22-34`). |

Burst budget: each bucket gets a one-time refill of `floor(limit / 2)` tokens
on first use of a new window, so a user reconciling many settlements at once
(e.g., 10 quick `/api/pix/generate` calls) does not hit the wall on the first
seconds of a window.

## Helper shape

New module: `src/lib/rate-limit.ts` (server-only — assert via
`import "server-only"`). Exposed surface:

```ts
type RateLimitBucket =
  | "users.lookup"
  | "pix.generate"
  | "pix.generate-self"
  | "voice.parse"
  | "chat.parse"
  | "receipt.ocr"
  | "receipt.sefaz"
  | "push.send"
  | "push.send.pair"
  | "push.subscribe"
  | "push.unsubscribe";

interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAtMs: number;     // epoch ms when the window rolls over
  retryAfterSec: number; // 0 when allowed
}

async function enforceRateLimit(
  bucket: RateLimitBucket,
  subjectKey: string,           // e.g. user.id; for pair buckets: `${caller}:${recipient}`
): Promise<RateLimitResult>;
```

Each route reads the user once (already does), then calls `enforceRateLimit`
and, on `allowed === false`, returns the 429 helper (next section).

Underlying Supabase migration adds:

```
public.rate_limit_counters (
  bucket          text not null,
  subject_key     text not null,
  window_start    timestamptz not null,
  count           int not null default 0,
  primary key (bucket, subject_key, window_start)
)
```

RLS: enabled, no public policies. All access goes through
`public.increment_rate_limit(bucket, subject_key, window_ms, max_count)`,
`SECURITY DEFINER`, `SET search_path = ''`, mirroring the convention in
`supabase/migrations/20260412010000_rls_hardening.sql` and
`supabase/migrations/20260516120000_rpc_hardening_claim_lock_and_settlement_membership.sql`.
A scheduled `pg_cron` job (or a `before insert` trigger that prunes >24 h old
rows) keeps the table small. The hot query is the upsert returning `count`;
add an index on `(bucket, subject_key, window_start)` (the PK already covers
it).

## Error response shape

429 body, consistent with `src/lib/errors.ts:124-131` (`AppError.toJSON`) and
the existing `RATE_LIMIT_EXCEEDED` code (`src/lib/errors.ts:49,112-113`):

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Muitas requisições. Tente novamente em alguns segundos.",
    "context": { "retryAfterSec": 12, "limit": 30 }
  }
}
```

Headers on every response from a rate-limited route:

- `X-RateLimit-Limit: <limit>`
- `X-RateLimit-Remaining: <remaining>`
- `X-RateLimit-Reset: <epoch-seconds>`
- `Retry-After: <seconds>` (429 only; standard HTTP semantic)

Client UI: the existing `react-hot-toast` setup in `src/app/layout.tsx:63-69`
displays `toast.error(...)` strings — see callers like
`src/components/group/group-invite-modal.tsx:85`. A small client helper
`handleApiError(response)` parses the JSON, detects the `RATE_LIMIT_EXCEEDED`
code, and shows a Portuguese toast with the `retryAfterSec` value. Today most
routes already surface server messages verbatim, so this is a one-line addition
to each call site (or a wrapper `fetch` helper — preferred, see PR split below).

## Test bypass

Integration tests and synthetic E2E must not hit 429. Bypass logic in the
helper:

- Env var `RATE_LIMIT_DISABLED=1` (read once at module load via
  `process.env.RATE_LIMIT_DISABLED === "1"`) makes `enforceRateLimit` return
  `{ allowed: true, limit: Infinity, remaining: Infinity, resetAtMs: 0, retryAfterSec: 0 }`.
- The integration test runner (`vitest.integration.config.mts`) sets this in
  its `env` config or `src/test/integration-setup.ts`. Place the assignment
  alongside the existing service-role wiring (`src/test/integration-setup.ts:1-24`).
- Production never sets this var. Document this clearly in `CLAUDE.md` under
  "Local development setup" so nobody is surprised when prod traffic gets
  throttled.

## Test strategy

Unit tests (Vitest, `src/lib/rate-limit.test.ts`):

- In-memory layer counts up, resets after the window.
- Burst refill kicks in on first call of a new window.
- `RATE_LIMIT_DISABLED=1` short-circuits.
- Pair-key formatting for `push.send.pair`.

Integration tests (`src/lib/supabase/rate-limit.integration.test.ts`, new):

- `increment_rate_limit` RPC: first call returns 1, hitting `max_count` returns
  `null` (or an `over_limit: true` sentinel), window roll-over starts fresh.
- Two parallel callers on the same bucket and subject converge to the right
  total (test the PK conflict path).
- Bucket isolation: `voice.parse` counter for user A does not increment
  `chat.parse` for user A nor `voice.parse` for user B.
- `pg_cron` (or trigger) prune leaves the table empty after the retention
  window. If `pg_cron` is awkward locally, prefer the trigger path or a manual
  `delete_stale_rate_limits()` function called explicitly in the test.

Follow the conventions in
`src/lib/supabase/settlement-actions.integration.test.ts` and
`src/lib/supabase/rls-hardening.integration.test.ts`. Skip with
`describe.skipIf(!isIntegrationTestReady)` per the existing pattern.

API route tests stay unit-level. Each route gets one test case verifying that
when `enforceRateLimit` returns `allowed: false`, the route returns 429 with
the headers and body above. Mock `enforceRateLimit` rather than touching the
DB — the helper is already covered by integration tests.

## PR split

**Infra-first, three PRs.**

1. **PR 1 — helper + migration + bypass.**
   - New: `src/lib/rate-limit.ts`, `src/lib/rate-limit.test.ts`.
   - New migration: `supabase/migrations/20260517XXXXXX_create_rate_limit_counters.sql`
     (table + `increment_rate_limit` RPC + retention trigger).
   - New: `src/lib/supabase/rate-limit.integration.test.ts`.
   - Env var wiring in `src/test/integration-setup.ts` and a note in
     `CLAUDE.md`.
   - No route changes. Existing behavior unchanged.

2. **PR 2 — sensitive routes adopt the helper.**
   - `/api/users/lookup`, `/api/pix/generate`, `/api/pix/generate-self`,
     `/api/push/send`.
   - New client `fetch` wrapper (`src/lib/api-client.ts`) that maps 429 to a
     Portuguese toast via `react-hot-toast`. Replace `fetch` calls in the
     four corresponding client paths.

3. **PR 3 — Gemini + SEFAZ + push churn.**
   - `/api/voice/parse`, `/api/chat/parse`, `/api/receipt/ocr`,
     `/api/receipt/sefaz`, `/api/push/subscribe`, `/api/push/unsubscribe`.
   - These are lower-risk; landing them last lets us tune limits based on the
     production telemetry from PR 2.

Splitting this way keeps each PR small, lets the helper bake on the sensitive
routes first, and avoids a sprawling diff that's hard to review.

## Risks and mitigations

- **Process-local cache under-protects on multi-instance Fly.** Mitigation:
  the Supabase layer is authoritative; the in-memory layer only short-circuits
  obvious over-limit cases. Even if instance count grows, the worst-case is
  one DB hit per protected request, which we already pay for `auth.getUser()`.
- **Supabase DB latency on every protected request.** Mitigation: the in-memory
  short-circuit absorbs repeat hits within a window. For lookups already paying
  a Supabase round trip (every route calls `auth.getUser()`), a second
  parallel-able RPC is acceptable. If telemetry shows otherwise, we can
  pipeline the rate-limit RPC with the auth check via `Promise.all` per the
  "Parallel over sequential" rule in `CLAUDE.md`.
- **429 on legitimate burst usage.** Mitigation: burst refill of `limit / 2`
  on a fresh window. For `/api/pix/generate` at 60/min that's a 30-request
  burst, well above the realistic reconcile-many-settlements case
  (`src/components/conversations/conversation-share-modal.tsx` and friends
  loop a handful of users at most).
- **Counter table growth.** Mitigation: retention trigger or `pg_cron` job
  prunes rows older than 24 h. Window keys are timestamps rounded to the
  minute, so per-user fan-out is bounded.
- **Bypass leaking to production.** Mitigation: `RATE_LIMIT_DISABLED` is read
  exactly once at module load and logged at boot (`console.warn` in non-prod
  only). The CI build verifies it is unset in the production Dockerfile env.
- **Per-pair `push.send` key cardinality.** A user in N groups could create
  up to N pair buckets, but each row is tiny and pruned within 24 h. Not a
  concern at current scale.
- **Multi-window edge.** Fixed windows have the classic "2x burst at boundary"
  problem (29 requests at second 59, 29 more at second 1 of the next window).
  For the volumes here, that's acceptable. If we need a sliding window later,
  swap the RPC implementation without changing the helper signature.

## Out of scope

- IP-based rate limiting (we have authenticated routes only; unauthenticated
  routes either don't exist or are gated on `NODE_ENV`).
- Global per-IP DDoS protection — that's Fly's edge layer, not application code.
- Rate-limiting Supabase RPCs directly. The audit specifically flagged the
  HTTP surface; RPCs are reached through it.

## Relevant files

- Routes to instrument: `src/app/api/users/lookup/route.ts`,
  `src/app/api/pix/generate/route.ts`, `src/app/api/pix/generate-self/route.ts`,
  `src/app/api/voice/parse/route.ts`, `src/app/api/chat/parse/route.ts`,
  `src/app/api/receipt/ocr/route.ts`, `src/app/api/receipt/sefaz/route.ts`,
  `src/app/api/push/send/route.ts`, `src/app/api/push/subscribe/route.ts`,
  `src/app/api/push/unsubscribe/route.ts`.
- Skip: `src/app/api/dev/login/route.ts` (already gated).
- Existing error infrastructure to extend:
  `src/lib/errors.ts:49,112-113,124-131`.
- Client toast surface to integrate with: `src/app/layout.tsx:4,63-69` and
  existing `toast.error(...)` call sites (`src/components/group/group-invite-modal.tsx:85`).
- Integration test conventions to follow:
  `src/lib/supabase/settlement-actions.integration.test.ts`,
  `src/test/integration-setup.ts:1-24`,
  `src/test/integration-helpers.ts`.
- Migration conventions: `supabase/migrations/20260412010000_rls_hardening.sql`
  and `supabase/migrations/20260516120000_rpc_hardening_claim_lock_and_settlement_membership.sql`
  (both `SECURITY DEFINER` with `SET search_path = ''`).
