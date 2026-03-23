# Pixwise -- architecture and implementation plan

**Date**: 2026-03-23
**Status**: Draft
**Author**: Technical Architecture

---

## Table of contents

1. [Project overview](#1-project-overview)
2. [Tech stack](#2-tech-stack)
3. [Database schema](#3-database-schema)
4. [Authentication flow](#4-authentication-flow)
5. [Core features](#5-core-features)
6. [Real-time architecture](#6-real-time-architecture)
7. [Pix integration](#7-pix-integration)
8. [UI/UX architecture](#8-uiux-architecture)
9. [Implementation phases](#9-implementation-phases)
10. [API routes](#10-api-routes)

---

## 1. Project overview

### What we are building

Pixwise is a mobile-first bill-splitting web application designed for the Brazilian market. Users photograph or scan a restaurant/bar bill (nota fiscal via NFC-e QR code), assign items to participants, and settle debts instantly via Pix -- Brazil's real-time payment system.

### Why

Splitting bills in Brazil is painful. Current apps require everyone to install native software, don't integrate with Pix natively, and can't parse Brazilian NFC-e receipts. Pixwise is a PWA that works in any mobile browser, generates Pix QR codes client-side (no payment processor fees), and updates everyone's ledger in real time via WebSockets.

### Key differentiators

- **Zero install**: PWA, works from a shared link
- **NFC-e native**: Parses Brazilian electronic receipts from QR codes
- **Client-side Pix**: Generates EMV BR Code QR payloads without a backend payment processor
- **Real-time ledger**: All participants see balance changes within milliseconds via Supabase Realtime
- **Phone-first auth**: OTP via SMS -- the same phone number is likely the user's Pix key

### Non-functional requirements

| Concern | Target |
|---------|--------|
| First contentful paint | < 1.5s on 4G |
| Ledger propagation latency | < 500ms (WebSocket) |
| Concurrent users per bill | Up to 20 |
| Offline tolerance | Graceful degradation; queue mutations when offline |
| Accessibility | WCAG 2.1 AA minimum |
| Locale | pt-BR primary, en-US secondary |

---

## 2. Tech stack

### Framework: Next.js 15 (App Router)

**Justification**: Server Components reduce client JS bundle. Server Actions provide type-safe RPC without manual API boilerplate. Vercel deployment gives edge middleware for auth checks and automatic ISR. The App Router is the stable default in Next.js 15.

### Database + Auth + Realtime: Supabase

**Justification**: Supabase provides a managed PostgreSQL database with Row Level Security, built-in phone OTP authentication, and Realtime subscriptions over WebSocket -- all three core infrastructure needs in a single service. The JS client (`@supabase/supabase-js`) works in both server and client contexts.

### Styling: Tailwind CSS v4 + shadcn/ui

**Justification**: Tailwind v4 uses `@theme` directives in CSS (no `tailwind.config.js` needed). shadcn/ui provides accessible, composable primitives (Dialog, Sheet, Tabs, etc.) that we own as source code -- no version lock-in.

### Animations: Framer Motion

**Justification**: Declarative layout animations for page transitions, item reordering, and settlement confirmations. Works with React Server Components when wrapped in client boundary.

### Icons: Lucide React

**Justification**: Tree-shakeable, consistent stroke-width icons. Default icon library for shadcn/ui.

### Pix: Client-side EMV BR Code generation

**Justification**: Static Pix payloads (BR Code) are deterministic strings with a CRC16-CCITT checksum. No server round-trip or payment API needed. The receiving user's Pix key is embedded in the QR code payload.

### Deployment: Vercel

**Justification**: Native Next.js support, edge middleware, preview deploys per PR, automatic HTTPS.

### Package manager: pnpm

**Justification**: Fast, disk-efficient, strict dependency resolution.

### Full dependency list (initial)

```
# Core
next@15
react@19
react-dom@19
typescript@5

# Supabase
@supabase/supabase-js
@supabase/ssr

# Styling
tailwindcss@4
@tailwindcss/postcss
shadcn (CLI, not a runtime dep)

# UI
framer-motion
lucide-react
next-themes
sonner              # toast notifications (shadcn default)

# Pix / QR
qrcode              # QR code image generation

# Validation
zod

# Dev
eslint
eslint-config-next
prettier
prettier-plugin-tailwindcss
```

---

## 3. Database schema

### Design principles

1. **Double-entry ledger**: Every monetary event creates two `ledger_entries` rows (debit + credit). The sum of all entries for any participant on any bill always equals zero across the system.
2. **Immutable ledger**: Ledger entries are INSERT-only. Corrections create new offsetting entries.
3. **Currency**: All amounts stored as `integer` in centavos (BRL cents). No floating point.
4. **UUIDs everywhere**: All primary keys are `uuid` with `gen_random_uuid()` default.
5. **Row Level Security**: Every table has RLS enabled. Policies grant access through bill participation.

### Entity relationship diagram (text)

```
participants (Supabase auth.users extension)
  |
  +--< bill_participants >--+
  |                          |
  |                        bills
  |                          |
  |                        items
  |                          |
  +--< item_splits >--------+
  |
  +--< ledger_entries
  |
  +--< settlements
```

### SQL schema

```sql
-- =============================================================
-- Migration: 001_initial_schema
-- Purpose: Core tables for Pixwise bill-splitting application
-- =============================================================

-- ---------------------
-- 1. PROFILES
-- ---------------------
-- Extends Supabase auth.users with app-specific fields.
-- Created automatically via a trigger on auth.users INSERT.

create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  phone         text not null,
  display_name  text not null default '',
  avatar_url    text,
  pix_key       text,
  pix_key_type  text check (pix_key_type in ('phone', 'email', 'cpf', 'random', 'cnpj')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "users read own profile"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

create policy "users update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Trigger: auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, phone)
  values (new.id, new.phone);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------------------
-- 2. BILLS
-- ---------------------

create table public.bills (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  created_by    uuid not null references public.profiles(id),
  currency      text not null default 'BRL',
  status        text not null default 'open'
                  check (status in ('open', 'locked', 'settled')),
  nfce_url      text,
  nfce_raw      jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.bills enable row level security;


-- ---------------------
-- 3. BILL PARTICIPANTS
-- ---------------------

create table public.bill_participants (
  id            uuid primary key default gen_random_uuid(),
  bill_id       uuid not null references public.bills(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id),
  role          text not null default 'member'
                  check (role in ('owner', 'member')),
  joined_at     timestamptz not null default now(),
  unique (bill_id, profile_id)
);

alter table public.bill_participants enable row level security;

-- Helper function: check if current user participates in a bill
create or replace function public.is_bill_participant(p_bill_id uuid)
returns boolean as $$
  select exists (
    select 1 from public.bill_participants
    where bill_id = p_bill_id and profile_id = auth.uid()
  );
$$ language sql security definer stable;

-- Bills: participants can read; owner can update
create policy "participants read bills"
  on public.bills for select
  to authenticated
  using (public.is_bill_participant(id));

create policy "owner creates bills"
  on public.bills for insert
  to authenticated
  with check (created_by = auth.uid());

create policy "owner updates bills"
  on public.bills for update
  to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

-- Bill participants: participants can read; owner can insert
create policy "participants read membership"
  on public.bill_participants for select
  to authenticated
  using (public.is_bill_participant(bill_id));

create policy "owner adds participants"
  on public.bill_participants for insert
  to authenticated
  with check (
    exists (
      select 1 from public.bills
      where id = bill_id and created_by = auth.uid()
    )
  );

create policy "owner removes participants"
  on public.bill_participants for delete
  to authenticated
  using (
    exists (
      select 1 from public.bills
      where id = bill_id and created_by = auth.uid()
    )
  );


-- ---------------------
-- 4. ITEMS
-- ---------------------

create table public.items (
  id            uuid primary key default gen_random_uuid(),
  bill_id       uuid not null references public.bills(id) on delete cascade,
  description   text not null,
  quantity       integer not null default 1 check (quantity > 0),
  unit_price    integer not null check (unit_price >= 0),
  total_price   integer not null generated always as (quantity * unit_price) stored,
  barcode       text,
  nfce_item_seq integer,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.items enable row level security;

create policy "participants read items"
  on public.items for select
  to authenticated
  using (public.is_bill_participant(bill_id));

create policy "participants manage items"
  on public.items for insert
  to authenticated
  with check (public.is_bill_participant(bill_id));

create policy "participants update items"
  on public.items for update
  to authenticated
  using (public.is_bill_participant(bill_id));

create policy "participants delete items"
  on public.items for delete
  to authenticated
  using (public.is_bill_participant(bill_id));


-- ---------------------
-- 5. ITEM SPLITS
-- ---------------------
-- Each row assigns a portion of an item to a participant.
-- split_type = 'percent' means split_value is a percentage (0-10000, basis points).
-- split_type = 'fixed' means split_value is an amount in centavos.

create table public.item_splits (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references public.items(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id),
  split_type    text not null default 'equal'
                  check (split_type in ('equal', 'percent', 'fixed')),
  split_value   integer not null default 0,
  computed_amount integer not null default 0,
  created_at    timestamptz not null default now(),
  unique (item_id, profile_id)
);

alter table public.item_splits enable row level security;

create policy "participants read splits"
  on public.item_splits for select
  to authenticated
  using (
    exists (
      select 1 from public.items i
      where i.id = item_id and public.is_bill_participant(i.bill_id)
    )
  );

create policy "participants manage splits"
  on public.item_splits for insert
  to authenticated
  with check (
    exists (
      select 1 from public.items i
      where i.id = item_id and public.is_bill_participant(i.bill_id)
    )
  );

create policy "participants update splits"
  on public.item_splits for update
  to authenticated
  using (
    exists (
      select 1 from public.items i
      where i.id = item_id and public.is_bill_participant(i.bill_id)
    )
  );

create policy "participants delete splits"
  on public.item_splits for delete
  to authenticated
  using (
    exists (
      select 1 from public.items i
      where i.id = item_id and public.is_bill_participant(i.bill_id)
    )
  );


-- ---------------------
-- 6. LEDGER ENTRIES (double-entry)
-- ---------------------
-- Every financial event produces exactly two rows:
--   one with direction = 'debit'  (the person who owes)
--   one with direction = 'credit' (the person who is owed)
-- amount is always positive. The direction column determines sign.
-- For any bill, SUM(CASE WHEN direction='debit' THEN amount ELSE -amount END) = 0.

create table public.ledger_entries (
  id              uuid primary key default gen_random_uuid(),
  bill_id         uuid not null references public.bills(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id),
  counterparty_id uuid not null references public.profiles(id),
  direction       text not null check (direction in ('debit', 'credit')),
  amount          integer not null check (amount > 0),
  entry_type      text not null check (entry_type in ('split', 'settlement')),
  reference_id    uuid,
  created_at      timestamptz not null default now()
);

alter table public.ledger_entries enable row level security;

create policy "participants read ledger"
  on public.ledger_entries for select
  to authenticated
  using (public.is_bill_participant(bill_id));

-- Ledger entries are insert-only from server actions (no client inserts).
-- We grant insert only through a Postgres function, not direct policy.

create index idx_ledger_bill_profile
  on public.ledger_entries(bill_id, profile_id);

create index idx_ledger_bill_counterparty
  on public.ledger_entries(bill_id, counterparty_id);


-- ---------------------
-- 7. SETTLEMENTS
-- ---------------------
-- Tracks a Pix payment from payer to payee.
-- Status lifecycle: pending -> confirmed -> acknowledged

create table public.settlements (
  id            uuid primary key default gen_random_uuid(),
  bill_id       uuid not null references public.bills(id) on delete cascade,
  payer_id      uuid not null references public.profiles(id),
  payee_id      uuid not null references public.profiles(id),
  amount        integer not null check (amount > 0),
  status        text not null default 'pending'
                  check (status in ('pending', 'confirmed', 'acknowledged')),
  pix_payload   text,
  confirmed_at  timestamptz,
  acknowledged_at timestamptz,
  created_at    timestamptz not null default now()
);

alter table public.settlements enable row level security;

create policy "participants read settlements"
  on public.settlements for select
  to authenticated
  using (public.is_bill_participant(bill_id));

create policy "payer creates settlement"
  on public.settlements for insert
  to authenticated
  with check (payer_id = auth.uid() and public.is_bill_participant(bill_id));

create policy "payee acknowledges settlement"
  on public.settlements for update
  to authenticated
  using (payee_id = auth.uid())
  with check (payee_id = auth.uid());


-- ---------------------
-- 8. VIEWS
-- ---------------------

-- Balances view: net amount each participant owes/is owed per bill
create or replace view public.bill_balances as
select
  bill_id,
  profile_id,
  sum(case when direction = 'debit' then -amount else amount end) as net_balance
from public.ledger_entries
group by bill_id, profile_id;

-- Pairwise debts: who owes whom and how much (net)
create or replace view public.pairwise_debts as
select
  bill_id,
  case when net > 0 then debtor else creditor end as from_id,
  case when net > 0 then creditor else debtor end as to_id,
  abs(net) as amount
from (
  select
    le.bill_id,
    least(le.profile_id, le.counterparty_id) as debtor,
    greatest(le.profile_id, le.counterparty_id) as creditor,
    sum(
      case
        when le.profile_id = least(le.profile_id, le.counterparty_id)
          then case when direction = 'debit' then -amount else amount end
        else case when direction = 'debit' then amount else -amount end
      end
    ) as net
  from public.ledger_entries le
  group by le.bill_id,
           least(le.profile_id, le.counterparty_id),
           greatest(le.profile_id, le.counterparty_id)
) sub
where abs(net) > 0;


-- ---------------------
-- 9. FUNCTIONS
-- ---------------------

-- Compute and write ledger entries when splits are finalized for a bill.
-- Called from a Server Action when the bill owner locks the bill.
create or replace function public.finalize_bill(p_bill_id uuid)
returns void as $$
declare
  v_owner_id uuid;
  v_split record;
begin
  select created_by into v_owner_id
  from public.bills where id = p_bill_id;

  if v_owner_id != auth.uid() then
    raise exception 'Only the bill owner can finalize';
  end if;

  update public.bills set status = 'locked', updated_at = now()
  where id = p_bill_id;

  for v_split in
    select
      isp.profile_id,
      b.created_by as owner_id,
      isp.computed_amount
    from public.item_splits isp
    join public.items i on i.id = isp.item_id
    join public.bills b on b.id = i.bill_id
    where i.bill_id = p_bill_id
      and isp.computed_amount > 0
      and isp.profile_id != b.created_by
  loop
    -- Debit entry: the participant owes
    insert into public.ledger_entries
      (bill_id, profile_id, counterparty_id, direction, amount, entry_type, reference_id)
    values
      (p_bill_id, v_split.profile_id, v_split.owner_id, 'debit', v_split.computed_amount, 'split', null);

    -- Credit entry: the owner is owed
    insert into public.ledger_entries
      (bill_id, profile_id, counterparty_id, direction, amount, entry_type, reference_id)
    values
      (p_bill_id, v_split.owner_id, v_split.profile_id, 'credit', v_split.computed_amount, 'split', null);
  end loop;
end;
$$ language plpgsql security definer;


-- Record a settlement and write corresponding ledger entries.
create or replace function public.record_settlement(
  p_bill_id uuid,
  p_payee_id uuid,
  p_amount integer
)
returns uuid as $$
declare
  v_settlement_id uuid;
begin
  insert into public.settlements (bill_id, payer_id, payee_id, amount, status)
  values (p_bill_id, auth.uid(), p_payee_id, p_amount, 'pending')
  returning id into v_settlement_id;

  return v_settlement_id;
end;
$$ language plpgsql security definer;


-- Acknowledge a settlement: payee confirms receipt of Pix payment.
create or replace function public.acknowledge_settlement(p_settlement_id uuid)
returns void as $$
declare
  v_settlement record;
begin
  select * into v_settlement
  from public.settlements
  where id = p_settlement_id;

  if v_settlement.payee_id != auth.uid() then
    raise exception 'Only the payee can acknowledge';
  end if;

  if v_settlement.status != 'confirmed' then
    raise exception 'Settlement must be confirmed before acknowledging';
  end if;

  update public.settlements
  set status = 'acknowledged', acknowledged_at = now()
  where id = p_settlement_id;

  -- Write ledger entries for the settlement
  insert into public.ledger_entries
    (bill_id, profile_id, counterparty_id, direction, amount, entry_type, reference_id)
  values
    (v_settlement.bill_id, v_settlement.payer_id, v_settlement.payee_id, 'credit', v_settlement.amount, 'settlement', p_settlement_id);

  insert into public.ledger_entries
    (bill_id, profile_id, counterparty_id, direction, amount, entry_type, reference_id)
  values
    (v_settlement.bill_id, v_settlement.payee_id, v_settlement.payer_id, 'debit', v_settlement.amount, 'settlement', p_settlement_id);
end;
$$ language plpgsql security definer;


-- ---------------------
-- 10. REALTIME PUBLICATION
-- ---------------------

drop publication if exists supabase_realtime;
create publication supabase_realtime;

alter publication supabase_realtime add table public.ledger_entries;
alter publication supabase_realtime add table public.settlements;
alter publication supabase_realtime add table public.items;
alter publication supabase_realtime add table public.item_splits;
alter publication supabase_realtime add table public.bill_participants;
```

### TypeScript types (generated from schema)

```typescript
// src/types/database.ts

export type PixKeyType = 'phone' | 'email' | 'cpf' | 'random' | 'cnpj';
export type BillStatus = 'open' | 'locked' | 'settled';
export type SplitType = 'equal' | 'percent' | 'fixed';
export type LedgerDirection = 'debit' | 'credit';
export type LedgerEntryType = 'split' | 'settlement';
export type SettlementStatus = 'pending' | 'confirmed' | 'acknowledged';
export type ParticipantRole = 'owner' | 'member';

export interface Profile {
  id: string;
  phone: string;
  display_name: string;
  avatar_url: string | null;
  pix_key: string | null;
  pix_key_type: PixKeyType | null;
  created_at: string;
  updated_at: string;
}

export interface Bill {
  id: string;
  title: string;
  created_by: string;
  currency: string;
  status: BillStatus;
  nfce_url: string | null;
  nfce_raw: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface BillParticipant {
  id: string;
  bill_id: string;
  profile_id: string;
  role: ParticipantRole;
  joined_at: string;
}

export interface Item {
  id: string;
  bill_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  barcode: string | null;
  nfce_item_seq: number | null;
  created_at: string;
  updated_at: string;
}

export interface ItemSplit {
  id: string;
  item_id: string;
  profile_id: string;
  split_type: SplitType;
  split_value: number;
  computed_amount: number;
  created_at: string;
}

export interface LedgerEntry {
  id: string;
  bill_id: string;
  profile_id: string;
  counterparty_id: string;
  direction: LedgerDirection;
  amount: number;
  entry_type: LedgerEntryType;
  reference_id: string | null;
  created_at: string;
}

export interface Settlement {
  id: string;
  bill_id: string;
  payer_id: string;
  payee_id: string;
  amount: number;
  status: SettlementStatus;
  pix_payload: string | null;
  confirmed_at: string | null;
  acknowledged_at: string | null;
  created_at: string;
}

// Computed views
export interface BillBalance {
  bill_id: string;
  profile_id: string;
  net_balance: number;
}

export interface PairwiseDebt {
  bill_id: string;
  from_id: string;
  to_id: string;
  amount: number;
}
```

---

## 4. Authentication flow

### Overview

Supabase Auth with phone OTP. No passwords. After verification, the app asks whether the user's phone number is also their Pix key, with the option to specify a different key.

### Sequence

```
User                    App                         Supabase Auth
 |                       |                               |
 |-- enters phone ------>|                               |
 |                       |-- signInWithOtp({ phone }) -->|
 |                       |                               |-- sends SMS OTP
 |                       |<-- { messageId } -------------|
 |                       |                               |
 |-- enters OTP code --->|                               |
 |                       |-- verifyOtp({ phone, token })->|
 |                       |                               |-- validates
 |                       |<-- { session, user } ---------|
 |                       |                               |
 |                       |-- trigger: create profile ---->|  (DB trigger)
 |                       |                               |
 |<-- redirect to -------|                               |
 |   onboarding          |                               |
 |                       |                               |
 |-- "Is +55... your --->|                               |
 |    Pix key?"          |                               |
 |                       |                               |
 |-- YES or enters  ---->|                               |
 |   alternative key     |                               |
 |                       |-- update profile.pix_key ---->|
 |                       |                               |
 |<-- redirect to -------|                               |
 |   dashboard           |                               |
```

### Implementation details

**Server-side Supabase client** (`@supabase/ssr`):

```typescript
// src/lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );
}
```

**Client-side Supabase client**:

```typescript
// src/lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

**Middleware** (auth guard):

```typescript
// src/middleware.ts
import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const publicRoutes = ['/', '/login', '/auth/callback'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = publicRoutes.some((r) => pathname.startsWith(r));

  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!isPublic && !user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (isPublic && user && pathname === '/login') {
    return NextResponse.redirect(new URL('/bills', request.url));
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
```

### Privacy notice

During onboarding, display: "Your Pix key is stored securely and is only used to generate QR codes for others to pay you. It is never shared with third parties."

### Phone number formatting

All phone numbers are stored in E.164 format (`+5511999998888`). The UI formats for display using `pt-BR` locale conventions.

---

## 5. Core features

### 5.1 Bill creation

**Flow**:
1. User taps "New Bill"
2. Enters title (e.g., "Dinner at Bar do Zeca")
3. Optionally scans NFC-e QR code (Phase 6) or adds items manually
4. Adds participants by phone number (autocomplete from contacts who have accounts)
5. The creator is automatically added as `owner`

**Server Action**:

```typescript
// src/app/bills/actions.ts
'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { z } from 'zod';

const CreateBillSchema = z.object({
  title: z.string().min(1).max(200),
});

export async function createBill(formData: FormData) {
  const parsed = CreateBillSchema.safeParse({
    title: formData.get('title'),
  });

  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: bill, error } = await supabase
    .from('bills')
    .insert({ title: parsed.data.title, created_by: user.id })
    .select()
    .single();

  if (error) return { error: { title: [error.message] } };

  await supabase.from('bill_participants').insert({
    bill_id: bill.id,
    profile_id: user.id,
    role: 'owner',
  });

  redirect(`/bills/${bill.id}`);
}
```

### 5.2 Item management

**Data model notes**:
- `unit_price` is in centavos. The UI displays `R$ 12,50` but stores `1250`.
- `total_price` is a generated column: `quantity * unit_price`.
- Items can come from three sources: manual entry, NFC-e QR scan, or barcode scan.

**Barcode scanning**: Uses the browser `BarcodeDetector` API (Chrome/Edge/Samsung) with a `<video>` camera stream fallback for unsupported browsers. Barcodes are stored on the item but are informational only (no product database lookup in Phase 1).

### 5.3 Splitting logic

Three split modes per item:

| Mode | `split_type` | `split_value` meaning | Computation |
|------|-------------|----------------------|-------------|
| Equal | `equal` | ignored (0) | `total_price / num_participants` (round to centavo, remainder to last) |
| Percentage | `percent` | basis points (0-10000) | `total_price * split_value / 10000` |
| Fixed | `fixed` | centavos | `split_value` directly |

**Computation function** (runs client-side for preview, then verified server-side):

```typescript
// src/lib/splits.ts

import type { ItemSplit, SplitType } from '@/types/database';

interface SplitInput {
  profile_id: string;
  split_type: SplitType;
  split_value: number;
}

export function computeSplits(
  totalPrice: number,
  splits: SplitInput[]
): { profile_id: string; computed_amount: number }[] {
  if (splits.length === 0) return [];

  const allEqual = splits.every((s) => s.split_type === 'equal');

  if (allEqual) {
    const base = Math.floor(totalPrice / splits.length);
    const remainder = totalPrice - base * splits.length;
    return splits.map((s, i) => ({
      profile_id: s.profile_id,
      computed_amount: base + (i < remainder ? 1 : 0),
    }));
  }

  return splits.map((s) => {
    let amount: number;
    switch (s.split_type) {
      case 'percent':
        amount = Math.round((totalPrice * s.split_value) / 10000);
        break;
      case 'fixed':
        amount = s.split_value;
        break;
      default:
        amount = 0;
    }
    return { profile_id: s.profile_id, computed_amount: amount };
  });
}
```

**Validation rules**:
- Percent splits for an item must sum to exactly 10000 (100.00%).
- Fixed splits must sum to exactly `total_price`.
- Mixed modes are not allowed on a single item (simplifies UI and validation).

### 5.4 Settlement flow

```
Participant A owes Participant B R$ 45,00
   |
   A opens bill -> sees "You owe B: R$ 45,00" -> taps "Pay"
   |
   App generates Pix QR code (EMV BR Code) with B's Pix key
   |
   A scans QR in their bank app -> pays
   |
   A taps "I paid" in Pixwise -> settlement status = 'confirmed'
   |
   B gets real-time notification (WebSocket) -> "A says they paid R$ 45,00"
   |
   B taps "Confirm received" -> settlement status = 'acknowledged'
   |
   Ledger entries written (credit A, debit B for settlement)
   |
   Everyone's balances update in real-time
```

---

## 6. Real-time architecture

### Supabase Realtime subscriptions

The app subscribes to `postgres_changes` on the `ledger_entries` and `settlements` tables, filtered by `bill_id`. This means every participant viewing a bill sees balance updates within milliseconds of a settlement being acknowledged.

### Channel design

```
Channel per bill: bill:{bill_id}

Subscriptions:
  1. ledger_entries  INSERT  filter: bill_id=eq.{bill_id}
  2. settlements     *       filter: bill_id=eq.{bill_id}
  3. items           *       filter: bill_id=eq.{bill_id}
  4. item_splits     *       filter: item_id in items for bill
```

### Client hook

```typescript
// src/hooks/use-realtime-ledger.ts

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { LedgerEntry, Settlement } from '@/types/database';

export function useRealtimeLedger(billId: string) {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const supabase = createClient();

  useEffect(() => {
    const channel = supabase
      .channel(`bill:${billId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ledger_entries',
          filter: `bill_id=eq.${billId}`,
        },
        (payload) => {
          setEntries((prev) => [...prev, payload.new as LedgerEntry]);
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'settlements',
          filter: `bill_id=eq.${billId}`,
        },
        (payload) => {
          // Handle settlement status changes
          // Trigger toast notification for payee
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [billId, supabase]);

  return entries;
}
```

### Realtime RLS requirement

Supabase Realtime respects RLS policies. The `is_bill_participant` function ensures only bill members receive change events. No additional authorization layer is needed at the subscription level.

### Publication setup

Tables must be added to the `supabase_realtime` publication (included in the migration SQL above). This is a one-time setup per table.

---

## 7. Pix integration

### Background

Pix is Brazil's instant payment system operated by the Central Bank (BCB). A "Pix Cobran&ccedil;a" (static payment) is encoded as an EMV BR Code -- a TLV (tag-length-value) string that produces a QR code. No API keys or payment processor is needed for static payloads.

### EMV BR Code structure

The BR Code is a concatenation of TLV fields:

| ID | Field | Value for Pixwise |
|----|-------|--------------------|
| 00 | Payload Format Indicator | `01` |
| 26 | Merchant Account Info (Pix) | Contains sub-fields: |
| 26.00 | GUI | `br.gov.bcb.pix` |
| 26.01 | Pix Key | `{recipient_pix_key}` |
| 26.02 | Description (optional) | `Pixwise: {bill_title}` |
| 52 | Merchant Category Code | `0000` |
| 53 | Transaction Currency | `986` (BRL) |
| 54 | Transaction Amount | `{amount as decimal string}` |
| 58 | Country Code | `BR` |
| 59 | Merchant Name | `{recipient_name}` |
| 60 | Merchant City | `{city}` |
| 62 | Additional Data | Contains sub-fields: |
| 62.05 | Reference Label | `pixwise{settlement_id_short}` |
| 63 | CRC16 | `{calculated CRC16-CCITT}` |

### Implementation

```typescript
// src/lib/pix/emv-brcode.ts

function tlv(id: string, value: string): string {
  const len = value.length.toString().padStart(2, '0');
  return `${id}${len}${value}`;
}

function merchantAccountInfo(
  pixKey: string,
  description?: string
): string {
  let inner = tlv('00', 'br.gov.bcb.pix') + tlv('01', pixKey);
  if (description) {
    inner += tlv('02', description.substring(0, 72));
  }
  return tlv('26', inner);
}

function crc16ccitt(payload: string): string {
  const polynomial = 0x1021;
  let crc = 0xffff;

  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = ((crc << 1) ^ polynomial) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }

  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export interface PixPayload {
  pixKey: string;
  merchantName: string;
  merchantCity: string;
  amount: number;
  description?: string;
  referenceLabel?: string;
}

export function generatePixBrCode(params: PixPayload): string {
  const amountStr = (params.amount / 100).toFixed(2);

  let payload = '';
  payload += tlv('00', '01');
  payload += merchantAccountInfo(params.pixKey, params.description);
  payload += tlv('52', '0000');
  payload += tlv('53', '986');
  payload += tlv('54', amountStr);
  payload += tlv('58', 'BR');
  payload += tlv('59', params.merchantName.substring(0, 25));
  payload += tlv('60', params.merchantCity.substring(0, 15));

  if (params.referenceLabel) {
    payload += tlv('62', tlv('05', params.referenceLabel.substring(0, 25)));
  }

  payload += '6304';
  const checksum = crc16ccitt(payload);
  payload += checksum;

  return payload;
}
```

### QR code rendering

Use the `qrcode` npm package to render the BR Code string as an SVG in a React component:

```typescript
// src/components/pix-qr-code.tsx
'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { generatePixBrCode, type PixPayload } from '@/lib/pix/emv-brcode';

interface PixQrCodeProps {
  payload: PixPayload;
  size?: number;
}

export function PixQrCode({ payload, size = 256 }: PixQrCodeProps) {
  const [svg, setSvg] = useState<string>('');
  const brCode = generatePixBrCode(payload);

  useEffect(() => {
    QRCode.toString(brCode, { type: 'svg', width: size }).then(setSvg);
  }, [brCode, size]);

  return (
    <div
      className="flex flex-col items-center gap-3"
    >
      <div dangerouslySetInnerHTML={{ __html: svg }} />
      <p className="text-muted-foreground text-xs font-mono break-all max-w-xs text-center">
        {brCode}
      </p>
    </div>
  );
}
```

### Validation strategy

- CRC16 checksum is verified client-side before displaying
- Amount in the QR code must match the settlement amount in the database
- Pix key format is validated against known patterns (phone: `+55...`, CPF: 11 digits, email: `@`, random: 32-char UUID)

---

## 8. UI/UX architecture

### Design principles

- **Mobile-first**: All layouts designed for 375px viewport, scale up
- **Brazilian locale**: Currency formatting (`R$ 1.234,56`), date formatting (`dd/MM/yyyy`), phone formatting
- **Thumb-friendly**: Primary actions in bottom 40% of viewport
- **Minimal chrome**: Focus on the bill, not the app shell

### Page structure (App Router)

```
src/app/
  layout.tsx                    # Root layout: ThemeProvider, fonts, metadata
  page.tsx                      # Landing page (public)
  login/
    page.tsx                    # Phone number input + OTP verification
  onboarding/
    page.tsx                    # Display name + Pix key setup
  bills/
    layout.tsx                  # Authenticated shell: nav, user menu
    page.tsx                    # Bill list (dashboard)
    new/
      page.tsx                  # Create bill form
    [billId]/
      layout.tsx                # Bill context provider, real-time subscription
      page.tsx                  # Bill detail: items list + totals
      participants/
        page.tsx                # Manage participants
      items/
        new/
          page.tsx              # Add item form
        [itemId]/
          page.tsx              # Edit item + manage splits
      settle/
        page.tsx                # Settlement view: balances, pay/confirm actions
      scan/
        page.tsx                # NFC-e QR scanner (Phase 6)
  auth/
    callback/
      route.ts                  # Supabase auth callback handler
```

### Component hierarchy

```
src/components/
  ui/                           # shadcn/ui primitives (generated by CLI)
    button.tsx
    input.tsx
    card.tsx
    dialog.tsx
    sheet.tsx
    tabs.tsx
    badge.tsx
    avatar.tsx
    separator.tsx
    skeleton.tsx
    toast/ (sonner)
    ...

  layout/
    app-shell.tsx               # Authenticated app wrapper
    bottom-nav.tsx              # Mobile bottom navigation
    header.tsx                  # Top bar with bill title / back button

  auth/
    phone-input.tsx             # Brazilian phone number input with mask
    otp-input.tsx               # 6-digit OTP input
    pix-key-form.tsx            # Pix key type selector + input

  bills/
    bill-card.tsx               # Bill summary card for list view
    bill-header.tsx             # Bill title, status badge, participant count
    bill-status-badge.tsx       # open/locked/settled badge

  items/
    item-row.tsx                # Single item in bill item list
    item-form.tsx               # Add/edit item form
    item-list.tsx               # Scrollable item list with totals

  splits/
    split-editor.tsx            # Per-item split assignment UI
    split-mode-toggle.tsx       # Equal / Percent / Fixed toggle
    participant-split-row.tsx   # Single participant's split in editor
    split-summary.tsx           # "Remaining: R$ X,XX" indicator

  settlement/
    balance-card.tsx            # "You owe X: R$ Y" card
    pix-qr-code.tsx             # QR code display (from section 7)
    settlement-action.tsx       # "I paid" / "Confirm received" buttons
    settlement-timeline.tsx     # Status progression indicator

  shared/
    currency-display.tsx        # Formats centavos to "R$ X,XX"
    loading-skeleton.tsx        # Skeleton screens per page
    empty-state.tsx             # Empty state illustrations
    error-boundary.tsx          # Error boundary with retry
```

### Design system tokens

Using Tailwind CSS v4 `@theme` directives in the global CSS:

```css
/* src/app/globals.css */
@import "tailwindcss";

@theme inline {
  --color-primary: oklch(0.55 0.19 255);
  --color-primary-foreground: oklch(0.98 0.01 255);
  --color-secondary: oklch(0.92 0.03 255);
  --color-secondary-foreground: oklch(0.25 0.05 255);
  --color-accent: oklch(0.70 0.18 155);
  --color-accent-foreground: oklch(0.15 0.05 155);
  --color-destructive: oklch(0.60 0.22 25);
  --color-destructive-foreground: oklch(0.98 0.01 25);
  --color-muted: oklch(0.95 0.01 260);
  --color-muted-foreground: oklch(0.55 0.02 260);
  --color-background: oklch(0.99 0.005 260);
  --color-foreground: oklch(0.15 0.02 260);
  --color-card: oklch(1.0 0.0 0);
  --color-card-foreground: oklch(0.15 0.02 260);
  --color-border: oklch(0.90 0.01 260);
  --color-ring: oklch(0.55 0.19 255);
  --radius-sm: 0.25rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
}

.dark {
  --color-primary: oklch(0.70 0.19 255);
  --color-primary-foreground: oklch(0.15 0.05 255);
  --color-background: oklch(0.13 0.02 260);
  --color-foreground: oklch(0.95 0.01 260);
  --color-card: oklch(0.17 0.02 260);
  --color-card-foreground: oklch(0.95 0.01 260);
  --color-border: oklch(0.25 0.02 260);
  --color-muted: oklch(0.20 0.02 260);
  --color-muted-foreground: oklch(0.60 0.02 260);
}
```

### Animations

Framer Motion usage targets:

| Context | Animation |
|---------|-----------|
| Page transitions | `layout` prop on route wrappers, slide left/right |
| Item list reorder | `AnimatePresence` + `layout` on item rows |
| Split slider | Spring physics on drag handle |
| Settlement confirmation | Scale + check mark draw animation |
| QR code reveal | Fade in + scale from 0.8 |
| Toast notifications | Slide in from top (handled by sonner) |

---

## 9. Implementation phases

### Phase 1: Project scaffold + design system + static pages

**Duration estimate**: 2-3 days

**Deliverables**:
1. Initialize Next.js 15 project with `create-next-app`
2. Configure pnpm, TypeScript strict mode, ESLint, Prettier
3. Install and configure Tailwind CSS v4 with `@tailwindcss/postcss`
4. Initialize shadcn/ui (`npx shadcn@latest init`)
5. Install core shadcn components: Button, Input, Card, Dialog, Sheet, Tabs, Badge, Avatar, Separator, Skeleton
6. Set up `next-themes` for dark mode
7. Create design tokens in `globals.css` (colors, radii)
8. Build static layout components: `AppShell`, `BottomNav`, `Header`
9. Build static pages with placeholder data: login, bill list, bill detail, add item
10. Configure Framer Motion page transitions
11. Set up `CurrencyDisplay` component with `Intl.NumberFormat('pt-BR')`
12. Add Lucide icons throughout
13. Configure PWA manifest (`next-pwa` or manual)

**Validation**:
- All pages render without errors
- Dark mode toggle works
- Lighthouse mobile score > 90 for performance

**Key files**:
```
src/app/layout.tsx
src/app/globals.css
src/app/page.tsx
src/app/login/page.tsx
src/app/bills/layout.tsx
src/app/bills/page.tsx
src/app/bills/new/page.tsx
src/app/bills/[billId]/page.tsx
src/components/layout/app-shell.tsx
src/components/layout/bottom-nav.tsx
src/components/layout/header.tsx
src/components/shared/currency-display.tsx
src/lib/format.ts
components.json
tailwind.config.ts (not needed for v4, but shadcn may generate)
postcss.config.mjs
```

---

### Phase 2: Supabase integration (auth + database)

**Duration estimate**: 3-4 days

**Deliverables**:
1. Create Supabase project (manual, via dashboard)
2. Run migration SQL from section 3 in Supabase SQL editor
3. Install `@supabase/supabase-js` and `@supabase/ssr`
4. Create server and client Supabase clients (see section 4)
5. Create middleware for auth guards (see section 4)
6. Build login page: phone input -> OTP input -> session
7. Build onboarding page: display name + Pix key form
8. Create auth callback route handler
9. Set up environment variables (`.env.local`)
10. Test full auth flow: signup, login, logout, session refresh

**Environment variables**:
```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhb...
```

**Validation**:
- New user can sign up with phone, receive OTP, complete onboarding
- Returning user can log in and land on bill list
- Unauthenticated user is redirected to `/login`
- Profile row is auto-created via database trigger
- RLS policies block cross-user profile reads

**Key files**:
```
src/lib/supabase/server.ts
src/lib/supabase/client.ts
src/middleware.ts
src/app/login/page.tsx (replace static)
src/app/onboarding/page.tsx
src/app/auth/callback/route.ts
src/components/auth/phone-input.tsx
src/components/auth/otp-input.tsx
src/components/auth/pix-key-form.tsx
.env.local
supabase/migrations/001_initial_schema.sql
```

---

### Phase 3: Bill creation + item management

**Duration estimate**: 4-5 days

**Deliverables**:
1. Bill creation Server Action with Zod validation
2. Bill list page with real data (cards showing title, participant count, status, date)
3. Bill detail page: items list, total, participant avatars
4. Add participant flow: search by phone, invite
5. Add item form: description, quantity, unit price (currency-masked input)
6. Edit item: inline editing on bill detail page
7. Delete item: swipe-to-delete or long-press with confirmation
8. Item list with running total and per-item subtotals
9. Barcode field on items (text input for now, scanner in Phase 6)

**Server Actions**:
```
src/app/bills/actions.ts
  - createBill(formData)
  - addParticipant(billId, phone)
  - removeParticipant(billId, participantId)

src/app/bills/[billId]/items/actions.ts
  - addItem(billId, formData)
  - updateItem(itemId, formData)
  - deleteItem(itemId)
```

**Validation**:
- Create a bill, see it in the list
- Add 3 items, verify totals compute correctly
- Add a participant by phone number
- Edit an item's price, total updates
- Delete an item, total updates
- RLS: user B cannot see user A's bill unless invited

**Key files**:
```
src/app/bills/actions.ts
src/app/bills/page.tsx
src/app/bills/new/page.tsx
src/app/bills/[billId]/page.tsx
src/app/bills/[billId]/layout.tsx
src/app/bills/[billId]/participants/page.tsx
src/app/bills/[billId]/items/new/page.tsx
src/app/bills/[billId]/items/[itemId]/page.tsx
src/app/bills/[billId]/items/actions.ts
src/components/bills/bill-card.tsx
src/components/bills/bill-header.tsx
src/components/items/item-row.tsx
src/components/items/item-form.tsx
src/components/items/item-list.tsx
```

---

### Phase 4: Splitting logic + assignment UI

**Duration estimate**: 4-5 days

**Deliverables**:
1. Implement `computeSplits` utility (see section 5.3)
2. Split editor component per item: toggle between equal/percent/fixed
3. For "equal" mode: tap avatars to include/exclude participants
4. For "percent" mode: slider or numeric input per participant, must sum to 100%
5. For "fixed" mode: currency input per participant, must sum to item total
6. Real-time validation: show remaining amount / percentage to distribute
7. Server Action to save splits with server-side validation
8. Bill summary view: per-participant total across all items
9. "Lock bill" action: owner finalizes -> triggers `finalize_bill()` function -> creates ledger entries

**Server Actions**:
```
src/app/bills/[billId]/items/[itemId]/actions.ts
  - saveSplits(itemId, splits[])

src/app/bills/[billId]/actions.ts
  - finalizeBill(billId)
```

**Validation**:
- Equal split of R$ 10.00 among 3 people: two get R$ 3.34, one gets R$ 3.32
- Percent split: 50%/30%/20% on R$ 100.00 = R$ 50.00 / R$ 30.00 / R$ 20.00
- Fixed split: amounts must equal item total or form shows error
- Lock bill: ledger entries appear, bill status changes to `locked`
- Cannot edit items or splits after bill is locked

**Key files**:
```
src/lib/splits.ts
src/components/splits/split-editor.tsx
src/components/splits/split-mode-toggle.tsx
src/components/splits/participant-split-row.tsx
src/components/splits/split-summary.tsx
src/app/bills/[billId]/items/[itemId]/page.tsx
src/app/bills/[billId]/items/[itemId]/actions.ts
src/app/bills/[billId]/actions.ts (finalizeBill)
```

---

### Phase 5: Pix settlement + real-time ledger

**Duration estimate**: 5-6 days

**Deliverables**:
1. Implement EMV BR Code generator (see section 7)
2. `PixQrCode` component rendering QR codes
3. Settlement page: shows pairwise debts from `pairwise_debts` view
4. "Pay" flow: generates QR code, shows copy-to-clipboard for BR Code string
5. "I paid" button: creates settlement record with status `confirmed`
6. Real-time notification to payee via Supabase Realtime subscription
7. "Confirm received" button: calls `acknowledge_settlement` function
8. Ledger entries written on acknowledgment, balances update for all participants
9. `useRealtimeLedger` hook (see section 6)
10. Settlement timeline component showing payment status progression
11. Bill auto-transitions to `settled` when all balances are zero
12. Toast notifications (sonner) for real-time events

**Server Actions**:
```
src/app/bills/[billId]/settle/actions.ts
  - initiateSettlement(billId, payeeId, amount)
  - confirmPayment(settlementId)
  - acknowledgePayment(settlementId)
```

**Validation**:
- Generate BR Code, verify CRC16 against known test vectors
- Scan generated QR code with a Pix-enabled bank app (manual test)
- Full settlement flow: pay -> confirm -> acknowledge -> ledger updates
- Open bill in two browser windows, verify real-time ledger sync
- Verify balance reaches zero after all settlements

**Key files**:
```
src/lib/pix/emv-brcode.ts
src/lib/pix/validate.ts
src/components/settlement/balance-card.tsx
src/components/settlement/pix-qr-code.tsx
src/components/settlement/settlement-action.tsx
src/components/settlement/settlement-timeline.tsx
src/app/bills/[billId]/settle/page.tsx
src/app/bills/[billId]/settle/actions.ts
src/hooks/use-realtime-ledger.ts
```

---

### Phase 6: NFC-e QR scanning + OCR fallback

**Duration estimate**: 5-7 days

**Deliverables**:
1. Camera-based QR code scanner component using `getUserMedia` API
2. NFC-e QR code URL parser (extracts `chNFe` from SEFAZ URL)
3. SEFAZ NFC-e page scraper via API route (server-side fetch to avoid CORS)
4. NFC-e HTML parser: extract items (description, quantity, unit price, total)
5. Auto-populate items from NFC-e data with review/correction UI
6. Barcode scanner for individual items using `BarcodeDetector` API
7. Manual entry remains the primary fallback
8. OCR placeholder: design the integration point for future Tesseract.js or cloud OCR

**API Routes**:
```
src/app/api/nfce/scrape/route.ts
  - POST { url: string } -> { items: NfceItem[] }
```

**Validation**:
- Scan a real NFC-e QR code (from a Brazilian receipt)
- Items populate correctly from scraped data
- User can correct any item before saving
- Handles SEFAZ downtime gracefully (timeout + error state)
- Barcode scanner detects EAN-13 codes on supported browsers

**Key files**:
```
src/app/bills/[billId]/scan/page.tsx
src/app/api/nfce/scrape/route.ts
src/lib/nfce/parser.ts
src/lib/nfce/types.ts
src/components/scanner/qr-scanner.tsx
src/components/scanner/barcode-scanner.tsx
src/components/scanner/nfce-review.tsx
```

---

## 10. API routes

### Route map

All data mutations use Next.js Server Actions (form-bound or called directly). API routes are reserved for operations that cannot be Server Actions (webhooks, external scraping, auth callbacks).

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| GET/POST | `/auth/callback` | Supabase auth code exchange | No (callback) |
| POST | `/api/nfce/scrape` | Scrape NFC-e page from SEFAZ URL | Yes |

### Server Actions inventory

| Module | Action | Input | Output |
|--------|--------|-------|--------|
| `bills/actions.ts` | `createBill` | `{ title }` | redirect to `/bills/{id}` |
| `bills/actions.ts` | `addParticipant` | `{ billId, phone }` | `{ participant }` or `{ error }` |
| `bills/actions.ts` | `removeParticipant` | `{ billId, participantId }` | `void` or `{ error }` |
| `bills/[billId]/actions.ts` | `finalizeBill` | `{ billId }` | `void` or `{ error }` |
| `bills/[billId]/items/actions.ts` | `addItem` | `{ billId, description, quantity, unitPrice }` | `{ item }` or `{ error }` |
| `bills/[billId]/items/actions.ts` | `updateItem` | `{ itemId, ...fields }` | `{ item }` or `{ error }` |
| `bills/[billId]/items/actions.ts` | `deleteItem` | `{ itemId }` | `void` or `{ error }` |
| `bills/[billId]/items/[itemId]/actions.ts` | `saveSplits` | `{ itemId, splits[] }` | `void` or `{ error }` |
| `bills/[billId]/settle/actions.ts` | `initiateSettlement` | `{ billId, payeeId, amount }` | `{ settlement }` or `{ error }` |
| `bills/[billId]/settle/actions.ts` | `confirmPayment` | `{ settlementId }` | `void` or `{ error }` |
| `bills/[billId]/settle/actions.ts` | `acknowledgePayment` | `{ settlementId }` | `void` or `{ error }` |
| `login/actions.ts` | `sendOtp` | `{ phone }` | `void` or `{ error }` |
| `login/actions.ts` | `verifyOtp` | `{ phone, token }` | redirect |
| `onboarding/actions.ts` | `completeOnboarding` | `{ displayName, pixKey, pixKeyType }` | redirect |

### Validation strategy

Every Server Action uses Zod schemas for input validation. Example pattern:

```typescript
// Shared validation schemas
// src/lib/validations/bill.ts

import { z } from 'zod';

export const CreateBillSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
});

export const AddItemSchema = z.object({
  description: z.string().min(1, 'Description is required').max(500),
  quantity: z.coerce.number().int().min(1),
  unit_price: z.coerce.number().int().min(0),
  barcode: z.string().optional(),
});

export const SaveSplitsSchema = z.object({
  item_id: z.string().uuid(),
  splits: z.array(z.object({
    profile_id: z.string().uuid(),
    split_type: z.enum(['equal', 'percent', 'fixed']),
    split_value: z.number().int().min(0),
  })),
});

export const PhoneSchema = z.string().regex(
  /^\+55\d{10,11}$/,
  'Enter a valid Brazilian phone number'
);

export const PixKeySchema = z.object({
  pix_key: z.string().min(1),
  pix_key_type: z.enum(['phone', 'email', 'cpf', 'random', 'cnpj']),
});
```

---

## Appendix A: Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| SEFAZ scraping breaks (HTML changes) | High | Medium | Graceful degradation to manual entry; abstract parser behind interface for easy replacement |
| Supabase Realtime drops connection | Medium | High | Client reconnection logic built into `@supabase/supabase-js`; optimistic UI with local state |
| CRC16 mismatch in BR Code | Low | High | Unit test suite with known BR Code test vectors from BCB documentation |
| Phone OTP delivery failures (carrier issues) | Medium | Medium | Show retry button with cooldown; future: WhatsApp OTP as alternative channel |
| Split rounding errors | Medium | Low | Deterministic remainder distribution (first N participants get +1 centavo); server-side revalidation |
| RLS policy misconfiguration | Low | Critical | Integration tests that verify cross-user access is denied; Supabase test helpers |

## Appendix B: File structure summary

```
pixwise/
  docs/
    2026-03-23-pixwise-architecture.md    # This document
  supabase/
    migrations/
      001_initial_schema.sql
  src/
    app/
      layout.tsx
      page.tsx
      globals.css
      login/
        page.tsx
        actions.ts
      onboarding/
        page.tsx
        actions.ts
      auth/
        callback/
          route.ts
      bills/
        layout.tsx
        page.tsx
        actions.ts
        new/
          page.tsx
        [billId]/
          layout.tsx
          page.tsx
          actions.ts
          participants/
            page.tsx
          items/
            actions.ts
            new/
              page.tsx
            [itemId]/
              page.tsx
              actions.ts
          settle/
            page.tsx
            actions.ts
          scan/
            page.tsx
      api/
        nfce/
          scrape/
            route.ts
    components/
      ui/                        # shadcn/ui generated
      layout/
        app-shell.tsx
        bottom-nav.tsx
        header.tsx
      auth/
        phone-input.tsx
        otp-input.tsx
        pix-key-form.tsx
      bills/
        bill-card.tsx
        bill-header.tsx
        bill-status-badge.tsx
      items/
        item-row.tsx
        item-form.tsx
        item-list.tsx
      splits/
        split-editor.tsx
        split-mode-toggle.tsx
        participant-split-row.tsx
        split-summary.tsx
      settlement/
        balance-card.tsx
        pix-qr-code.tsx
        settlement-action.tsx
        settlement-timeline.tsx
      shared/
        currency-display.tsx
        loading-skeleton.tsx
        empty-state.tsx
        error-boundary.tsx
      scanner/
        qr-scanner.tsx
        barcode-scanner.tsx
        nfce-review.tsx
    hooks/
      use-realtime-ledger.ts
    lib/
      supabase/
        server.ts
        client.ts
      pix/
        emv-brcode.ts
        validate.ts
      nfce/
        parser.ts
        types.ts
      splits.ts
      format.ts
      validations/
        bill.ts
        auth.ts
    types/
      database.ts
  .env.local
  .env.example
  components.json
  postcss.config.mjs
  next.config.ts
  tsconfig.json
  package.json
```

## Appendix C: Open questions

1. **Participant invitation for non-users**: When a bill owner adds a phone number that has no account, do we send an SMS invite? Or create a placeholder participant that claims their account on signup? The latter avoids SMS costs but complicates the data model with "unclaimed" profiles.

2. **Multi-bill ledger**: Should there be a global balance across bills between two users, or is each bill fully independent? Starting with per-bill isolation is simpler and recommended for Phase 1.

3. **Service charge / tip splitting**: Brazilian restaurants often add a 10% "servi&ccedil;o" charge. Should this be a first-class concept (auto-split proportionally) or just another item? Recommend treating it as a regular item for now, with a "Add 10% service" shortcut button.

4. **Currency**: The schema defaults to BRL. Is multi-currency a future requirement? If so, the `currency` field on `bills` is already in place, but conversion logic is not.

5. **Offline support**: The current architecture requires connectivity. For a future phase, consider a service worker with IndexedDB queue for offline mutations that sync when reconnected.
