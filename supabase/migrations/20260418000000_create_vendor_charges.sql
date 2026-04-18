-- Vendor charges: standalone QR code charges for walk-up payments
-- These are NOT tied to groups or expenses — they are personal payment requests.

create table if not exists vendor_charges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  description text,
  status text not null default 'pending' check (status in ('pending', 'received')),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create index idx_vendor_charges_user_id on vendor_charges(user_id);
create index idx_vendor_charges_created_at on vendor_charges(created_at desc);

alter table vendor_charges enable row level security;

-- Users can only see their own charges
create policy "Users can view own charges"
  on vendor_charges for select
  using (user_id = auth.uid());

-- Users can only insert charges for themselves
create policy "Users can insert own charges"
  on vendor_charges for insert
  with check (user_id = auth.uid());

-- Users can only update their own charges (for confirming)
create policy "Users can update own charges"
  on vendor_charges for update
  using (user_id = auth.uid());
