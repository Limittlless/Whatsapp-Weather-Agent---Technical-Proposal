create table if not exists distributed_locks (
  lock_key text primary key,
  owner_id text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists distributed_locks_expires_at_idx
  on distributed_locks (expires_at);
