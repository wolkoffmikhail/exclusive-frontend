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

insert into public.news_sources (
  family_id,
  source_code,
  source_name,
  source_type,
  base_url,
  terms_status,
  created_by
)
values (
  :'family_id',
  'stage_7_rls_manual',
  'Stage 7 RLS manual',
  'manual',
  null,
  'approved',
  :'admin_user_id'
)
returning id as source_id \gset

insert into public.source_documents (
  family_id,
  source_id,
  external_id,
  title,
  document_type,
  trust_level,
  content_hash
)
values (
  :'family_id',
  :'source_id',
  'stage-7-rls-document',
  'Stage 7 RLS document',
  'news',
  'manual',
  'stage-7-rls-hash'
)
returning id as source_document_id \gset

insert into public.assets (
  family_id,
  asset_type_code,
  name,
  ticker,
  isin,
  market,
  currency_code,
  created_by
)
values (
  :'family_id',
  'stock',
  'Stage 7 RLS asset',
  'S7RLS',
  'RU0000000000',
  'TEST',
  'RUB',
  :'admin_user_id'
)
returning id as linked_asset_id \gset

insert into public.issuer_aliases (
  family_id,
  asset_id,
  alias,
  created_by
)
values (
  :'family_id',
  :'linked_asset_id',
  'Stage 7 RLS issuer alias',
  :'admin_user_id'
)
returning id as issuer_alias_id \gset

insert into public.source_document_links (
  family_id,
  source_document_id,
  asset_id,
  link_type,
  confidence,
  created_by
)
values (
  :'family_id',
  :'source_document_id',
  :'linked_asset_id',
  'manual',
  1,
  :'admin_user_id'
)
returning id as source_document_link_id \gset

insert into public.llm_analyses (
  family_id,
  source_document_id,
  analysis_type,
  prompt_version,
  status,
  summary,
  confidence,
  created_by
)
values (
  :'family_id',
  :'source_document_id',
  'summary',
  'stage7-rls-v1',
  'ready',
  'RLS smoke analysis',
  0.7,
  :'admin_user_id'
)
returning id as llm_analysis_id \gset

select set_config('request.jwt.claim.sub', :'editor_user_id', true);

insert into public.source_documents (
  family_id,
  source_id,
  external_id,
  title,
  document_type,
  trust_level,
  content_hash
)
values (
  :'family_id',
  :'source_id',
  'stage-7-rls-editor-document',
  'Stage 7 RLS editor document',
  'news',
  'manual',
  'stage-7-rls-editor-hash'
)
returning id as editor_source_document_id \gset

select 1 / (
  (select count(*) from public.source_documents where id = :'editor_source_document_id') = 1
)::int as editor_can_create_source_document;

select set_config('request.jwt.claim.sub', :'viewer_user_id', true);

select 1 / (
  (select count(*) from public.source_documents where id = :'source_document_id') = 1
)::int as viewer_can_read_source_document;

select 1 / (
  (select count(*) from public.llm_analyses where id = :'llm_analysis_id') = 1
)::int as viewer_can_read_llm_analysis;

insert into public.advisor_threads (
  family_id,
  created_by,
  title
)
values (
  :'family_id',
  :'viewer_user_id',
  'Stage 7 RLS viewer thread'
)
returning id as advisor_thread_id \gset

insert into public.advisor_messages (
  family_id,
  thread_id,
  role,
  content
)
values (
  :'family_id',
  :'advisor_thread_id',
  'user',
  'Что важно по портфелю?'
)
returning id as advisor_message_id \gset

select 1 / (
  (select count(*) from public.advisor_messages where id = :'advisor_message_id') = 1
)::int as viewer_can_create_own_advisor_message;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);

select 1 / (
  (select count(*) from public.source_documents where id = :'source_document_id') = 0
)::int as unrelated_user_cannot_read_source_document;

select 1 / (
  (select count(*) from public.advisor_threads where id = :'advisor_thread_id') = 0
)::int as unrelated_user_cannot_read_advisor_thread;

rollback;
