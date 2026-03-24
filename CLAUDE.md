@AGENTS.md

# Pixwise

Bill-splitting web app targeting the Brazilian market with Pix integration and Google OAuth.

## Quick orientation

- `src/app/` — Next.js 16 App Router pages. Main flows: landing (`page.tsx`), demo (`demo/`), auth (`auth/`), app shell (`app/`)
- `src/app/auth/` — Google OAuth sign-in, callback route handler, onboarding (handle + Pix key)
- `src/app/app/groups/` — Groups with mutual confirmation (invite/accept flow)
- `src/app/api/pix/generate/` — Server-side Pix Copia e Cola generation (decrypts key server-side)
- `src/app/api/users/lookup/` — Exact @handle lookup for authenticated users
- `src/stores/bill-store.ts` — Zustand store. All bill logic lives here: creation, item management, splits, payer tracking, ledger computation. Local-first, syncs to Supabase when connected
- `src/lib/crypto.ts` — Server-only AES-256-GCM encryption for Pix keys. Never import from client components
- `src/lib/pix.ts` — EMV BR Code generation with CRC16-CCITT, plus key validation and masking
- `src/lib/simplify.ts` — Debt simplification algorithm. `computeRawEdges` generates proportional edges, `simplifyDebts` reduces them with step recording for visualization
- `src/lib/currency.ts` — All money is integer centavos. `formatBRL` for display, `decimalToCents` for input
- `src/hooks/use-auth.ts` — Client-side hook for current authenticated user profile
- `src/components/bill/` — Bill wizard components (type selector, item card, payer step, single amount step, summary, handle-based participant addition)
- `src/components/settlement/` — Pix QR modal, debt graph SVG, simplification viewer and toggle
- `src/components/shared/user-avatar.tsx` — Circular avatar with Google photo or initials fallback
- `src/types/index.ts` — Domain types. `User` has handle, email, pixKeyHint (never raw key). `Group`, `GroupMember` for groups
- `src/types/database.ts` — Supabase database types including `user_profiles` view
- `supabase/migrations/` — PostgreSQL schema with RLS policies. Uses `gen_random_uuid()`, not `uuid_generate_v4()`

## Local development setup

```bash
./scripts/dev-setup.sh       # auto-detects Docker → local Supabase, else remote
npm run dev                  # start dev server
```

**With Docker** (full local Supabase): the script runs `supabase start`, writes `.env.local`, and seeds test users (alice/bob/carol@test.pixwise.local, password: password123).

**Without Docker** (remote Supabase): set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` env vars before running the script, or it writes placeholder values (public pages only).

**Without any env vars**: the middleware gracefully degrades — `/` and `/demo` render, protected pages redirect to `/`.

### Agent auth (programmatic login)

When `NEXT_PUBLIC_AUTH_PHONE_TEST_MODE=true`, agents can authenticate via:

```bash
# Phone-based (creates user on the fly):
curl -X POST http://localhost:3000/api/dev/login \
  -H 'Content-Type: application/json' \
  -d '{"phone": "11999990001"}'

# Email-based (for seed users):
curl -X POST http://localhost:3000/api/dev/login \
  -H 'Content-Type: application/json' \
  -d '{"email": "alice@test.pixwise.local"}'
```

The response includes session cookies. Or use the UI: navigate to `/auth` → "Entrar com celular" → any phone → any 6-digit OTP.

## Commands

```bash
npm run dev                  # Start dev server
npm run build                # Production build (verifies types)
npm run lint                 # ESLint
./scripts/dev-setup.sh       # One-command local setup
supabase db push --linked    # Apply migrations to remote
```

## Key concepts

**Authentication**: Google OAuth via Supabase Auth. On first login, a trigger auto-creates a user profile with handle derived from email. Users complete onboarding by confirming handle and setting their Pix key.

**Pix key security**: Keys are encrypted with AES-256-GCM (`src/lib/crypto.ts`) before storage. Raw keys never reach the client. QR codes are generated server-side via `POST /api/pix/generate`. The `pix_key_hint` column stores a masked display version.

**User discovery**: No search functionality. Users add others by exact @handle to prevent enumeration. The `user_profiles` view exposes only id, handle, name, avatar_url.

**Groups**: Persisted in Supabase. Invite by @handle → member must accept (mutual confirmation). Only `accepted` members appear in bill creation.

**Bill types**: "Valor unico" (single total to split) skips item steps. "Varios itens" (itemized) has item entry and per-item assignment. The wizard step array is computed dynamically from `billType`.

**Ledger computation**: Uses a net-balance algorithm. Each participant's balance = what they paid minus what they consumed. Debtors (negative) are matched with creditors (positive) via greedy pairing.

**Simplification**: `computeRawEdges` generates one edge per (consumer, payer) pair. `simplifyDebts` finds chains and reverse pairs, recording each step for the paginated visualization.

**Money**: Always integer centavos in the store and types. Never floating point for arithmetic. `formatBRL` converts to display strings.

**Demo page**: Public at `/demo`, no auth. Pre-computed settlement showcase with interactive QR codes.

## Conventions

- Portuguese (pt-BR) for all user-facing text
- All hooks must run before any early returns (React rules of hooks)
- Range inputs use global CSS styling in `globals.css`, not inline classes
- Dev-only code gated behind `process.env.NODE_ENV === "production"` checks
- Supabase proxy in `src/proxy.ts` with `export async function proxy()`
- Circular `UserAvatar` component for all user display (never square initial badges)
- Pix keys: encrypted at rest, decrypted server-side only, hints for display
