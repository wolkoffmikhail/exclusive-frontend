\set ON_ERROR_STOP on

begin;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_user_id', true);

insert into public.portfolios (
  family_id,
  name,
  base_currency,
  created_by
)
values (
  :'family_id',
  'RLS smoke portfolio',
  'RUB',
  :'admin_user_id'
)
returning id as portfolio_id \gset

insert into public.accounts (
  family_id,
  portfolio_id,
  account_type_code,
  name,
  institution_name,
  currency_code,
  created_by
)
values (
  :'family_id',
  :'portfolio_id',
  'brokerage',
  'RLS smoke broker account',
  'Smoke Broker',
  'RUB',
  :'admin_user_id'
)
returning id as account_id \gset

insert into public.assets (
  family_id,
  asset_type_code,
  name,
  ticker,
  market,
  currency_code,
  created_by
)
values (
  :'family_id',
  'stock',
  'RLS Smoke Asset',
  'SMOKE',
  'TEST',
  'RUB',
  :'admin_user_id'
)
returning id as asset_id \gset

insert into public.operations (
  family_id,
  portfolio_id,
  account_id,
  asset_id,
  operation_type_code,
  trade_date,
  quantity,
  price,
  gross_amount,
  net_amount,
  currency_code,
  created_by
)
values (
  :'family_id',
  :'portfolio_id',
  :'account_id',
  :'asset_id',
  'buy',
  current_date,
  1,
  100,
  100,
  100,
  'RUB',
  :'admin_user_id'
);

select 1 / (
  (select count(*) from public.portfolios where family_id = :'family_id' and name = 'RLS smoke portfolio') = 1
)::int as admin_can_read_portfolio;

select 1 / (
  (select count(*) from public.operations where family_id = :'family_id') >= 1
)::int as admin_can_read_operations;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);

select 1 / (
  (select count(*) from public.portfolios where family_id = :'family_id' and name = 'RLS smoke portfolio') = 0
)::int as unrelated_user_cannot_read_portfolio;

select 1 / (
  (select count(*) from public.operations where family_id = :'family_id') = 0
)::int as unrelated_user_cannot_read_operations;

rollback;
