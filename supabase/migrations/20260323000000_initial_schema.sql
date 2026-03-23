create extension if not exists "uuid-ossp";

create type pix_key_type as enum ('phone', 'cpf', 'email', 'random');
create type bill_status as enum ('draft', 'active', 'partially_settled', 'settled');
create type split_type as enum ('equal', 'percentage', 'fixed');
create type debt_status as enum ('pending', 'paid_unconfirmed', 'settled');

create table users (
  id uuid primary key default uuid_generate_v4(),
  phone text unique not null,
  name text not null,
  pix_key text not null,
  pix_key_type pix_key_type not null default 'phone',
  avatar_url text,
  created_at timestamptz not null default now()
);

create table bills (
  id uuid primary key default uuid_generate_v4(),
  creator_id uuid not null references users(id) on delete cascade,
  title text not null,
  merchant_name text,
  status bill_status not null default 'draft',
  service_fee_percent numeric(5,2) not null default 10,
  fixed_fees integer not null default 0,
  total_amount integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table bill_participants (
  bill_id uuid not null references bills(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (bill_id, user_id)
);

create table bill_items (
  id uuid primary key default uuid_generate_v4(),
  bill_id uuid not null references bills(id) on delete cascade,
  description text not null,
  quantity integer not null default 1,
  unit_price_cents integer not null,
  total_price_cents integer not null,
  created_at timestamptz not null default now()
);

create table item_splits (
  id uuid primary key default uuid_generate_v4(),
  item_id uuid not null references bill_items(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  split_type split_type not null default 'equal',
  value numeric(10,4) not null,
  computed_amount_cents integer not null,
  unique (item_id, user_id)
);

create table ledger (
  id uuid primary key default uuid_generate_v4(),
  bill_id uuid not null references bills(id) on delete cascade,
  from_user_id uuid not null references users(id) on delete cascade,
  to_user_id uuid not null references users(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  status debt_status not null default 'pending',
  paid_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_bills_creator on bills(creator_id);
create index idx_bills_status on bills(status);
create index idx_bill_items_bill on bill_items(bill_id);
create index idx_item_splits_item on item_splits(item_id);
create index idx_item_splits_user on item_splits(user_id);
create index idx_ledger_bill on ledger(bill_id);
create index idx_ledger_from on ledger(from_user_id);
create index idx_ledger_to on ledger(to_user_id);
create index idx_ledger_status on ledger(status);

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger bills_updated_at
  before update on bills
  for each row execute function update_updated_at();

alter table users enable row level security;
alter table bills enable row level security;
alter table bill_participants enable row level security;
alter table bill_items enable row level security;
alter table item_splits enable row level security;
alter table ledger enable row level security;

create policy "Users can read own profile"
  on users for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on users for update
  using (auth.uid() = id);

create policy "Users can read bills they participate in"
  on bills for select
  using (
    creator_id = auth.uid()
    or id in (select bill_id from bill_participants where user_id = auth.uid())
  );

create policy "Creators can insert bills"
  on bills for insert
  with check (creator_id = auth.uid());

create policy "Creators can update own bills"
  on bills for update
  using (creator_id = auth.uid());

create policy "Participants can read bill participants"
  on bill_participants for select
  using (
    bill_id in (select bill_id from bill_participants where user_id = auth.uid())
  );

create policy "Creators can manage participants"
  on bill_participants for all
  using (
    bill_id in (select id from bills where creator_id = auth.uid())
  );

create policy "Participants can read items"
  on bill_items for select
  using (
    bill_id in (select bill_id from bill_participants where user_id = auth.uid())
  );

create policy "Creators can manage items"
  on bill_items for all
  using (
    bill_id in (select id from bills where creator_id = auth.uid())
  );

create policy "Participants can read splits"
  on item_splits for select
  using (
    item_id in (
      select bi.id from bill_items bi
      join bill_participants bp on bp.bill_id = bi.bill_id
      where bp.user_id = auth.uid()
    )
  );

create policy "Creators can manage splits"
  on item_splits for all
  using (
    item_id in (
      select bi.id from bill_items bi
      join bills b on b.id = bi.bill_id
      where b.creator_id = auth.uid()
    )
  );

create policy "Participants can read ledger entries"
  on ledger for select
  using (from_user_id = auth.uid() or to_user_id = auth.uid());

create policy "Payers can mark themselves as paid"
  on ledger for update
  using (from_user_id = auth.uid())
  with check (status = 'paid_unconfirmed');

create policy "Receivers can confirm payment"
  on ledger for update
  using (to_user_id = auth.uid())
  with check (status = 'settled');

alter publication supabase_realtime add table ledger;
alter publication supabase_realtime add table bills;
