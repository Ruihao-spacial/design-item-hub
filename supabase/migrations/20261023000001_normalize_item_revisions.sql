create table public.item_revisions (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.items(id) on delete cascade,
  inputs jsonb not null,
  outputs jsonb not null,
  updated_at timestamptz not null,
  updated_by text not null default '',
  created_at timestamptz not null default now()
);

create index item_revisions_item_idx on public.item_revisions (item_id, id desc);

alter table public.item_revisions enable row level security;
revoke all on public.item_revisions from anon, authenticated;
grant select on public.item_revisions to authenticated;

create policy "active members read item revisions" on public.item_revisions
for select to authenticated using ((select app_private.is_active_user()));

do $$
begin
  if exists (
    select 1
    from public.items
    where jsonb_typeof(revisions) is distinct from 'array'
  ) then
    raise exception 'Cannot migrate items.revisions: every value must be a JSON array';
  end if;
end;
$$;
insert into public.item_revisions (item_id, inputs, outputs, updated_at, updated_by)
select
  item.id,
  coalesce(revision.value->'inputs', '{}'::jsonb),
  coalesce(revision.value->'outputs', '{}'::jsonb),
  coalesce(nullif(revision.value->>'updatedAt', '')::timestamptz, item.updated_at),
  coalesce(revision.value->>'updatedBy', '')
from public.items item
cross join lateral jsonb_array_elements(coalesce(item.revisions, '[]'::jsonb))
with ordinality as revision(value, position)
order by item.id, revision.position;

update public.items
set revisions = '[]'::jsonb
where jsonb_typeof(revisions) = 'array'
  and jsonb_array_length(revisions) > 0;

alter table public.items
add constraint items_revisions_must_be_array
check (jsonb_typeof(revisions) = 'array');

create function public.save_item(
  p_item_id uuid,
  p_label text,
  p_custom_name text,
  p_inputs jsonb,
  p_outputs jsonb,
  p_refs jsonb,
  p_schema_version integer,
  p_calc_version text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous public.items%rowtype;
  previous_editor text;
begin
  if not app_private.is_active_user() then
    raise exception 'Active team membership required' using errcode = '42501';
  end if;

  select * into previous
  from public.items
  where id = p_item_id
  for update;

  if not found then
    raise exception 'Calculation not found' using errcode = 'P0002';
  end if;

  select coalesce(profile.full_name, '') into previous_editor
  from public.profiles profile
  where profile.id = previous.entered_by;

  insert into public.item_revisions (item_id, inputs, outputs, updated_at, updated_by)
  values (
    previous.id,
    previous.inputs,
    previous.outputs,
    previous.updated_at,
    coalesce(previous_editor, '')
  );

  delete from public.item_revisions revision
  where revision.item_id = p_item_id
    and revision.id not in (
      select recent.id
      from public.item_revisions recent
      where recent.item_id = p_item_id
      order by recent.id desc
      limit 10
    );

  update public.items
  set
    label = p_label,
    custom_name = p_custom_name,
    inputs = p_inputs,
    outputs = p_outputs,
    refs = p_refs,
    schema_version = p_schema_version,
    calc_version = p_calc_version,
    revisions = '[]'::jsonb
  where id = p_item_id;

  return p_item_id;
end;
$$;

revoke all on function public.save_item(uuid, text, text, jsonb, jsonb, jsonb, integer, text)
from public, anon;
grant execute on function public.save_item(uuid, text, text, jsonb, jsonb, jsonb, integer, text)
to authenticated;
