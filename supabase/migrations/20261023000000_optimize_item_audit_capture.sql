-- Avoid detoasting and serializing the large items.revisions history on every
-- calculation save. The audit ledger still stores the same durable item fields;
-- only updated_at and revisions remain excluded, as in the original trigger.
create or replace function app_private.capture_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  before_row jsonb;
  after_row jsonb;
  record_row jsonb;
  changed text[];
  actor uuid := auth.uid();
begin
  if TG_TABLE_NAME = 'items' then
    if TG_OP <> 'INSERT' then
      before_row := jsonb_build_object(
        'id', old.id,
        'project_number', old.project_number,
        'type', old.type,
        'label', old.label,
        'custom_name', old.custom_name,
        'inputs', old.inputs,
        'outputs', old.outputs,
        'refs', old.refs,
        'schema_version', old.schema_version,
        'calc_version', old.calc_version,
        'archived', old.archived,
        'entered_by', old.entered_by,
        'created_at', old.created_at
      );
    end if;
    if TG_OP <> 'DELETE' then
      after_row := jsonb_build_object(
        'id', new.id,
        'project_number', new.project_number,
        'type', new.type,
        'label', new.label,
        'custom_name', new.custom_name,
        'inputs', new.inputs,
        'outputs', new.outputs,
        'refs', new.refs,
        'schema_version', new.schema_version,
        'calc_version', new.calc_version,
        'archived', new.archived,
        'entered_by', new.entered_by,
        'created_at', new.created_at
      );
    end if;

    if TG_OP = 'UPDATE' then
      changed := array_remove(array[
        case when old.id is distinct from new.id then 'id' end,
        case when old.project_number is distinct from new.project_number then 'project_number' end,
        case when old.type is distinct from new.type then 'type' end,
        case when old.label is distinct from new.label then 'label' end,
        case when old.custom_name is distinct from new.custom_name then 'custom_name' end,
        case when old.inputs is distinct from new.inputs then 'inputs' end,
        case when old.outputs is distinct from new.outputs then 'outputs' end,
        case when old.refs is distinct from new.refs then 'refs' end,
        case when old.schema_version is distinct from new.schema_version then 'schema_version' end,
        case when old.calc_version is distinct from new.calc_version then 'calc_version' end,
        case when old.archived is distinct from new.archived then 'archived' end,
        case when old.entered_by is distinct from new.entered_by then 'entered_by' end,
        case when old.created_at is distinct from new.created_at then 'created_at' end
      ], null);
      if coalesce(array_length(changed, 1), 0) = 0 then return new; end if;
    else
      record_row := coalesce(after_row, before_row);
      select coalesce(array_agg(key order by key), '{}'::text[]) into changed
      from jsonb_object_keys(record_row) as fields(key);
    end if;
  else
    if TG_OP <> 'INSERT' then before_row := to_jsonb(old) - 'updated_at' - 'revisions'; end if;
    if TG_OP <> 'DELETE' then after_row := to_jsonb(new) - 'updated_at' - 'revisions'; end if;
    if TG_OP = 'UPDATE' and before_row = after_row then return new; end if;
    select coalesce(array_agg(key order by key), '{}'::text[]) into changed
    from (
      select jsonb_object_keys(coalesce(before_row, '{}'::jsonb) || coalesce(after_row, '{}'::jsonb)) as key
    ) keys
    where (before_row -> key) is distinct from (after_row -> key);
  end if;

  record_row := coalesce(after_row, before_row);
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

revoke all on function app_private.capture_audit() from public, anon, authenticated;
