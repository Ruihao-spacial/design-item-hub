-- Live permissions and an append-only, database-authored history of saved work.
begin;

create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to authenticated;

create table public.user_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.user_access enable row level security;
revoke all on public.user_access from anon, authenticated;
grant select on public.user_access to authenticated;
grant all on public.user_access to service_role;

-- Preserve current members; only the explicitly designated account is bootstrapped.
insert into public.user_access (user_id, role, active)
select id, case when lower(email) = 'admin@spacial.io' then 'admin' else 'member' end, true
from auth.users;

create function app_private.is_active_user()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.user_access where user_id = auth.uid() and active); $$;
create function app_private.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.user_access where user_id = auth.uid() and active and role = 'admin'); $$;
revoke all on function app_private.is_active_user(), app_private.is_admin() from public, anon;
grant execute on function app_private.is_active_user(), app_private.is_admin() to authenticated;

create policy "read own access or administer users" on public.user_access for select to authenticated
using (user_id = auth.uid() or (select app_private.is_admin()));

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, left(coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1), ''), 200));
  -- Never derive permission from user-editable metadata or the email address.
  insert into public.user_access (user_id) values (new.id);
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

drop policy if exists "profiles are readable by any authenticated user" on public.profiles;
drop policy if exists "a user can update their own profile" on public.profiles;
create policy "active members read profiles" on public.profiles for select to authenticated
using ((select app_private.is_active_user()));
create policy "active members update their name" on public.profiles for update to authenticated
using (id = auth.uid() and (select app_private.is_active_user()))
with check (id = auth.uid() and (select app_private.is_active_user()));
revoke update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

drop policy if exists "authenticated users read all projects" on public.projects;
drop policy if exists "authenticated users write all projects" on public.projects;
drop policy if exists "authenticated users update all projects" on public.projects;
drop policy if exists "authenticated users delete all projects" on public.projects;
create policy "active members use projects" on public.projects for all to authenticated
using ((select app_private.is_active_user())) with check ((select app_private.is_active_user()));
drop policy if exists "authenticated users read all items" on public.items;
drop policy if exists "authenticated users write all items" on public.items;
drop policy if exists "authenticated users update all items" on public.items;
drop policy if exists "authenticated users delete all items" on public.items;
create policy "active members use items" on public.items for all to authenticated
using ((select app_private.is_active_user())) with check ((select app_private.is_active_user()));
drop policy if exists "authenticated users read calc sheets" on storage.objects;
drop policy if exists "authenticated users write calc sheets" on storage.objects;
create policy "active members read calc sheets" on storage.objects for select to authenticated
using (bucket_id = 'calc-sheets' and (select app_private.is_active_user()));
create policy "active members write calc sheets" on storage.objects for insert to authenticated
with check (bucket_id = 'calc-sheets' and (select app_private.is_active_user()));

create table public.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  actor_id uuid,
  actor_name text,
  actor_email text,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  project_number text,
  old_values jsonb,
  new_values jsonb,
  changed_fields text[] not null default '{}'
);
-- No foreign keys: history and actor snapshots survive entity/account deletion.
create index audit_log_time_idx on public.audit_log (occurred_at desc, id desc);
create index audit_log_actor_idx on public.audit_log (actor_id, id desc);
create index audit_log_project_idx on public.audit_log (project_number, id desc);
alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated, service_role;
grant select on public.audit_log to authenticated, service_role;
create policy "admins read audit history" on public.audit_log for select to authenticated
using ((select app_private.is_admin()));

create function app_private.reject_audit_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Audit history is append-only' using errcode = '42501';
end;
$$;
create trigger audit_log_immutable before update or delete on public.audit_log
for each row execute function app_private.reject_audit_mutation();

create function app_private.capture_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  before_row jsonb;
  after_row jsonb;
  record_row jsonb;
  changed text[];
  actor uuid := auth.uid();
begin
  if TG_OP <> 'INSERT' then before_row := to_jsonb(old) - 'updated_at' - 'revisions'; end if;
  if TG_OP <> 'DELETE' then after_row := to_jsonb(new) - 'updated_at' - 'revisions'; end if;
  if TG_OP = 'UPDATE' and before_row = after_row then return new; end if;
  record_row := coalesce(after_row, before_row);
  select coalesce(array_agg(key order by key), '{}'::text[]) into changed
  from (
    select jsonb_object_keys(coalesce(before_row, '{}'::jsonb) || coalesce(after_row, '{}'::jsonb)) as key
  ) keys
  where (before_row -> key) is distinct from (after_row -> key);
  insert into public.audit_log
    (actor_id, actor_name, actor_email, action, entity_type, entity_id, project_number, old_values, new_values, changed_fields)
  values (
    actor, (select full_name from public.profiles where id = actor),
    (select email from auth.users where id = actor), lower(TG_OP), TG_TABLE_NAME,
    coalesce(record_row->>'id', record_row->>'user_id', record_row->>'project_number'),
    case when TG_TABLE_NAME in ('projects', 'items') then record_row->>'project_number' end,
    before_row, after_row, changed
  );
  if TG_OP = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function app_private.capture_audit(), app_private.reject_audit_mutation() from public, anon, authenticated;
create trigger projects_audit after insert or update or delete on public.projects
for each row execute function app_private.capture_audit();
create trigger items_audit after insert or update or delete on public.items
for each row execute function app_private.capture_audit();
create trigger profiles_audit after insert or update or delete on public.profiles
for each row execute function app_private.capture_audit();
create trigger user_access_audit after insert or update or delete on public.user_access
for each row execute function app_private.capture_audit();

create function public.admin_update_user(target_user_id uuid, new_role text, is_active boolean, new_full_name text default null)
returns public.user_access language plpgsql security definer set search_path = '' as $$
declare
  result public.user_access;
begin
  -- All permission changes serialize, including concurrent demotion requests.
  perform pg_catalog.pg_advisory_xact_lock(172917, 1);
  if not app_private.is_admin() then raise exception 'Administrator access required' using errcode = '42501'; end if;
  if new_role is null or new_role not in ('admin', 'member') or is_active is null then
    raise exception 'Invalid role or active status' using errcode = '22023';
  end if;
  if new_full_name is not null and (length(btrim(new_full_name)) < 1 or length(new_full_name) > 200) then
    raise exception 'Name must contain 1–200 characters' using errcode = '22023';
  end if;
  select * into result from public.user_access where user_id = target_user_id for update;
  if not found then raise exception 'User not found' using errcode = 'P0002'; end if;
  if result.role = 'admin' and result.active and (new_role <> 'admin' or not is_active)
    and not exists (select 1 from public.user_access where role = 'admin' and active and user_id <> target_user_id) then
    raise exception 'At least one active administrator is required' using errcode = '23514';
  end if;
  update public.user_access set role = new_role, active = is_active, updated_at = now()
  where user_id = target_user_id returning * into result;
  if new_full_name is not null then
    update public.profiles set full_name = btrim(new_full_name) where id = target_user_id;
  end if;
  return result;
end;
$$;
revoke all on function public.admin_update_user(uuid, text, boolean, text) from public, anon;
grant execute on function public.admin_update_user(uuid, text, boolean, text) to authenticated;

create function public.admin_list_users(page_number integer default 1, page_size integer default 100)
returns table (id uuid, email text, full_name text, role text, active boolean,
  created_at timestamptz, last_sign_in_at timestamptz, total bigint)
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.is_admin() then raise exception 'Administrator access required' using errcode = '42501'; end if;
  if page_number < 1 or page_number > 100000 or page_size < 1 or page_size > 200 or page_number is null or page_size is null then
    raise exception 'Invalid pagination' using errcode = '22023';
  end if;
  return query select u.id, u.email::text, coalesce(p.full_name, ''), a.role, a.active,
    u.created_at, u.last_sign_in_at, count(*) over ()
  from auth.users u join public.user_access a on a.user_id = u.id
  left join public.profiles p on p.id = u.id
  order by u.created_at desc, u.id
  limit page_size offset ((page_number - 1) * page_size);
end;
$$;
revoke all on function public.admin_list_users(integer, integer) from public, anon;
grant execute on function public.admin_list_users(integer, integer) to authenticated;

commit;
