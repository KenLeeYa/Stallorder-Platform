-- First-party intentional feedback. No analytics/provider payload is stored here.
create table public.product_feedback (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid references public.organizations(id) on delete cascade,
 profile_id uuid not null references public.profiles(id) on delete cascade,
 kind varchar(16) not null check (kind in ('ISSUE','SUGGESTION')),
 surface varchar(16) not null check (surface in ('MERCHANT','ADMIN','NATIVE')),
 message varchar(2000) not null check (char_length(btrim(message)) between 1 and 2000 and message=btrim(message)),
 request_id uuid,
 status varchar(16) not null default 'NEW' check (status in ('NEW','REVIEWED','CLOSED')),
 version integer not null default 1 check (version > 0),
 created_at timestamptz(6) not null default now(),
 updated_at timestamptz(6) not null default now(),
 expires_at timestamptz(6) not null default (now()+interval '90 days'),
 constraint product_feedback_retention check (expires_at > created_at and expires_at <= created_at+interval '90 days')
);
create index product_feedback_status_created_at_id_idx on public.product_feedback(status,created_at desc,id desc);
create index product_feedback_expires_at_id_idx on public.product_feedback(expires_at,id);
alter table public.product_feedback enable row level security;
alter table public.product_feedback force row level security;
revoke all on public.product_feedback from public, anon, authenticated, service_role;
grant select,insert,update,delete on public.product_feedback to service_role;
create policy product_feedback_service_writer on public.product_feedback for all to service_role using (true) with check (true);
