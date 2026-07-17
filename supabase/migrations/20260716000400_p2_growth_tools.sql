create type public.report_schedule_type as enum (
  'DAILY_SALES',
  'WEEKLY_SALES',
  'PAYMENT_VARIANCE'
);

create type public.report_delivery_status as enum (
  'PROCESSING',
  'SENT',
  'SIMULATED',
  'FAILURE'
);

create table public.report_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  report_type public.report_schedule_type not null,
  recipients text[] not null,
  stall_ids uuid[] not null,
  timezone text not null default 'Asia/Taipei' check (char_length(timezone) between 1 and 80),
  send_hour smallint not null default 8 check (send_hour between 0 and 23),
  send_minute smallint not null default 0 check (send_minute between 0 and 59),
  day_of_week smallint check (day_of_week between 0 and 6),
  is_enabled boolean not null default true,
  next_run_at timestamptz not null,
  last_run_at timestamptz,
  archived_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_schedules_recipients_count check (cardinality(recipients) between 1 and 20),
  constraint report_schedules_stalls_count check (cardinality(stall_ids) between 1 and 50),
  constraint report_schedules_weekday_shape check (
    (report_type = 'WEEKLY_SALES' and day_of_week is not null)
    or (report_type <> 'WEEKLY_SALES' and day_of_week is null)
  )
);

create table public.report_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  report_schedule_id uuid not null references public.report_schedules(id) on delete restrict,
  report_type public.report_schedule_type not null,
  status public.report_delivery_status not null default 'PROCESSING',
  scheduled_for timestamptz not null,
  period_start date not null,
  period_end date not null,
  recipients text[] not null,
  subject text not null check (char_length(subject) between 1 and 200),
  payload jsonb,
  attempt_count integer not null default 1 check (attempt_count between 1 and 10),
  provider_message_id text,
  error_code text,
  started_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_deliveries_period_order check (period_end >= period_start),
  constraint report_deliveries_recipients_count check (cardinality(recipients) between 1 and 20),
  constraint report_deliveries_schedule_run_key unique (report_schedule_id, scheduled_for)
);

create index report_schedules_organization_active_idx
  on public.report_schedules (organization_id, is_enabled, archived_at);
create index report_schedules_due_idx
  on public.report_schedules (is_enabled, archived_at, next_run_at);
create index report_deliveries_organization_created_idx
  on public.report_deliveries (organization_id, created_at desc);
create index report_deliveries_status_started_idx
  on public.report_deliveries (status, started_at);

create or replace function public.enforce_report_schedule_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from unnest(new.stall_ids) as selected_stall_id
    where not exists (
      select 1 from public.stalls stall
      where stall.id = selected_stall_id
        and stall.organization_id = new.organization_id
        and stall.is_active
    )
  ) then
    raise exception 'REPORT_SCHEDULE_STALL_SCOPE_MISMATCH';
  end if;
  if exists (
    select 1 from unnest(new.recipients) as recipient
    where recipient <> lower(btrim(recipient))
      or char_length(recipient) > 254
      or recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) then
    raise exception 'REPORT_SCHEDULE_RECIPIENT_INVALID';
  end if;
  if cardinality(new.recipients) <> cardinality(array(select distinct recipient from unnest(new.recipients) recipient)) then
    raise exception 'REPORT_SCHEDULE_RECIPIENT_DUPLICATE';
  end if;
  if cardinality(new.stall_ids) <> cardinality(array(select distinct stall_id from unnest(new.stall_ids) stall_id)) then
    raise exception 'REPORT_SCHEDULE_STALL_DUPLICATE';
  end if;
  return new;
end;
$$;

create trigger report_schedules_enforce_scope
before insert or update on public.report_schedules
for each row execute function public.enforce_report_schedule_scope();

create trigger report_schedules_touch_updated_at
before update on public.report_schedules
for each row execute function public.touch_commercial_updated_at();
create trigger report_deliveries_touch_updated_at
before update on public.report_deliveries
for each row execute function public.touch_commercial_updated_at();

alter table public.report_schedules enable row level security;
alter table public.report_schedules force row level security;
alter table public.report_deliveries enable row level security;
alter table public.report_deliveries force row level security;

revoke all on public.report_schedules, public.report_deliveries from public, anon, authenticated;
grant select on public.report_schedules, public.report_deliveries to authenticated;
grant select, insert, update, delete on public.report_schedules, public.report_deliveries to service_role;

create policy report_schedules_owner_admin_select on public.report_schedules
for select to authenticated using (
  public.has_organization_role(
    organization_id,
    array[
      'ORGANIZATION_OWNER'::public.user_role,
      'ORGANIZATION_ADMIN'::public.user_role
    ]
  )
);

create policy report_deliveries_owner_admin_select on public.report_deliveries
for select to authenticated using (
  public.has_organization_role(
    organization_id,
    array[
      'ORGANIZATION_OWNER'::public.user_role,
      'ORGANIZATION_ADMIN'::public.user_role
    ]
  )
);
