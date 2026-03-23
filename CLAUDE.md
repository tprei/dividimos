@AGENTS.md

# Pixwise

Bill-splitting web app targeting the Brazilian market with Pix integration.

## Quick orientation

- `src/app/` — Next.js 16 App Router pages. Main flows: landing (`page.tsx`), auth (`auth/`), app shell (`app/`)
- `src/stores/bill-store.ts` — Zustand store. All bill logic lives here: creation, item management, splits, payer tracking, ledger computation. Local-first, syncs to Supabase when connected
- `src/lib/pix.ts` — EMV BR Code generation with CRC16-CCITT. Client-side, no server dependency
- `src/lib/simplify.ts` — Debt simplification algorithm. `computeRawEdges` generates proportional edges, `simplifyDebts` reduces them with step recording for visualization
- `src/lib/currency.ts` — All money is integer centavos. `formatBRL` for display, `decimalToCents` for input
- `src/components/bill/` — Bill wizard components (type selector, item card, payer step, single amount step, summary)
- `src/components/settlement/` — Pix QR modal, debt graph SVG, simplification viewer and toggle
- `src/types/index.ts` — Domain types. `Bill` has `billType` discriminator (`single_amount` | `itemized`)
- `supabase/migrations/` — PostgreSQL schema with RLS policies. Uses `gen_random_uuid()`, not `uuid_generate_v4()`

## Commands

```bash
npm run dev          # Start dev server
npm run build        # Production build (verifies types)
npm run lint         # ESLint
supabase db push --linked   # Apply migrations to remote
```

## Key concepts

**Bill types**: "Valor unico" (single total to split) skips item steps. "Varios itens" (itemized) has item entry and per-item assignment. The wizard step array is computed dynamically from `billType`.

**Ledger computation**: Uses a net-balance algorithm. Each participant's balance = what they paid minus what they consumed. Debtors (negative) are matched with creditors (positive) via greedy pairing. Handles single payer, multi-payer, and self-settlement.

**Simplification**: `computeRawEdges` generates one edge per (consumer, payer) pair. `simplifyDebts` finds chains (A→B→C becomes A→C) and reverse pairs (A→B + B→A nets out), recording each step for the paginated visualization.

**Money**: Always integer centavos in the store and types. Never floating point for arithmetic. `formatBRL` converts to display strings.

## Conventions

- Portuguese (pt-BR) for all user-facing text
- All hooks must run before any early returns (React rules of hooks)
- Range inputs use global CSS styling in `globals.css`, not inline classes
- Dev-only code gated behind `process.env.NODE_ENV === "production"` checks
- Supabase proxy (was middleware) in `src/proxy.ts` with `export async function proxy()`
