create table if not exists authorized_users (
  whatsapp_id text primary key,
  display_name text,
  active boolean not null default true,
  authorized_by text not null,
  authorized_at timestamptz not null default now(),
  revoked_by text,
  revoked_at timestamptz,
  constraint authorized_users_whatsapp_id_format
    check (whatsapp_id ~ '^[0-9]{7,15}$'),
  constraint authorized_users_authorized_by_format
    check (authorized_by ~ '^[0-9]{7,15}$'),
  constraint authorized_users_revoked_by_format
    check (revoked_by is null or revoked_by ~ '^[0-9]{7,15}$')
);

create index if not exists authorized_users_active_authorized_at_idx
  on authorized_users (active, authorized_at desc);

alter table authorized_users enable row level security;
