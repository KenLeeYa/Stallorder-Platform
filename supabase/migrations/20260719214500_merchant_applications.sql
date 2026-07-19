create type public.merchant_application_status as enum (
  'DRAFT', 'SUBMITTED', 'PENDING_REVIEW', 'NEEDS_INFO',
  'APPROVED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'
);

create type public.merchant_application_risk_level as enum (
  'LOW', 'MEDIUM', 'HIGH', 'BLOCKED'
);

create type public.merchant_business_type as enum (
  'NIGHT_MARKET_STALL', 'FOOD_TRUCK', 'MARKET_STALL', 'POPUP_STORE',
  'SMALL_RESTAURANT', 'BEVERAGE_SHOP', 'OTHER'
);

create type public.preferred_contact_method as enum ('PHONE', 'LINE', 'EMAIL');

create sequence public.merchant_application_number_seq;

create or replace function public.next_merchant_application_number()
returns text
language sql
security definer
set search_path = ''
as $$
  select 'APP-' || to_char(now() at time zone 'Asia/Taipei', 'YYYYMM') || '-'
    || lpad(nextval('public.merchant_application_number_seq')::text, 6, '0');
$$;

revoke all on function public.next_merchant_application_number() from public, anon, authenticated;
grant execute on function public.next_merchant_application_number() to service_role;

create table public.merchant_applications (
  id uuid primary key default gen_random_uuid(),
  application_number text not null unique default public.next_merchant_application_number(),
  applicant_profile_id uuid not null references public.profiles(id) on delete restrict,
  applicant_email text not null,
  applicant_display_name text not null,
  merchant_name text,
  business_type public.merchant_business_type,
  business_registration_number text,
  business_registration_number_hash text,
  contact_name text,
  phone text,
  phone_hash text,
  business_phone text,
  line_id text,
  preferred_contact_method public.preferred_contact_method,
  business_address text,
  city text,
  merchant_description text,
  stall_name text,
  stall_location text,
  requested_slug text,
  estimated_daily_orders integer,
  expected_start_date date,
  needs_multiple_staff boolean not null default false,
  needs_kitchen_view boolean not null default false,
  requested_plan_code text not null default 'TRIAL',
  status public.merchant_application_status not null default 'DRAFT',
  risk_level public.merchant_application_risk_level not null default 'LOW',
  risk_reasons_json jsonb,
  public_review_note text,
  internal_review_note text,
  current_step integer not null default 1,
  terms_accepted boolean not null default false,
  privacy_accepted boolean not null default false,
  data_processing_accepted boolean not null default false,
  information_confirmed boolean not null default false,
  consented_at timestamptz,
  submission_ip_hash text,
  submission_device_hash text,
  submitted_at timestamptz,
  assigned_reviewer_profile_id uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  reviewed_by_profile_id uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  approved_organization_id uuid unique references public.organizations(id) on delete set null,
  rejected_at timestamptz,
  withdrawn_at timestamptz,
  expires_at timestamptz,
  reapplication_allowed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint merchant_applications_application_number_format check (
    application_number ~ '^APP-[0-9]{6}-[0-9]{6,}$'
  ),
  constraint merchant_applications_email_format check (
    applicant_email = lower(applicant_email)
    and length(applicant_email) between 3 and 254
  ),
  constraint merchant_applications_slug_format check (
    requested_slug is null or requested_slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'
  ),
  constraint merchant_applications_step_range check (current_step between 1 and 4),
  constraint merchant_applications_estimated_orders_range check (
    estimated_daily_orders is null or estimated_daily_orders between 0 and 100000
  ),
  constraint merchant_applications_risk_reasons_array check (
    risk_reasons_json is null or jsonb_typeof(risk_reasons_json) = 'array'
  ),
  constraint merchant_applications_submitted_fields check (
    status not in ('SUBMITTED', 'PENDING_REVIEW', 'NEEDS_INFO', 'APPROVED', 'REJECTED')
    or (
      merchant_name is not null and business_type is not null and contact_name is not null
      and phone is not null and phone_hash is not null
      and business_phone is not null
      and preferred_contact_method is not null and business_address is not null and city is not null
      and stall_name is not null and stall_location is not null and requested_slug is not null
      and terms_accepted and privacy_accepted and data_processing_accepted and information_confirmed
      and consented_at is not null and submitted_at is not null
    )
  )
);

create unique index merchant_applications_one_active_per_profile_idx
  on public.merchant_applications (applicant_profile_id)
  where status in ('DRAFT', 'SUBMITTED', 'PENDING_REVIEW', 'NEEDS_INFO');
create index merchant_applications_applicant_status_idx
  on public.merchant_applications (applicant_profile_id, status, created_at desc);
create index merchant_applications_review_queue_idx
  on public.merchant_applications (status, submitted_at, created_at);
create index merchant_applications_reviewer_queue_idx
  on public.merchant_applications (assigned_reviewer_profile_id, status, submitted_at);
create index merchant_applications_phone_hash_idx
  on public.merchant_applications (phone_hash, status);
create index merchant_applications_registration_hash_idx
  on public.merchant_applications (business_registration_number_hash, status);
create index merchant_applications_slug_idx
  on public.merchant_applications (requested_slug, status);

create table public.merchant_application_notifications (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.merchant_applications(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint merchant_application_notifications_type_format check (type ~ '^[A-Z][A-Z0-9_]{2,79}$'),
  constraint merchant_application_notifications_title_length check (length(title) between 1 and 120),
  constraint merchant_application_notifications_message_length check (length(message) between 1 and 1000)
);

create index merchant_application_notifications_profile_idx
  on public.merchant_application_notifications (profile_id, read_at, created_at desc);
create index merchant_application_notifications_application_idx
  on public.merchant_application_notifications (application_id, created_at desc);

create or replace function public.touch_merchant_application_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger merchant_applications_touch_updated_at
before update on public.merchant_applications
for each row execute function public.touch_merchant_application_updated_at();

alter table public.merchant_applications enable row level security;
alter table public.merchant_applications force row level security;
alter table public.merchant_application_notifications enable row level security;
alter table public.merchant_application_notifications force row level security;

revoke all on public.merchant_applications, public.merchant_application_notifications
  from public, anon, authenticated;

grant select (
  id, application_number, applicant_profile_id, applicant_email, applicant_display_name,
  merchant_name, business_type, business_registration_number, contact_name, phone, business_phone, line_id,
  preferred_contact_method, business_address, city, merchant_description, stall_name,
  stall_location, requested_slug, estimated_daily_orders, expected_start_date,
  needs_multiple_staff, needs_kitchen_view, requested_plan_code, status,
  public_review_note, current_step, submitted_at, reviewed_at, approved_at,
  approved_organization_id, rejected_at, withdrawn_at, expires_at,
  reapplication_allowed, created_at, updated_at
) on public.merchant_applications to authenticated;

grant select on public.merchant_application_notifications to authenticated;
grant select, insert, update, delete on public.merchant_applications,
  public.merchant_application_notifications to service_role;
grant usage, select on sequence public.merchant_application_number_seq to service_role;

create policy merchant_applications_applicant_select on public.merchant_applications
for select to authenticated using (public.is_current_profile(applicant_profile_id));

create policy merchant_applications_platform_admin_select on public.merchant_applications
for select to authenticated using (public.is_platform_admin());

create policy merchant_application_notifications_owner_select
on public.merchant_application_notifications
for select to authenticated using (public.is_current_profile(profile_id));

create policy merchant_application_notifications_platform_admin_select
on public.merchant_application_notifications
for select to authenticated using (public.is_platform_admin());

revoke all on function public.touch_merchant_application_updated_at() from public, anon, authenticated;
grant execute on function public.touch_merchant_application_updated_at() to service_role;

create or replace function public.expire_stale_merchant_applications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with expired as (
    update public.merchant_applications
    set status = 'EXPIRED'::public.merchant_application_status,
        expires_at = now(),
        updated_at = now()
    where (status = 'DRAFT'::public.merchant_application_status and updated_at < now() - interval '30 days')
       or (status = 'NEEDS_INFO'::public.merchant_application_status and updated_at < now() - interval '30 days')
    returning id, applicant_profile_id
  ), notifications as (
    insert into public.merchant_application_notifications (
      application_id, profile_id, type, title, message
    )
    select id, applicant_profile_id, 'MERCHANT_APPLICATION_EXPIRED',
      '商家申請已逾期', '申請因長時間未更新而結束，請聯絡平台管理員確認是否可重新申請。'
    from expired
    returning id
  )
  select count(*)::integer into v_count from expired;
  return v_count;
end;
$$;

revoke all on function public.expire_stale_merchant_applications() from public, anon, authenticated;
grant execute on function public.expire_stale_merchant_applications() to service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema extensions;
    if not exists (select 1 from cron.job where jobname = 'stallorder-expire-merchant-applications') then
      perform cron.schedule(
        'stallorder-expire-merchant-applications',
        '23 * * * *',
        'select public.expire_stale_merchant_applications()'
      );
    end if;
  end if;
end;
$$;
