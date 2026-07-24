begin;

create table if not exists public.news_sources (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  source_code text not null check (source_code ~ '^[a-z][a-z0-9_:-]{1,80}$'),
  source_name text not null check (char_length(trim(source_name)) between 1 and 200),
  source_type text not null check (source_type in ('regulator', 'exchange_reference', 'issuer_disclosure', 'broker_api', 'editorial', 'issuer_ir', 'manual')),
  base_url text,
  status text not null default 'active' check (status in ('active', 'paused', 'failed')),
  requires_token boolean not null default false,
  terms_status text not null default 'unchecked' check (terms_status in ('unchecked', 'approved', 'restricted', 'blocked')),
  terms_checked_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, source_code),
  unique (id, family_id)
);

create table if not exists public.source_documents (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  source_id uuid not null,
  external_id text,
  url text,
  title text not null check (char_length(trim(title)) between 1 and 500),
  published_at timestamptz,
  issuer_name text,
  ticker text,
  isin text,
  language text not null default 'ru' check (language ~ '^[a-z]{2,8}(-[A-Z]{2})?$'),
  document_type text not null default 'news' check (document_type ~ '^[a-z][a-z0-9_]{1,80}$'),
  trust_level text not null default 'manual' check (trust_level in ('primary', 'reference', 'editorial', 'manual')),
  raw_excerpt text,
  content_hash text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, family_id),
  foreign key (source_id, family_id)
    references public.news_sources(id, family_id)
    on delete cascade
);

create unique index if not exists source_documents_family_source_external_idx
  on public.source_documents (family_id, source_id, external_id)
  where external_id is not null;

create unique index if not exists source_documents_family_content_hash_idx
  on public.source_documents (family_id, content_hash)
  where content_hash is not null;

create table if not exists public.source_document_links (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  source_document_id uuid not null,
  asset_id uuid not null,
  link_type text not null check (link_type in ('ticker', 'isin', 'issuer_alias', 'manual', 'llm_suggested')),
  confidence numeric(5, 4) not null check (confidence >= 0 and confidence <= 1),
  status text not null default 'suggested' check (status in ('suggested', 'confirmed', 'rejected')),
  evidence jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, source_document_id, asset_id, link_type),
  unique (id, family_id),
  foreign key (source_document_id, family_id)
    references public.source_documents(id, family_id)
    on delete cascade,
  foreign key (asset_id, family_id)
    references public.assets(id, family_id)
    on delete cascade
);

create table if not exists public.llm_analyses (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  source_document_id uuid,
  analysis_type text not null check (analysis_type in ('summary', 'portfolio_impact', 'recommendation_explanation', 'report_summary')),
  model text,
  prompt_version text not null,
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  summary text,
  facts jsonb not null default '[]'::jsonb,
  portfolio_links jsonb not null default '[]'::jsonb,
  impact_level text not null default 'unknown' check (impact_level in ('none', 'low', 'medium', 'high', 'unknown')),
  confidence numeric(5, 4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  limitations jsonb not null default '[]'::jsonb,
  citations jsonb not null default '[]'::jsonb,
  safety_flags jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, family_id),
  foreign key (source_document_id, family_id)
    references public.source_documents(id, family_id)
    on delete set null
);

create table if not exists public.advisor_threads (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  title text not null default 'Новый диалог' check (char_length(trim(title)) between 1 and 200),
  context_scope jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, family_id)
);

create table if not exists public.advisor_messages (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  thread_id uuid not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null check (char_length(trim(content)) between 1 and 20000),
  citations jsonb not null default '[]'::jsonb,
  linked_entities jsonb not null default '[]'::jsonb,
  model text,
  prompt_version text,
  safety_flags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (id, family_id),
  foreign key (thread_id, family_id)
    references public.advisor_threads(id, family_id)
    on delete cascade
);

create table if not exists public.issuer_aliases (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  asset_id uuid not null,
  alias text not null check (char_length(trim(alias)) between 2 and 300),
  source text not null default 'manual' check (source in ('manual', 'moex', 'import', 'llm_suggested')),
  confidence numeric(5, 4) not null default 1 check (confidence >= 0 and confidence <= 1),
  status text not null default 'active' check (status in ('active', 'rejected')),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, asset_id, lower(alias)),
  unique (id, family_id),
  foreign key (asset_id, family_id)
    references public.assets(id, family_id)
    on delete cascade
);

create index if not exists source_documents_family_published_idx
  on public.source_documents (family_id, published_at desc nulls last);

create index if not exists source_document_links_family_asset_idx
  on public.source_document_links (family_id, asset_id, status);

create index if not exists llm_analyses_family_document_idx
  on public.llm_analyses (family_id, source_document_id, analysis_type, created_at desc);

create index if not exists advisor_messages_thread_created_idx
  on public.advisor_messages (family_id, thread_id, created_at);

drop trigger if exists news_sources_set_updated_at on public.news_sources;
create trigger news_sources_set_updated_at
before update on public.news_sources
for each row execute function public.set_portfolio_updated_at();

drop trigger if exists source_documents_set_updated_at on public.source_documents;
create trigger source_documents_set_updated_at
before update on public.source_documents
for each row execute function public.set_portfolio_updated_at();

drop trigger if exists source_document_links_set_updated_at on public.source_document_links;
create trigger source_document_links_set_updated_at
before update on public.source_document_links
for each row execute function public.set_portfolio_updated_at();

drop trigger if exists llm_analyses_set_updated_at on public.llm_analyses;
create trigger llm_analyses_set_updated_at
before update on public.llm_analyses
for each row execute function public.set_portfolio_updated_at();

drop trigger if exists advisor_threads_set_updated_at on public.advisor_threads;
create trigger advisor_threads_set_updated_at
before update on public.advisor_threads
for each row execute function public.set_portfolio_updated_at();

drop trigger if exists issuer_aliases_set_updated_at on public.issuer_aliases;
create trigger issuer_aliases_set_updated_at
before update on public.issuer_aliases
for each row execute function public.set_portfolio_updated_at();

alter table public.news_sources enable row level security;
alter table public.source_documents enable row level security;
alter table public.source_document_links enable row level security;
alter table public.llm_analyses enable row level security;
alter table public.advisor_threads enable row level security;
alter table public.advisor_messages enable row level security;
alter table public.issuer_aliases enable row level security;

drop policy if exists news_sources_select_member on public.news_sources;
create policy news_sources_select_member
on public.news_sources for select
to authenticated
using (public.is_family_member(family_id));

drop policy if exists news_sources_insert_admin on public.news_sources;
create policy news_sources_insert_admin
on public.news_sources for insert
to authenticated
with check (
  public.has_family_role(family_id, array['admin'])
  and (created_by is null or created_by = auth.uid())
);

drop policy if exists news_sources_update_admin on public.news_sources;
create policy news_sources_update_admin
on public.news_sources for update
to authenticated
using (public.has_family_role(family_id, array['admin']))
with check (public.has_family_role(family_id, array['admin']));

drop policy if exists news_sources_delete_admin on public.news_sources;
create policy news_sources_delete_admin
on public.news_sources for delete
to authenticated
using (public.has_family_role(family_id, array['admin']));

drop policy if exists source_documents_select_member on public.source_documents;
create policy source_documents_select_member
on public.source_documents for select
to authenticated
using (public.is_family_member(family_id));

drop policy if exists source_documents_insert_editor on public.source_documents;
create policy source_documents_insert_editor
on public.source_documents for insert
to authenticated
with check (public.has_family_role(family_id, array['admin', 'editor']));

drop policy if exists source_documents_update_editor on public.source_documents;
create policy source_documents_update_editor
on public.source_documents for update
to authenticated
using (public.has_family_role(family_id, array['admin', 'editor']))
with check (public.has_family_role(family_id, array['admin', 'editor']));

drop policy if exists source_documents_delete_admin on public.source_documents;
create policy source_documents_delete_admin
on public.source_documents for delete
to authenticated
using (public.has_family_role(family_id, array['admin']));

drop policy if exists source_document_links_select_member on public.source_document_links;
create policy source_document_links_select_member
on public.source_document_links for select
to authenticated
using (public.is_family_member(family_id));

drop policy if exists source_document_links_insert_editor on public.source_document_links;
create policy source_document_links_insert_editor
on public.source_document_links for insert
to authenticated
with check (
  public.has_family_role(family_id, array['admin', 'editor'])
  and (created_by is null or created_by = auth.uid())
);

drop policy if exists source_document_links_update_editor on public.source_document_links;
create policy source_document_links_update_editor
on public.source_document_links for update
to authenticated
using (public.has_family_role(family_id, array['admin', 'editor']))
with check (public.has_family_role(family_id, array['admin', 'editor']));

drop policy if exists source_document_links_delete_admin on public.source_document_links;
create policy source_document_links_delete_admin
on public.source_document_links for delete
to authenticated
using (public.has_family_role(family_id, array['admin']));

drop policy if exists llm_analyses_select_member on public.llm_analyses;
create policy llm_analyses_select_member
on public.llm_analyses for select
to authenticated
using (public.is_family_member(family_id));

drop policy if exists llm_analyses_insert_editor on public.llm_analyses;
create policy llm_analyses_insert_editor
on public.llm_analyses for insert
to authenticated
with check (
  public.has_family_role(family_id, array['admin', 'editor'])
  and (created_by is null or created_by = auth.uid())
);

drop policy if exists llm_analyses_update_editor on public.llm_analyses;
create policy llm_analyses_update_editor
on public.llm_analyses for update
to authenticated
using (public.has_family_role(family_id, array['admin', 'editor']))
with check (public.has_family_role(family_id, array['admin', 'editor']));

drop policy if exists llm_analyses_delete_admin on public.llm_analyses;
create policy llm_analyses_delete_admin
on public.llm_analyses for delete
to authenticated
using (public.has_family_role(family_id, array['admin']));

drop policy if exists advisor_threads_select_member on public.advisor_threads;
create policy advisor_threads_select_member
on public.advisor_threads for select
to authenticated
using (public.is_family_member(family_id));

drop policy if exists advisor_threads_insert_member on public.advisor_threads;
create policy advisor_threads_insert_member
on public.advisor_threads for insert
to authenticated
with check (
  public.is_family_member(family_id)
  and created_by = auth.uid()
);

drop policy if exists advisor_threads_update_owner_or_editor on public.advisor_threads;
create policy advisor_threads_update_owner_or_editor
on public.advisor_threads for update
to authenticated
using (
  public.has_family_role(family_id, array['admin', 'editor'])
  or (public.is_family_member(family_id) and created_by = auth.uid())
)
with check (public.is_family_member(family_id));

drop policy if exists advisor_messages_select_member on public.advisor_messages;
create policy advisor_messages_select_member
on public.advisor_messages for select
to authenticated
using (public.is_family_member(family_id));

drop policy if exists advisor_messages_insert_member on public.advisor_messages;
create policy advisor_messages_insert_member
on public.advisor_messages for insert
to authenticated
with check (public.is_family_member(family_id));

drop policy if exists issuer_aliases_select_member on public.issuer_aliases;
create policy issuer_aliases_select_member
on public.issuer_aliases for select
to authenticated
using (public.is_family_member(family_id));

drop policy if exists issuer_aliases_insert_editor on public.issuer_aliases;
create policy issuer_aliases_insert_editor
on public.issuer_aliases for insert
to authenticated
with check (
  public.has_family_role(family_id, array['admin', 'editor'])
  and (created_by is null or created_by = auth.uid())
);

drop policy if exists issuer_aliases_update_editor on public.issuer_aliases;
create policy issuer_aliases_update_editor
on public.issuer_aliases for update
to authenticated
using (public.has_family_role(family_id, array['admin', 'editor']))
with check (public.has_family_role(family_id, array['admin', 'editor']));

drop policy if exists issuer_aliases_delete_admin on public.issuer_aliases;
create policy issuer_aliases_delete_admin
on public.issuer_aliases for delete
to authenticated
using (public.has_family_role(family_id, array['admin']));

grant select, insert, update, delete on
  public.news_sources,
  public.source_documents,
  public.source_document_links,
  public.llm_analyses,
  public.advisor_threads,
  public.advisor_messages,
  public.issuer_aliases
to authenticated;

commit;
