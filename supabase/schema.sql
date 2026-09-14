-- Design Item Hub — database schema
-- Run this in the Supabase SQL editor (or via `supabase db push`) on a fresh project.

-- ===== profiles =====
-- Supabase Auth owns auth.users; this table holds the display name shown in the app.
-- A row is created automatically for every new signup via the trigger below.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles are readable by any authenticated user"
  on public.profiles for select
  to authenticated
  using (true);

create policy "a user can update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id);

-- Auto-create a profile row when a new auth user is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ===== projects =====

create table if not exists public.projects (
  project_number text primary key,
  display_number text not null,
  name text not null default '',
  status text not null default 'active' check (status in ('active', 'complete', 'archived')),
  notes text not null default '',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.projects enable row level security;

-- Every signed-in team member reads and writes every project (matches the
-- "no permission gating" decision — see MAINTAINER_NOTES.md).
create policy "authenticated users read all projects"
  on public.projects for select
  to authenticated
  using (true);

create policy "authenticated users write all projects"
  on public.projects for insert
  to authenticated
  with check (true);

create policy "authenticated users update all projects"
  on public.projects for update
  to authenticated
  using (true);

create policy "authenticated users delete all projects"
  on public.projects for delete
  to authenticated
  using (true);

-- ===== items =====

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  project_number text not null references public.projects(project_number) on delete cascade,
  type text not null,
  label text not null default '',
  custom_name text,
  inputs jsonb not null default '{}'::jsonb,
  outputs jsonb not null default '{}'::jsonb,
  refs jsonb not null default '{}'::jsonb,
  schema_version integer not null default 1,
  calc_version text not null default 'PENDING',
  archived boolean not null default false,
  revisions jsonb not null default '[]'::jsonb,
  entered_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists items_project_number_idx on public.items(project_number);
create index if not exists items_type_idx on public.items(type);

alter table public.items enable row level security;

create policy "authenticated users read all items"
  on public.items for select
  to authenticated
  using (true);

create policy "authenticated users write all items"
  on public.items for insert
  to authenticated
  with check (true);

create policy "authenticated users update all items"
  on public.items for update
  to authenticated
  using (true);

create policy "authenticated users delete all items"
  on public.items for delete
  to authenticated
  using (true);

-- Keep updated_at current on every row change.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_touch_updated_at on public.projects;
create trigger projects_touch_updated_at
  before update on public.projects
  for each row execute procedure public.touch_updated_at();

drop trigger if exists items_touch_updated_at on public.items;
create trigger items_touch_updated_at
  before update on public.items
  for each row execute procedure public.touch_updated_at();

-- ===== realtime =====
-- Enable realtime so the UI can subscribe to live project/item changes.
alter publication supabase_realtime add table public.projects;
alter publication supabase_realtime add table public.items;

-- ===== storage (PDF exports) =====
insert into storage.buckets (id, name, public)
values ('calc-sheets', 'calc-sheets', false)
on conflict (id) do nothing;

create policy "authenticated users read calc sheets"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'calc-sheets');

create policy "authenticated users write calc sheets"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'calc-sheets');
