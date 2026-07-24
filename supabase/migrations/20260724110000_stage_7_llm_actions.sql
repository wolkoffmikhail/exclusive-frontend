begin;

alter table public.llm_analyses
  add column if not exists suggested_actions jsonb not null default '[]'::jsonb,
  add column if not exists what_if_prefill jsonb;

commit;
