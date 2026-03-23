# Pixwise

Bill-splitting web app for the Brazilian market with instant Pix settlement.

Scan a receipt or enter a total, assign items to people, and settle via Pix QR codes — no bank app juggling required.

## Features

- **Two bill modes** — Itemized (restaurant receipts with per-item assignment) or single amount (Uber, Airbnb, etc.)
- **Flexible splits** — Equal, percentage-based (visual sliders), or fixed amounts per person
- **Multi-payer support** — Track who paid what when the bill was covered by more than one person
- **Service fees** — Configurable percentage or fixed fee applied automatically
- **Pix QR codes** — EMV BR Code generation with Copia e Cola for instant settlement
- **Debt simplification** — Minimizes transactions with step-by-step visualization
- **Real-time sync** — Supabase Realtime keeps all participants updated instantly
- **Groups** — Create groups, invite by @handle, split bills among accepted members
- **Secure** — Pix keys encrypted with AES-256-GCM at rest, decrypted server-side only

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router) |
| UI | React 19, Tailwind CSS v4, shadcn/ui, Framer Motion |
| State | Zustand (local-first, syncs to Supabase) |
| Backend | Supabase (PostgreSQL + Auth + Realtime) |
| Auth | Google OAuth, Phone OTP |
| Deploy | Vercel (frontend), Supabase (database) |
| Language | TypeScript 5 |

## Getting Started

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project (São Paulo region recommended)

### Setup

```bash
git clone https://github.com/tprei/pixwise.git
cd pixwise
npm install
```

Create `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
PIX_ENCRYPTION_KEY=<64-char hex string>
```

Generate the encryption key:

```bash
openssl rand -hex 32
```

Apply database migrations:

```bash
supabase db push --linked
```

Run the dev server:

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000).

## Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── page.tsx            # Landing page
│   ├── demo/               # Public demo (no auth)
│   ├── auth/               # Google OAuth + phone OTP + onboarding
│   ├── app/                # Protected app shell
│   │   ├── bill/new/       # Bill creation wizard
│   │   ├── bill/[id]/      # Bill detail + settlement
│   │   ├── bills/          # Bill list with search/filters
│   │   ├── groups/         # Group management
│   │   └── profile/        # User settings + Pix key
│   └── api/
│       ├── pix/generate/   # Pix QR code generation (server-side)
│       └── users/lookup/   # Exact @handle lookup
├── components/
│   ├── bill/               # Wizard steps + summary
│   ├── settlement/         # QR modal, debt graph, simplification
│   ├── shared/             # Reusable components (avatar, logo)
│   └── ui/                 # shadcn/ui primitives
├── stores/
│   └── bill-store.ts       # Zustand store (all bill logic)
├── lib/
│   ├── crypto.ts           # AES-256-GCM encryption (server-only)
│   ├── pix.ts              # EMV BR Code + CRC16-CCITT
│   ├── simplify.ts         # Debt simplification algorithm
│   ├── currency.ts         # BRL formatting (integer centavos)
│   └── supabase/           # Client configuration + sync
├── hooks/                  # React hooks (auth, realtime, invites)
└── types/                  # Domain + database types
supabase/
└── migrations/             # PostgreSQL schema + RLS policies
```

## Routes

| Path | Description |
|------|-------------|
| `/` | Landing page |
| `/demo` | Interactive demo (no auth required) |
| `/auth` | Sign in (Google OAuth or phone OTP) |
| `/auth/onboard` | Set @handle and Pix key |
| `/app` | Dashboard — balance, quick actions, recent bills |
| `/app/bill/new` | Bill creation wizard |
| `/app/bill/[id]` | Bill detail with settlement |
| `/app/bills` | Searchable bill list |
| `/app/groups` | Group list and management |
| `/app/groups/[id]` | Group detail |
| `/app/profile` | Profile and settings |

## How It Works

### Bill Creation

1. Choose bill type — itemized or single amount
2. Add title, merchant, date
3. Add participants by @handle
4. Enter items (itemized) or total amount
5. Assign consumption per item, or choose a split method
6. Select who paid and how much
7. Review and create

### Settlement

The app computes a ledger of who owes whom. The simplification algorithm reduces the number of transactions:

1. Compute raw edges from consumption and payment data
2. Net balances per participant
3. Greedy pairing of debtors with creditors
4. Chain collapse and reverse-pair netting

Each participant can generate a Pix QR code to pay their share directly.

### Security

- Pix keys are **encrypted at rest** (AES-256-GCM) and **decrypted server-side only**
- Row-Level Security on all Supabase tables
- User discovery by **exact @handle only** — no search or enumeration
- QR generation requires authenticated co-participation in the bill

## Commands

```bash
npm run dev        # Dev server
npm run build      # Production build (includes type-checking)
npm run lint       # ESLint
```

## Dev Tools

In development mode, a red bug icon appears in the bottom-right corner with quick-fill buttons to populate test data (participants, items, splits, multi-payer scenarios) without manual entry.

## Key Conventions

- All money is **integer centavos** — never floating point
- All user-facing text is **Portuguese (pt-BR)**
- Supabase uses `gen_random_uuid()`, not `uuid_generate_v4()`
