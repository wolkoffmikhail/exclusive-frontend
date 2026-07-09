\set ON_ERROR_STOP on

begin;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  :'admin_user_id',
  true
);

select 1 / (
  (select count(*) from public.families where id = :'family_id') = 1
)::int as admin_can_read_family;

select 1 / (
  (select role from public.family_members where family_id = :'family_id') = 'admin'
)::int as seeded_role_is_admin;

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000001',
  true
);

select 1 / (
  (select count(*) from public.families where id = :'family_id') = 0
)::int as unrelated_user_cannot_read_family;

select 1 / (
  (select count(*) from public.family_members where family_id = :'family_id') = 0
)::int as unrelated_user_cannot_read_membership;

rollback;
