\set ON_ERROR_STOP on

begin;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_user_id', true);

insert into public.family_members (family_id, user_id, role, created_by)
values
  (:'family_id', :'editor_user_id', 'editor', :'admin_user_id'),
  (:'family_id', :'viewer_user_id', 'viewer', :'admin_user_id')
on conflict (family_id, user_id) do update
set role = excluded.role;

insert into public.recommendations (
  family_id,
  title,
  body,
  recommendation_type,
  reason,
  source,
  metrics,
  fingerprint,
  created_by
)
values (
  :'family_id',
  'Stage 5 RLS recommendation',
  'RLS smoke recommendation',
  'manual',
  'rls smoke',
  'manual',
  '{}'::jsonb,
  'stage-5-rls-recommendation',
  :'admin_user_id'
)
returning id as recommendation_id \gset

insert into public.news_items (
  family_id,
  source,
  external_id,
  kind,
  title,
  summary,
  published_at,
  payload
)
values (
  :'family_id',
  'rls-smoke',
  'stage-5-rls-news',
  'market_news',
  'Stage 5 RLS news',
  'RLS smoke news',
  now(),
  '{}'::jsonb
)
returning id as news_item_id \gset

insert into public.limits (
  family_id,
  limit_type,
  scope_key,
  threshold_value,
  direction,
  severity,
  created_by
)
values (
  :'family_id',
  'cash_min_share',
  null,
  0.05,
  'min',
  'warning',
  :'admin_user_id'
)
returning id as limit_id \gset

insert into public.notification_preferences (
  family_id,
  channel,
  status,
  settings,
  created_by
)
values (
  :'family_id',
  'telegram',
  'disabled',
  '{}'::jsonb,
  :'admin_user_id'
)
returning id as notification_preference_id \gset

select 1 / (
  (select count(*) from public.news_items where id = :'news_item_id') = 1
)::int as admin_can_read_stage_5_news;

select set_config('request.jwt.claim.sub', :'editor_user_id', true);

insert into public.watchlist_items (
  family_id,
  item_type,
  news_item_id,
  title,
  created_by
)
values (
  :'family_id',
  'news',
  :'news_item_id',
  'Stage 5 RLS watchlist',
  :'editor_user_id'
)
returning id as watchlist_item_id \gset

insert into public.recommendation_reads (
  family_id,
  recommendation_id,
  user_id
)
values (
  :'family_id',
  :'recommendation_id',
  :'editor_user_id'
);

select 1 / (
  (select count(*) from public.watchlist_items where id = :'watchlist_item_id') = 1
)::int as editor_can_create_watchlist_item;

select 1 / (
  (select count(*) from public.limits where id = :'limit_id') = 1
)::int as editor_can_read_limits;

select set_config('request.jwt.claim.sub', :'viewer_user_id', true);

select 1 / (
  (select count(*) from public.news_items where id = :'news_item_id') = 1
)::int as viewer_can_read_news;

select 1 / (
  (select count(*) from public.limits where id = :'limit_id') = 1
)::int as viewer_can_read_limits;

select 1 / (
  (select count(*) from public.notification_preferences where id = :'notification_preference_id') = 1
)::int as viewer_can_read_notification_preferences;

insert into public.recommendation_reads (
  family_id,
  recommendation_id,
  user_id
)
values (
  :'family_id',
  :'recommendation_id',
  :'viewer_user_id'
);

select 1 / (
  (select count(*) from public.recommendation_reads where recommendation_id = :'recommendation_id' and user_id = :'viewer_user_id') = 1
)::int as viewer_can_mark_own_recommendation_read;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);

select 1 / (
  (select count(*) from public.news_items where id = :'news_item_id') = 0
)::int as unrelated_user_cannot_read_news;

select 1 / (
  (select count(*) from public.watchlist_items where id = :'watchlist_item_id') = 0
)::int as unrelated_user_cannot_read_watchlist;

rollback;
