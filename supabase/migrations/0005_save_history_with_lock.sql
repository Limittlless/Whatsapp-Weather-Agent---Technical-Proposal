create or replace function save_conversation_history_with_lock(
  p_whatsapp_id text,
  p_history jsonb,
  p_lock_key text,
  p_lock_owner_id text
)
returns void
language plpgsql
set search_path = public
as $$
declare
  held_lock_key text;
begin
  if p_lock_key <> p_whatsapp_id then
    raise exception 'Distributed lock key does not match the conversation.'
      using errcode = 'P0001';
  end if;

  select lock_key
    into held_lock_key
    from distributed_locks
   where lock_key = p_lock_key
     and owner_id = p_lock_owner_id
     and expires_at > now()
   for update;

  if held_lock_key is null then
    raise exception 'Distributed lock for "%" is no longer held.', p_lock_key
      using errcode = 'P0001';
  end if;

  insert into conversations (whatsapp_id, history)
  values (p_whatsapp_id, p_history)
  on conflict (whatsapp_id)
  do update set history = excluded.history;
end;
$$;

revoke all on function save_conversation_history_with_lock(
  text,
  jsonb,
  text,
  text
) from public;

grant execute on function save_conversation_history_with_lock(
  text,
  jsonb,
  text,
  text
) to service_role;
