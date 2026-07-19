create table if not exists processed_messages (
  message_id text primary key,
  whatsapp_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists processed_messages_created_at_idx
  on processed_messages (created_at);
