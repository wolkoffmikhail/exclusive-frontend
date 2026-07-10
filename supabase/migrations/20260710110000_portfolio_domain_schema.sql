begin;

create or replace function public.set_portfolio_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.currencies (
  code text primary key check (code ~ '^[A-Z]{3}$'),
  name text not null,
  symbol text,
  minor_units integer not null default 2 check (minor_units between 0 and 8),
  created_at timestamptz not null default now()
);

create table if not exists public.asset_types (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.account_types (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.operation_types (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  name text not null,
  affects_position boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.currencies (code, name, symbol, minor_units)
values
  ('RUB', 'Russian ruble', 'в‚Ѕ', 2),
  ('USD', 'US dollar', '$', 2),
  ('EUR', 'Euro', 'в‚¬', 2),
  ('CNY', 'Chinese yuan', 'ВҐ', 2),
  ('GBP', 'Pound sterling', 'ВЈ', 2),
  ('CHF', 'Swiss franc', 'Fr', 2),
  ('AED', 'UAE dirham', 'ШЇ.ШҐ', 2),
  ('TRY', 'Turkish lira', 'в‚є', 2)
on conflict (code) do update
set name = excluded.name,
    symbol = excluded.symbol,
    minor_units = excluded.minor_units;

insert into public.asset_types (code, name)
values
  ('cash', 'Cash'),
  ('stock', 'Stock'),
  ('bond', 'Bond'),
  ('fund', 'Fund'),
  ('etf', 'ETF'),
  ('crypto', 'Crypto asset'),
  ('derivative', 'Derivative'),
  ('real_estate', 'Real estate'),
  ('other', 'Other')
on conflict (code) do update
set name = excluded.name;

insert into public.account_types (code, name)
values
  ('brokerage', 'Brokerage account'),
  ('iis', 'Individual investment account'),
  ('bank', 'Bank account'),
  ('cash', 'Cash wallet'),
  ('crypto', 'Crypto wallet'),
  ('other', 'Other')
on conflict (code) do update
set name = excluded.name;

insert into public.operation_types (code, name, affects_position)
values
  ('buy', 'Buy', true),
  ('sell', 'Sell', true),
  ('dividend', 'Dividend', false),
  ('coupon', 'Coupon', false),
  ('tax', 'Tax', false),
  ('fee', 'Fee', false),
  ('deposit', 'Deposit', false),
  ('withdrawal', 'Withdrawal', false),
  ('transfer_in', 'Transfer in', true),
  ('transfer_out', 'Transfer out', true),
  ('split', 'Split', true),
  ('price_snapshot', 'Price snapshot', false),
  ('other', 'Other', false)
on conflict (code) do update
set name = excluded.name,
    affects_position = excluded.affects_position;

create table if not exists public.portfolios (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  base_currency text not null references public.currencies(code),
  status text not null default 'active' check (status in ('active', 'archived')),
  description text,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, family_id),
  unique (family_id, name)
);

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  portfolio_id uuid not null,
  account_type_code text not null references public.account_types(code),
  name text not null check (char_length(trim(name)) between 1 and 160),
  institution_name text,
  account_number_mask text,
  currency_code text not null references public.currencies(code),
  status text not null default 'active' check (status in ('active', 'closed', 'archived')),
  opened_on date,
  closed_on date,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, family_id),
  unique (family_id, portfolio_id, name),
  foreign key (portfolio_id, family_id)
    references public.portfolios(id, family_id)
    on delete cascade,
  check (closed_on is null or opened_on is null or closed_on >= opened_on)
);

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  asset_type_code text not null references public.asset_types(code),
  name text not null check (char_length(trim(name)) between 1 and 240),
  ticker text,
  isin text check (isin is null or isin ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'),
  market text,
  currency_code text references public.currencies(code),
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, family_id)
);

create unique index if not exists assets_family_identity_idx
  on public.assets (
    family_id,
    asset_type_code,
    lower(coalesce(isin, '')),
    lower(coalesce(ticker, '')),
    lower(coalesce(market, '')),
    coalesce(currency_code, ''),
    lower(name)
  );

create table if not exists public.imports (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  portfolio_id uuid not null,
  account_id uuid,
  original_file_name text not null,
  storage_bucket text not null default 'broker-reports',
  storage_object_key text,
  file_mime_type text,
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'uploaded'
    check (status in ('uploaded', 'parsing', 'parsed', 'applying', 'applied', 'failed', 'cancelled')),
  imported_by uuid not null references auth.users(id),
  started_at timestamptz,
  finished_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, family_id),
  unique (family_id, account_id, sha256),
  foreign key (portfolio_id, family_id)
    references public.portfolios(id, family_id)
    on delete cascade,
  foreign key (account_id, family_id)
    references public.accounts(id, family_id)
    on delete set null
);

create table if not exists public.import_rows (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  import_id uuid not null,
  row_number integer not null check (row_number > 0),
  raw_data jsonb not null,
  normalized_data jsonb,
  status text not null default 'raw'
    check (status in ('raw', 'normalized', 'skipped', 'applied', 'failed')),
  error_message text,
  created_entity_table text,
  created_entity_id uuid,
  created_at timestamptz not null default now(),
  unique (family_id, import_id, row_number),
  unique (id, family_id),
  foreign key (import_id, family_id)
    references public.imports(id, family_id)
    on delete cascade
);

create table if not exists public.operations (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  portfolio_id uuid not null,
  account_id uuid not null,
  asset_id uuid,
  operation_type_code text not null references public.operation_types(code),
  trade_date date not null,
  settle_date date,
  quantity numeric(28, 10),
  price numeric(28, 10),
  gross_amount numeric(28, 4),
  fee_amount numeric(28, 4) not null default 0,
  tax_amount numeric(28, 4) not null default 0,
  net_amount numeric(28, 4) not null,
  currency_code text not null references public.currencies(code),
  fx_rate_to_base numeric(28, 10) check (fx_rate_to_base is null or fx_rate_to_base > 0),
  source_import_id uuid,
  source_import_row_id uuid,
  notes text,
  occurred_at timestamptz,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, family_id),
  foreign key (portfolio_id, family_id)
    references public.portfolios(id, family_id)
    on delete cascade,
  foreign key (account_id, family_id)
    references public.accounts(id, family_id)
    on delete cascade,
  foreign key (asset_id, family_id)
    references public.assets(id, family_id)
    on delete restrict,
  foreign key (source_import_id, family_id)
    references public.imports(id, family_id)
    on delete set null,
  foreign key (source_import_row_id, family_id)
    references public.import_rows(id, family_id)
    on delete set null,
  check (settle_date is null or settle_date >= trade_date)
);

alter table public.import_rows
  add column if not exists created_operation_id uuid;

alter table public.import_rows
  drop constraint if exists import_rows_created_operation_family_fk;

alter table public.import_rows
  add constraint import_rows_created_operation_family_fk
  foreign key (created_operation_id, family_id)
  references public.operations(id, family_id)
  on delete set null;

create table if not exists public.position_snapshots (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  portfolio_id uuid not null,
  account_id uuid,
  asset_id uuid not null,
  snapshot_date date not null,
  quantity numeric(28, 10) not null,
  book_value_amount numeric(28, 4),
  market_value_amount numeric(28, 4),
  currency_code text not null references public.currencies(code),
  source text not null default 'calculated' check (source in ('calculated', 'imported', 'manual')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (family_id, portfolio_id, account_id, asset_id, snapshot_date, source),
  unique (id, family_id),
  foreign key (portfolio_id, family_id)
    references public.portfolios(id, family_id)
    on delete cascade,
  foreign key (account_id, family_id)
    references public.accounts(id, family_id)
    on delete cascade,
  foreign key (asset_id, family_id)
    references public.assets(id, family_id)
    on delete cascade
);

create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  portfolio_id uuid,
  title text not null check (char_length(trim(title)) between 1 and 240),
  body text,
  status text not null default 'open' check (status in ('draft', 'open', 'accepted', 'rejected', 'archived')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'critical')),
  due_on date,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, family_id),
  foreign key (portfolio_id, family_id)
    references public.portfolios(id, family_id)
    on delete cascade
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  portfolio_id uuid,
  asset_id uuid,
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_]{1,80}$'),
  title text not null check (char_length(trim(title)) between 1 and 240),
  event_date date not null,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (id, family_id),
  foreign key (portfolio_id, family_id)
    references public.portfolios(id, family_id)
    on delete cascade,
  foreign key (asset_id, family_id)
    references public.assets(id, family_id)
    on delete cascade
);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  portfolio_id uuid,
  asset_id uuid,
  title text not null check (char_length(trim(title)) between 1 and 240),
  condition_type text not null check (condition_type ~ '^[a-z][a-z0-9_]{1,80}$'),
  status text not null default 'active' check (status in ('active', 'triggered', 'paused', 'archived')),
  payload jsonb not null default '{}'::jsonb,
  triggered_at timestamptz,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, family_id),
  foreign key (portfolio_id, family_id)
    references public.portfolios(id, family_id)
    on delete cascade,
  foreign key (asset_id, family_id)
    references public.assets(id, family_id)
    on delete cascade
);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  actor_user_id uuid references auth.users(id),
  action text not null check (char_length(trim(action)) between 1 and 120),
  entity_table text not null check (char_length(trim(entity_table)) between 1 and 120),
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  request_id text,
  created_at timestamptz not null default now()
);

create index if not exists portfolios_family_status_idx
  on public.portfolios(family_id, status);
create index if not exists accounts_family_portfolio_idx
  on public.accounts(family_id, portfolio_id, status);
create index if not exists assets_family_type_idx
  on public.assets(family_id, asset_type_code, status);
create index if not exists operations_family_trade_date_idx
  on public.operations(family_id, trade_date desc);
create index if not exists operations_account_trade_date_idx
  on public.operations(account_id, trade_date desc);
create index if not exists operations_asset_trade_date_idx
  on public.operations(asset_id, trade_date desc);
create index if not exists imports_family_created_idx
  on public.imports(family_id, created_at desc);
create index if not exists import_rows_import_status_idx
  on public.import_rows(import_id, status, row_number);
create index if not exists position_snapshots_family_date_idx
  on public.position_snapshots(family_id, snapshot_date desc);
create index if not exists audit_log_family_created_idx
  on public.audit_log(family_id, created_at desc);

drop trigger if exists portfolios_set_updated_at on public.portfolios;
create trigger portfolios_set_updated_at
before update on public.portfolios
for each row execute function public.set_portfolio_updated_at();

drop trigger if exists accounts_set_updated_at on public.accounts;
create trigger accounts_set_updated_at
before update on public.accounts
for each row execute function public.set_portfolio_updated_at();

drop trigger if exists assets_set_updated_at on public.assets;
create trigger assets_set_updated_at
before update on public.assets
for each row execute function public.set_portfolio_updated_at();

drop trigger if exists imports_set_updated_at on public.imports;
create trigger imports_set_updated_at
before update on public.imports
for each row execute function public.set_portfolio_updated_at();

drop trigger if exists operations_set_updated_at on public.operations;
create trigger operations_set_updated_at
before update on public.operations
for each row execute function public.set_portfolio_updated_at();

drop trigger if exists recommendations_set_updated_at on public.recommendations;
create trigger recommendations_set_updated_at
before update on public.recommendations
for each row execute function public.set_portfolio_updated_at();

drop trigger if exists alerts_set_updated_at on public.alerts;
create trigger alerts_set_updated_at
before update on public.alerts
for each row execute function public.set_portfolio_updated_at();

alter table public.portfolios enable row level security;
alter table public.accounts enable row level security;
alter table public.assets enable row level security;
alter table public.imports enable row level security;
alter table public.import_rows enable row level security;
alter table public.operations enable row level security;
alter table public.position_snapshots enable row level security;
alter table public.recommendations enable row level security;
alter table public.events enable row level security;
alter table public.alerts enable row level security;
alter table public.audit_log enable row level security;

drop policy if exists portfolios_select_member on public.portfolios;
create policy portfolios_select_member
on public.portfolios for select
to authenticated
using (public.is_family_member(family_id));

drop policy if exists portfolios_insert_editor on public.portfolios;
create policy portfolios_insert_editor
on public.portfolios for insert
to authenticated
with check (
  public.has_family_role(family_id, array['admin', 'editor'])
  and created_by = auth.uid()
);

drop policy if exists portfolios_update_editor on public.portfolios;
create policy portfolios_update_editor
on public.portfolios for update
to authenticated
using (public.has_family_role(family_id, array['admin', 'editor']))
with check (public.has_family_role(family_id, array['admin', 'editor']));

drop policy if exists portfolios_delete_admin on public.portfolios;
create policy portfolios_delete_admin
on public.portfolios for delete
to authenticated
using (public.has_family_role(family_id, array['admin']));

drop policy if exists accounts_select_member on public.accounts;
create policy accounts_select_member
on public.accounts for select
to authenticated
using (public.is_family_member(family_id));

drop policy if exists accounts_insert_editor on public.accounts;
create policy accounts_insert_editor
on public.accounts for insert
to authenticated
with check (
  public.has_family_role(family_id, array['admin', 'editor'])
  and created_by = auth.uid()
);

drop policy if exists accounts_update_editor on public.accounts;
create policy accounts_update_editor
on public.accounts for update
to authenticated
using (public.has_family_role(family_id, array['admin', 'editor']))
with check (public.has_family_role(family_id, array['admin', 'editor']));

drop policy if exists accounts_delete_admin on public.accounts;
create policy accounts_delete_admin
on public.accounts for delete
to authenticated
using (public.has_family_role(family_id, array['admin']));

drop policy if exists assets_select_member on public.assets;
create policy assets_select_member
on public.assets for select
to authenticated
using (public.is_family_member(family_id));

drop policy if exists assets_insert_editor on public.assets;
create policy assets_insert_editor
on public.assets for insert
to authenticated
with check (
  public.has_family_role(family_id, array['admin', 'editor'])
  and created_by = auth.uid()
);

drop policy if exists assets_update_editor on public.assets;
create policy assets_update_editor
on public.assets for update
to authenticated
using (public.has_family_role(family_id, array['admin', 'editor']))
with check (public.has_family_role(family_id, array['admin', 'editor']));

drop policy if exists assets_delete_admin on public.assets;
create policy assets_delete_admin
on public.assets for delete
to authenticated
using (public.has_family_role(family_id, array['admin']));

drop policy if exists imports_select_member on public.imports;
create policy imports_select_member
on public.imports for select
to authenticated
using (public.is_family_member(family_id));

drop policy if exists imports_insert_editor on public.imports;
create policy imports_insert_editor
on public.imports for insert
to authenticated
with check (
  public.has_family_role(family_id, array['admin', 'editor'])
  and imported_by = auth.uid()
);

drop policy if exists imports_update_editor on public.imports;
create policy imports_update_editor
on public.imports for update
to authenticated
using (public.has_family_role(family_id, array['admin', 'editor']))
with check (public.has_family_role(family_id, array['admin', 'editor']));

drop policy if exists imports_delete_admin on public.imports;
create policy imports_delete_admin
on public.imports for delete
to authenticated
using (public.has_family_role(family_id, array['admin']));

drop policy if exists import_rows_select_member on public.import_rows;
create policy import_rows_select_member
on public.import_rows for select
to authenticated
using (public.is_family_member(family_id));

drop policy if exists import_rows_insert_editor on public.import_rows;
create policy import_rows_insert_editor
on public.import_rows for insert
to authenticated
with check (public.has_family_role(family_id, array['admin', 'editor']));

drop policy if exists import_rows_update_editor on public.import_rows;
create policy import_rows_update_editor
on public.import_rows for update
to authenticated
using (public.has_family_role(family_id, array['admin', 'editor']))
with check (public.has_family_role(family_id, array['admin', 'editor']));

drop policy if exists import_rows_delete_admin on public.import_rows;
create policy import_rows_delete_admin
on public.import_rows for delete
to authenticated
using (public.has_family_role(family_id, array['admin']));

drop policy if exists operations_select_member on public.operations;
create policy operations_select_member
on public.operations for select
to authenticated
using (public.is_family_member(family_id));

drop policy if exists operations_insert_editor on public.operations;
create policy operations_insert_editor
on public.operations for insert
to authenticated
with check (
  public.has_family_role(family_id, array['admin', 'editor'])
  and created_by = auth.uid()
);

drop policy if exists operations_update_editor on public.operations;
create policy operations_update_editor
on public.operations for update
to authenticated
using (public.has_family_role(family_id, array['admin', 'editor']))
with check (public.has_family_role(family_id, array['admin', 'editor']));

drop policy if exists operations_delete_admin on public.operations;
create policy operations_delete_admin
on public.operations for delete
to authenticated
using (public.has_family_role(family_id, array['admin']));

drop policy if exists position_snapshots_select_member on public.position_snapshots;
create policy position_snapshots_select_member
on public.position_snapshots for select
to authenticated
using (public.is_family_member(family_id));

drop policy if exists position_snapshots_insert_editor on public.position_snapshots;
create policy position_snapshots_insert_editor
on public.position_snapshots for insert
to authenticated
with check (public.has_family_role(family_id, array['admin', 'editor']));

drop policy if exists position_snapshots_update_editor on public.position_snapshots;
create policy position_snapshots_update_editor
on public.position_snapshots for update
to authenticated
using (public.has_family_role(family_id, array['admin', 'editor']))
with check (public.has_family_role(family_id, array['admin', 'editor']));

drop policy if exists position_snapshots_delete_admin on public.position_snapshots;
create policy position_snapshots_delete_admin
on public.position_snapshots for delete
to authenticated
using (public.has_family_role(family_id, array['admin']));

drop policy if exists recommendations_select_member on public.recommendations;
create policy recommendations_select_member
on public.recommendations for select
to authenticated
using (public.is_family_member(family_id));

drop policy if exists recommendations_insert_editor on public.recommendations;
create policy recommendations_insert_editor
on public.recommendations for insert
to authenticated
with check (
  public.has_family_role(family_id, array['admin', 'editor'])
  and created_by = auth.uid()
);

drop policy if exists recommendations_update_editor on public.recommendations;
create policy recommendations_update_editor
on public.recommendations for update
to authenticated
using (public.has_family_role(family_id, array['admin', 'editor']))
with check (public.has_family_role(family_id, array['admin', 'editor']));

drop policy if exists recommendations_delete_admin on public.recommendations;
create policy recommendations_delete_admin
on public.recommendations for delete
to authenticated
using (public.has_family_role(family_id, array['admin']));

drop policy if exists events_select_member on public.events;
create policy events_select_member
on public.events for select
to authenticated
using (public.is_family_member(family_id));

drop policy if exists events_insert_editor on public.events;
create policy events_insert_editor
on public.events for insert
to authenticated
with check (public.has_family_role(family_id, array['admin', 'editor']));

drop policy if exists events_update_editor on public.events;
create policy events_update_editor
on public.events for update
to authenticated
using (public.has_family_role(family_id, array['admin', 'editor']))
with check (public.has_family_role(family_id, array['admin', 'editor']));

drop policy if exists events_delete_admin on public.events;
create policy events_delete_admin
on public.events for delete
to authenticated
using (public.has_family_role(family_id, array['admin']));

drop policy if exists alerts_select_member on public.alerts;
create policy alerts_select_member
on public.alerts for select
to authenticated
using (public.is_family_member(family_id));

drop policy if exists alerts_insert_editor on public.alerts;
create policy alerts_insert_editor
on public.alerts for insert
to authenticated
with check (
  public.has_family_role(family_id, array['admin', 'editor'])
  and created_by = auth.uid()
);

drop policy if exists alerts_update_editor on public.alerts;
create policy alerts_update_editor
on public.alerts for update
to authenticated
using (public.has_family_role(family_id, array['admin', 'editor']))
with check (public.has_family_role(family_id, array['admin', 'editor']));

drop policy if exists alerts_delete_admin on public.alerts;
create policy alerts_delete_admin
on public.alerts for delete
to authenticated
using (public.has_family_role(family_id, array['admin']));

drop policy if exists audit_log_select_editor on public.audit_log;
create policy audit_log_select_editor
on public.audit_log for select
to authenticated
using (public.has_family_role(family_id, array['admin', 'editor']));

drop policy if exists audit_log_insert_editor on public.audit_log;
create policy audit_log_insert_editor
on public.audit_log for insert
to authenticated
with check (
  public.has_family_role(family_id, array['admin', 'editor'])
  and (actor_user_id is null or actor_user_id = auth.uid())
);

grant select on
  public.currencies,
  public.asset_types,
  public.account_types,
  public.operation_types
to authenticated;

grant select, insert, update, delete on
  public.portfolios,
  public.accounts,
  public.assets,
  public.imports,
  public.import_rows,
  public.operations,
  public.position_snapshots,
  public.recommendations,
  public.events,
  public.alerts
to authenticated;

grant select, insert on public.audit_log to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'broker-reports',
  'broker-reports',
  false,
  52428800,
  array[
    'application/pdf',
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists broker_reports_select_member on storage.objects;
create policy broker_reports_select_member
on storage.objects for select
to authenticated
using (
  bucket_id = 'broker-reports'
  and name ~ '^families/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/imports/'
  and public.is_family_member(((storage.foldername(name))[2])::uuid)
);

drop policy if exists broker_reports_insert_editor on storage.objects;
create policy broker_reports_insert_editor
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'broker-reports'
  and name ~ '^families/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/imports/'
  and public.has_family_role(((storage.foldername(name))[2])::uuid, array['admin', 'editor'])
);

drop policy if exists broker_reports_update_editor on storage.objects;
create policy broker_reports_update_editor
on storage.objects for update
to authenticated
using (
  bucket_id = 'broker-reports'
  and name ~ '^families/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/imports/'
  and public.has_family_role(((storage.foldername(name))[2])::uuid, array['admin', 'editor'])
)
with check (
  bucket_id = 'broker-reports'
  and name ~ '^families/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/imports/'
  and public.has_family_role(((storage.foldername(name))[2])::uuid, array['admin', 'editor'])
);

drop policy if exists broker_reports_delete_admin on storage.objects;
create policy broker_reports_delete_admin
on storage.objects for delete
to authenticated
using (
  bucket_id = 'broker-reports'
  and name ~ '^families/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/imports/'
  and public.has_family_role(((storage.foldername(name))[2])::uuid, array['admin'])
);

commit;

