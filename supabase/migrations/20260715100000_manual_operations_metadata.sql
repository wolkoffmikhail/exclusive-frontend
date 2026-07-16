begin;

alter table public.operations
  add column if not exists source text not null default 'manual'
    check (source in ('manual', 'import', 'system')),
  add column if not exists operation_group_id uuid,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id),
  add column if not exists cancellation_reason text;

update public.operations
set source = 'import'
where source_import_id is not null
  and source <> 'import';

create index if not exists operations_family_source_idx
  on public.operations(family_id, source, trade_date desc);

create index if not exists operations_group_idx
  on public.operations(operation_group_id)
  where operation_group_id is not null;

create index if not exists operations_active_account_date_idx
  on public.operations(account_id, trade_date desc)
  where cancelled_at is null;

commit;
