# Pixwise

Bill-splitting app for the Brazilian market. Scan a receipt or enter a total, assign items to people, and settle via Pix QR codes.

## What it does

- **Two bill types**: itemized (restaurants, bars) or single amount (Airbnb, Uber, flights)
- **Item assignment**: tap participant chips to assign who consumed what, with "Todos" and "Dividir restantes" shortcuts
- **Split methods**: equal, percentage (sliders), or fixed amounts
- **Who paid**: single payer ("Pagou tudo") or multi-payer with amount inputs
- **Pix settlement**: generates EMV BR Code QR codes and Copia e Cola strings client-side
- **Debt simplification**: greedy min-transactions algorithm with step-by-step graph visualization showing edge merges
- **Real-time ledger**: Supabase Realtime subscriptions for instant settlement updates across participants

## Stack

- Next.js 16 (App Router) + TypeScript
- Tailwind CSS v4 + shadcn/ui
- Framer Motion for animations
- Zustand for local-first state management
- Supabase (PostgreSQL + Auth + Realtime)
- QRCode library for Pix QR rendering

## Setup

```bash
npm install
cp .env.local.example .env.local
# Fill in your Supabase URL and anon key
npm run dev
```

### Supabase

1. Create a project at supabase.com (Sao Paulo region recommended)
2. Run `supabase db push --linked` to apply the migration
3. Enable phone auth under Authentication > Providers > Phone
4. Copy your project URL and anon key to `.env.local`

### Deploy

Push to GitHub, import in Vercel. Set the two env vars. Done.

## Routes

| Path | Description |
|------|-------------|
| `/` | Landing page with demo button |
| `/auth` | Phone OTP login + Pix key setup |
| `/app` | Dashboard with balance, quick actions, recent bills |
| `/app/bills` | Searchable bill list with filters |
| `/app/bill/new` | Bill creation wizard (type → info → people → items/amount → split → payer → summary) |
| `/app/bill/[id]` | Bill detail with tabs (Itens, Divisao, Pagamento) and simplification toggle |
| `/app/profile` | User profile, Pix key, preferences |

## Dev tools

In development mode, a red bug icon appears in the bottom-right corner. It provides quick-fill buttons to populate test data (participants, items, splits, multi-payer scenarios) without manual entry.
