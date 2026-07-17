begin;

alter table public.recommendations
  add column if not exists recommendation_type text not null default 'manual'
    check (recommendation_type ~ '^[a-z][a-z0-9_]{1,80}$'),
  add column if not exists reason text,
  add column if not exists source text not null default 'manual'
    check (source in ('manual', 'rule_based', 'imported', 'external')),
  add column if not exists confidence numeric(5, 4)
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  add column if not exists metrics jsonb not null default '{}'::jsonb,
  add column if not exists fingerprint text,
  add column if not exists last_generated_at timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists rejected_at timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists status_changed_by uuid references auth.users(id);

create unique index if not exists recommendations_family_fingerprint_open_idx
  on public.recommendations (family_id, fingerprint)
  where fingerprint is not null and status in ('draft', 'open');

create table if not exists public.recommendation_links (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  recommendation_id uuid not null,
  entity_table text not null check (entity_table in ('assets', 'accounts', 'portfolios', 'operations', 'events', 'news_items')),
  entity_id uuid not null,
  relation_type text not null default 'related' check (relation_type ~ '^[a-z][a-z0-9_]{1,80}$'),
  created_at timestamptz not null default now(),
  unique (family_id, recommendation_id, entity_table, entity_id, relation_type),
  unique (id, family_id),
  foreign key (recommendation_id, family_id)
    references public.recommendations(id, family_id)
    on delete cascade
);

create table if not exists public.recommendation_reads (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  recommendation_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  unique (family_id, recommendation_id, user_id),
  unique (id, family_id),
  foreign key (recommendation_id, family_id)
    references public.recommendations(id, family_id)
    on delete cascade
);

create table if not exists public.news_items (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  asset_id uuid,
  source text not null check (char_length(trim(source)) between 1 and 120),
  external_id text,
  kind text not null default 'portfolio_news' check (kind in ('portfolio_news', 'market_news', 'idea')),
  title text not null check (char_length(trim(title)) between 1 and 300),
  summary text,
  url text,
  published_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (id, family_id),
  foreign key (asset_id, family_id)
    references public.assets(id, family_id)
    on delete set null
);

create unique index if not exists news_items_family_source_external_idx
  on public.news_items (family_id, source, external_id)
  where external_id is not null;

create unique index if not exists news_items_family_url_idx
  on public.news_items (family_id, lower(url))
  where url is not null;

create table if not exists public.watchlist_items (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  item_type text not null check (item_type in ('asset', 'news', 'idea', 'recommendation')),
  asset_id uuid,
  news_item_id uuid,
  recommendation_id uuid,
  title text not null check (char_length(trim(title)) between 1 and 300),
  notes text,
  status text not null default 'watching' check (status in ('watching', 'considering', 'done', 'archived')),
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, family_id),
  foreign key (asset_id, family_id)
    references public.assets(id, family_id)
    on delete cascade,
  foreign key (news_item_id, family_id)
    references public.news_items(id, family_id)
    on delete cascade,
  foreign key (recommendation_id, family_id)
    references public.recommendations(id, family_id)
    on delete cascade,
  check (
    (item_type = 'asset' and asset_id is not null and news_item_id is null and recommendation_id is null)
    or (item_type in ('news', 'idea') and news_item_id is not null and asset_id is null and recommendation_id is null)
    or (item_type = 'recommendation' and recommendation_id is not null and asset_id is null and news_item_id is null)
  )
);

create unique index if not exists watchlist_items_family_asset_active_idx
  on public.watchlist_items (family_id, asset_id)
  where item_type = 'asset' and status <> 'archived';

create unique index if not exists watchlist_items_family_news_active_idx
  on public.watchlist_items (family_id, news_item_id)
  where item_type in ('news', 'idea') and status <> 'archived';

create unique index if not exists watchlist_items_family_recommendation_active_idx
  on public.watchlist_items (family_id, recommendation_id)
  where item_type = 'recommendation' and status <> 'archived';

alter table public.events
  add column if not exists status text not null default 'scheduled'
    check (status in ('scheduled', 'done', 'cancelled')),
  add column if not exists amount numeric(28, 4),
  add column if not exists currency_code text references public.currencies(code),
  add column if not exists source text not null default 'manual'
    check (source in ('manual', 'import', 'external', 'calculated')),
  add column if not exists external_id text,
  add column if not exists updated_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists events_family_source_external_idx
  on public.events (family_id, source, external_id)
  where external_id is not null;

create table if not exists public.limits (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  limit_type text not null check (limit_type in ('asset_share', 'asset_class_share', 'currency_share', 'cash_min_share', 'cash_max_share')),
  scope_key text,
  threshold_value numeric(12, 8) not null check (threshold_value >= 0),
  direction text not null check (direction in ('min', 'max')),
  severity text not null default 'warning' check (severity in ('info', 'warning', 'critical')),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, family_id)
);

create unique index if not exists limits_family_active_scope_idx
  on public.limits (family_id, limit_type, coalesce(scope_key, ''), direction)
  where status = 'active';

alter table public.alerts
  add column if not exists severity text not null default 'warning'
    check (severity in ('info', 'warning', 'critical')),
  add column if not exists fingerprint text,
  add column if not exists resolved_at timestamptz,
  add column if not exists last_checked_at timestamptz,
  add column if not exists source text not null default 'manual'
    check (source in ('manual', 'analytics', 'limits', 'recommendations', 'external'));

create unique index if not exists alerts_family_active_fingerprint_idx
  on public.alerts (family_id, fingerprint)
  where fingerprint is not null and status in ('active', 'triggered');

create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  channel text not null check (channel in ('telegram')),
  status text not null default 'disabled' check (status in ('enabled', 'disabled')),
  settings jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, channel),
  unique (id, family_id)
);

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  alert_id uuid,
  channel text not null check (channel in ('telegram')),
  status text not null check (status in ('pending', 'sent', 'failed', 'skipped')),
  error_message text,
  payload jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, family_id),
  foreign key (alert_id, family_id)
    references public.alerts(id, family_id)
    on delete set null
);

drop trigger if exists watchlist_items_set_updated_at on public.watchlist_items;
create trigger watchlist_items_set_updated_at
before update on public.watchlist_items
for each row execute function public.set_portfolio_updated_at();

drop trigger if exists events_set_updated_at on public.events;
create trigger events_set_updated_at
before update on public.events
for each row execute function public.set_portfolio_updated_at();

drop trigger if exists limits_set_updated_at on public.limits;
create trigger limits_set_updated_at
before update on public.limits
for each row execute function public.set_portfolio_updated_at();

drop trigger if exists notification_preferences_set_updated_at on public.notification_preferences;
create trigger notification_preferences_set_updated_at
before update on public.notification_preferences
for each row execute function public.set_portfolio_updated_at();

alter table public.recommendation_links enable row level security;
alter table public.recommendation_reads enable row level security;
alter table public.news_items enable row level security;
alter table public.watchlist_items enable row level security;
alter table public.limits enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notification_deliveries enable row level security;

drop policy if exists recommendation_links_select_member on public.recommendation_links;
create policy recommendation_links_select_member
on public.recommendation_links for select
to authenticated
using (public.is_family_member(family_id));

drop policy if exists recommendation_links_insert_editor on public.recommendation_links;
create policy recommendation_links_insert_editor
on public.recommendation_links for insert
to authenticated
with check (public.has_family_role(family_id, array['admin', 'editor']));

drop policy if exists recommendation_links_delete_editor on public.recommendation_links;
create policy recommendation_links_delete_editor
on public.recommendation_links for delete
to authenticated
using (public.has_family_role(family_id, array['admin', 'editor']));

drop policy if exists recommendation_reads_select_member on public.recommendation_reads;
create policy recommendation_reads_select_member
on public.recommendation_reads for select
to authenticated
using (public.is_family_member(family_id));

drop policy if exists recommendation_reads_insert_self on public.recommendation_reads;
create policy recommendation_reads_insert_self
on public.recommendation_reads for insert
to authenticated
with check (public.is_family_member(family_id) and user_id = auth.uid());

drop policy if exists recommendation_reads_update_self on public.recommendation_reads;
create policy recommendation_reads_update_self
on public.recommendation_reads for update
to authenticated
using (public.is_family_member(family_id) and user_id = auth.uid())
with check (public.is_family_member(family_id) and user_id = auth.uid());

drop policy if exists news_items_select_member on public.news_items;
create policy news_items_select_member
on public.news_items for select
to authenticated
using (public.is_family_member(family_id));

drop policy if exists news_items_insert_editor on public.news_items;
create policy news_items_insert_editor
on public.news_items for insert
to authenticated
with check (public.has_family_role(family_id, array['admin', 'editor']));

drop policy if exists news_items_update_editor on public.news_items;
create policy news_items_update_editor
on public.news_items for update
to authenticated
using (public.has_family_role(family_id, array['admin', 'editor']))
with check (public.has_family_role(family_id, array['admin', 'editor']));

drop policy if exists news_items_delete_admin on public.news_items;
create policy news_items_delete_admin
on public.news_items for delete
to authenticated
using (public.has_family_role(family_id, array['admin']));

drop policy if exists watchlist_items_select_member on public.watchlist_items;
create policy watchlist_items_select_member
on public.watchlist_items for select
to authenticated
using (public.is_family_member(family_id));

drop policy if exists watchlist_items_insert_editor on public.watchlist_items;
create policy watchlist_items_insert_editor
on public.watchlist_items for insert
to authenticated
with check (
  public.has_family_role(family_id, array['admin', 'editor'])
  and created_by = auth.uid()
);

drop policy if exists watchlist_items_update_editor on public.watchlist_items;
create policy watchlist_items_update_editor
on public.watchlist_items for update
to authenticated
using (public.has_family_role(family_id, array['admin', 'editor']))
with check (public.has_family_role(family_id, array['admin', 'editor']));

drop policy if exists watchlist_items_delete_admin on public.watchlist_items;
create policy watchlist_items_delete_admin
on public.watchlist_items for delete
to authenticated
using (public.has_family_role(family_id, array['admin']));

drop policy if exists limits_select_member on public.limits;
create policy limits_select_member
on public.limits for select
to authenticated
using (public.is_family_member(family_id));

drop policy if exists limits_insert_admin on public.limits;
create policy limits_insert_admin
on public.limits for insert
to authenticated
with check (
  public.has_family_role(family_id, array['admin'])
  and created_by = auth.uid()
);

drop policy if exists limits_update_admin on public.limits;
create policy limits_update_admin
on public.limits for update
to authenticated
using (public.has_family_role(family_id, array['admin']))
with check (public.has_family_role(family_id, array['admin']));

drop policy if exists limits_delete_admin on public.limits;
create policy limits_delete_admin
on public.limits for delete
to authenticated
using (public.has_family_role(family_id, array['admin']));

drop policy if exists notification_preferences_select_member on public.notification_preferences;
create policy notification_preferences_select_member
on public.notification_preferences for select
to authenticated
using (public.is_family_member(family_id));

drop policy if exists notification_preferences_insert_admin on public.notification_preferences;
create policy notification_preferences_insert_admin
on public.notification_preferences for insert
to authenticated
with check (
  public.has_family_role(family_id, array['admin'])
  and created_by = auth.uid()
);

drop policy if exists notification_preferences_update_admin on public.notification_preferences;
create policy notification_preferences_update_admin
on public.notification_preferences for update
to authenticated
using (public.has_family_role(family_id, array['admin']))
with check (public.has_family_role(family_id, array['admin']));

drop policy if exists notification_deliveries_select_member on public.notification_deliveries;
create policy notification_deliveries_select_member
on public.notification_deliveries for select
to authenticated
using (public.is_family_member(family_id));

drop policy if exists notification_deliveries_insert_editor on public.notification_deliveries;
create policy notification_deliveries_insert_editor
on public.notification_deliveries for insert
to authenticated
with check (public.has_family_role(family_id, array['admin', 'editor']));

commit;
