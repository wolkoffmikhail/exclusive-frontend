begin;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  base_currency text not null default 'RUB'
    check (base_currency ~ '^[A-Z]{3}$'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.family_members (
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  primary key (family_id, user_id)
);

create index if not exists family_members_user_id_idx
  on public.family_members(user_id);

create or replace function public.is_family_member(target_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.family_members fm
    where fm.family_id = target_family_id
      and fm.user_id = auth.uid()
  );
$$;

create or replace function public.has_family_role(
  target_family_id uuid,
  allowed_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.family_members fm
    where fm.family_id = target_family_id
      and fm.user_id = auth.uid()
      and fm.role = any(allowed_roles)
  );
$$;

revoke all on function public.is_family_member(uuid) from public;
revoke all on function public.has_family_role(uuid, text[]) from public;
grant execute on function public.is_family_member(uuid) to authenticated;
grant execute on function public.has_family_role(uuid, text[]) to authenticated;

alter table public.profiles enable row level security;
alter table public.families enable row level security;
alter table public.family_members enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
on public.profiles for select
to authenticated
using (user_id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists families_select_member on public.families;
create policy families_select_member
on public.families for select
to authenticated
using (public.is_family_member(id));

drop policy if exists families_update_admin on public.families;
create policy families_update_admin
on public.families for update
to authenticated
using (public.has_family_role(id, array['admin']))
with check (public.has_family_role(id, array['admin']));

drop policy if exists family_members_select_member on public.family_members;
create policy family_members_select_member
on public.family_members for select
to authenticated
using (public.is_family_member(family_id));

drop policy if exists family_members_insert_admin on public.family_members;
create policy family_members_insert_admin
on public.family_members for insert
to authenticated
with check (public.has_family_role(family_id, array['admin']));

drop policy if exists family_members_update_admin on public.family_members;
create policy family_members_update_admin
on public.family_members for update
to authenticated
using (public.has_family_role(family_id, array['admin']))
with check (public.has_family_role(family_id, array['admin']));

drop policy if exists family_members_delete_admin on public.family_members;
create policy family_members_delete_admin
on public.family_members for delete
to authenticated
using (
  public.has_family_role(family_id, array['admin'])
  and user_id <> auth.uid()
);

grant select, update on public.profiles to authenticated;
grant select, update on public.families to authenticated;
grant select, insert, update, delete on public.family_members to authenticated;

commit;
