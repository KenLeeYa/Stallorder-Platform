create table public.oauth_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null
    check (provider in ('GOOGLE', 'LINE', 'APPLE')),
  event_hash text not null unique
    check (event_hash ~ '^[a-f0-9]{64}$'),
  provider_subject_hash text not null
    check (provider_subject_hash ~ '^[a-f0-9]{64}$'),
  event_type text not null
    check (char_length(event_type) between 1 and 200),
  status text not null default 'RECEIVED'
    check (status in ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED')),
  failure_code text
    check (
      failure_code is null
      or failure_code ~ '^[A-Z][A-Z0-9_]{1,79}$'
    ),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index oauth_provider_events_provider_received
  on public.oauth_provider_events (provider, received_at desc);

create index oauth_provider_events_status_received
  on public.oauth_provider_events (status, received_at);

alter table public.oauth_provider_events enable row level security;
alter table public.oauth_provider_events force row level security;

revoke all on table public.oauth_provider_events
  from public, anon, authenticated;
grant select, insert, update on table public.oauth_provider_events
  to service_role;

comment on table public.oauth_provider_events is
  'Replay-safe provider account event ledger. Raw signed payloads and provider identifiers are never stored.';
