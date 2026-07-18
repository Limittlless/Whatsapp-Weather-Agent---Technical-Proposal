create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  whatsapp_id text unique not null,
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conversations_whatsapp_id_idx
  on conversations (whatsapp_id);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists conversations_set_updated_at on conversations;

create trigger conversations_set_updated_at
  before update on conversations
  for each row
  execute function set_updated_at();
