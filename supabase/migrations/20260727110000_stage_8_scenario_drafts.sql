begin;

create table if not exists public.scenario_drafts (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id),
  title text not null check (char_length(trim(title)) between 1 and 200),
  status text not null default 'draft' check (status in ('draft', 'archived')),
  scenario_type text not null check (scenario_type in ('buy', 'sell')),
  account_id uuid not null,
  asset_id uuid not null,
  trade_date date not null,
  quantity numeric(28, 10) not null check (quantity > 0),
  price numeric(28, 10) not null check (price > 0),
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  commission numeric(28, 10) not null default 0 check (commission >= 0),
  source_recommendation_id uuid,
  input_payload jsonb not null default '{}'::jsonb,
  result_snapshot jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, family_id),
  foreign key (account_id, family_id) references public.accounts(id, family_id) on delete cascade,
  foreign key (asset_id, family_id) references public.assets(id, family_id) on delete cascade,
  foreign key (source_recommendation_id, family_id) references public.recommendations(id, family_id) on delete set null
);

create index if not exists scenario_drafts_family_status_updated_idx
  on public.scenario_drafts(family_id, status, updated_at desc);

create index if not exists scenario_drafts_family_asset_idx
  on public.scenario_drafts(family_id, asset_id, status);

drop trigger if exists scenario_drafts_set_updated_at on public.scenario_drafts;
create trigger scenario_drafts_set_updated_at
before update on public.scenario_drafts
for each row execute function public.set_portfolio_updated_at();

alter table public.scenario_drafts enable row level security;

drop policy if exists scenario_drafts_select_member on public.scenario_drafts;
create policy scenario_drafts_select_member
on public.scenario_drafts for select
to authenticated
using (public.is_family_member(family_id));

drop policy if exists scenario_drafts_insert_editor on public.scenario_drafts;
create policy scenario_drafts_insert_editor
on public.scenario_drafts for insert
to authenticated
with check (
  public.has_family_role(family_id, array['admin', 'editor'])
  and owner_user_id = auth.uid()
  and created_by = auth.uid()
);

drop policy if exists scenario_drafts_update_editor on public.scenario_drafts;
create policy scenario_drafts_update_editor
on public.scenario_drafts for update
to authenticated
using (public.has_family_role(family_id, array['admin', 'editor']))
with check (
  public.has_family_role(family_id, array['admin', 'editor'])
  and (updated_by is null or updated_by = auth.uid())
);

drop policy if exists scenario_drafts_delete_admin on public.scenario_drafts;
create policy scenario_drafts_delete_admin
on public.scenario_drafts for delete
to authenticated
using (public.has_family_role(family_id, array['admin']));

grant select, insert, update, delete on public.scenario_drafts to authenticated;

commit;
