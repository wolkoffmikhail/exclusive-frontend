\set ON_ERROR_STOP on

begin;

with upserted_portfolio as (
  insert into public.portfolios (
    family_id,
    name,
    base_currency,
    description,
    created_by,
    updated_by
  )
  values (
    :'family_id',
    'Основной портфель',
    'RUB',
    'Стартовый портфель MVP для семейного инвестиционного учета.',
    :'admin_user_id',
    :'admin_user_id'
  )
  on conflict (family_id, name) do update
  set base_currency = excluded.base_currency,
      description = excluded.description,
      updated_by = excluded.updated_by
  returning id
)
select id as portfolio_id
from upserted_portfolio
union all
select id
from public.portfolios
where family_id = :'family_id'
  and name = 'Основной портфель'
limit 1
\gset

insert into public.accounts (
  family_id,
  portfolio_id,
  account_type_code,
  name,
  institution_name,
  currency_code,
  created_by,
  updated_by
)
values
  (
    :'family_id',
    :'portfolio_id',
    'brokerage',
    'Брокерский счёт',
    'Основной брокер',
    'RUB',
    :'admin_user_id',
    :'admin_user_id'
  ),
  (
    :'family_id',
    :'portfolio_id',
    'bank',
    'Банковский счёт',
    'Основной банк',
    'RUB',
    :'admin_user_id',
    :'admin_user_id'
  )
on conflict (family_id, portfolio_id, name) do update
set institution_name = excluded.institution_name,
    currency_code = excluded.currency_code,
    updated_by = excluded.updated_by;

insert into public.assets (
  family_id,
  asset_type_code,
  name,
  ticker,
  market,
  currency_code,
  created_by,
  updated_by
)
select
  :'family_id',
  seed.asset_type_code,
  seed.name,
  seed.ticker,
  seed.market,
  seed.currency_code,
  :'admin_user_id',
  :'admin_user_id'
from (
  values
    ('cash', 'Российский рубль', 'RUB', 'CASH', 'RUB'),
    ('cash', 'Доллар США', 'USD', 'CASH', 'USD'),
    ('stock', 'Демо-акция', 'DEMO', 'TEST', 'RUB')
) as seed(asset_type_code, name, ticker, market, currency_code)
where not exists (
  select 1
  from public.assets a
  where a.family_id = :'family_id'
    and a.asset_type_code = seed.asset_type_code
    and lower(coalesce(a.ticker, '')) = lower(coalesce(seed.ticker, ''))
    and lower(coalesce(a.market, '')) = lower(coalesce(seed.market, ''))
    and coalesce(a.currency_code, '') = coalesce(seed.currency_code, '')
    and lower(a.name) = lower(seed.name)
);

insert into public.audit_log (
  family_id,
  actor_user_id,
  action,
  entity_table,
  after_data
)
values (
  :'family_id',
  :'admin_user_id',
  'seed_mvp_domain',
  'portfolio_domain',
  jsonb_build_object(
    'portfolio_name', 'Основной портфель',
    'accounts', jsonb_build_array('Брокерский счёт', 'Банковский счёт'),
    'assets', jsonb_build_array('Российский рубль', 'Доллар США', 'Демо-акция')
  )
);

commit;
