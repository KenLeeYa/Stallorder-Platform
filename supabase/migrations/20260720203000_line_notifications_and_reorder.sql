-- LINE status notifications, consent linking, secure outbox delivery, and reorder support.

create extension if not exists supabase_vault with schema vault;

do $$
begin
  create type public.notification_provider as enum ('LINE', 'IN_APP', 'EMAIL', 'WEB_PUSH');
exception when duplicate_object then null;
end
$$;

do $$
begin
  create type public.notification_integration_status as enum ('DISABLED', 'ACTIVE', 'ERROR');
exception when duplicate_object then null;
end
$$;

do $$
begin
  create type public.customer_consent_status as enum ('PENDING', 'GRANTED', 'REVOKED');
exception when duplicate_object then null;
end
$$;

do $$
begin
  create type public.notification_job_status as enum (
    'PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED'
  );
exception when duplicate_object then null;
end
$$;

do $$
begin
  create type public.line_link_session_status as enum ('ACTIVE', 'CONSUMED', 'EXPIRED', 'REVOKED');
exception when duplicate_object then null;
end
$$;

create table public.notification_integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid references public.stalls(id) on delete cascade,
  provider public.notification_provider not null,
  status public.notification_integration_status not null default 'DISABLED',
  public_identifier text,
  secret_reference uuid,
  settings_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_integrations_public_identifier_check check (
    public_identifier is null or char_length(public_identifier) between 1 and 120
  ),
  constraint notification_integrations_settings_check check (
    jsonb_typeof(settings_json) = 'object'
    and not (settings_json ?| array[
      'channelAccessToken', 'channelSecret', 'loginChannelSecret',
      'access_token', 'client_secret', 'providerUserId'
    ])
  ),
  constraint notification_integrations_active_check check (
    status <> 'ACTIVE'::public.notification_integration_status
    or (stall_id is not null and public_identifier is not null and secret_reference is not null)
  )
);
create unique index notification_integrations_stall_provider_unique
  on public.notification_integrations (stall_id, provider)
  where stall_id is not null;
create index notification_integrations_scope_idx
  on public.notification_integrations (organization_id, provider, status);

create table public.customer_contact_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  integration_id uuid not null references public.notification_integrations(id) on delete cascade,
  customer_reference_id uuid not null references public.orders(id) on delete cascade,
  provider public.notification_provider not null,
  provider_user_id_hash text not null,
  provider_user_secret_reference uuid not null,
  consent_status public.customer_consent_status not null default 'PENDING',
  consented_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_contact_links_order_provider_unique unique (customer_reference_id, provider),
  constraint customer_contact_links_hash_check check (provider_user_id_hash ~ '^[0-9a-f]{64}$'),
  constraint customer_contact_links_consent_check check (
    (consent_status = 'PENDING'::public.customer_consent_status
      and consented_at is null and revoked_at is null)
    or (consent_status = 'GRANTED'::public.customer_consent_status
      and consented_at is not null and revoked_at is null)
    or (consent_status = 'REVOKED'::public.customer_consent_status
      and revoked_at is not null)
  )
);
create index customer_contact_links_scope_idx
  on public.customer_contact_links (organization_id, stall_id, provider, consent_status);
create index customer_contact_links_provider_user_idx
  on public.customer_contact_links (provider_user_id_hash, provider);

create table public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  integration_id uuid not null references public.notification_integrations(id) on delete cascade,
  contact_link_id uuid not null references public.customer_contact_links(id) on delete cascade,
  order_id uuid references public.orders(id) on delete cascade,
  provider public.notification_provider not null,
  template_code text not null,
  recipient_reference uuid not null,
  status public.notification_job_status not null default 'PENDING',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz,
  last_error_code text,
  provider_message_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_jobs_order_template_unique unique (order_id, provider, template_code),
  constraint notification_jobs_template_check check (
    template_code in ('ORDER_CONFIRMED', 'ORDER_READY', 'ORDER_CANCELLED')
  ),
  constraint notification_jobs_attempt_count_check check (attempt_count between 0 and 10),
  constraint notification_jobs_error_length_check check (
    last_error_code is null or char_length(last_error_code) between 1 and 80
  ),
  constraint notification_jobs_terminal_check check (
    (status = 'SENT'::public.notification_job_status and sent_at is not null)
    or (status <> 'SENT'::public.notification_job_status and sent_at is null)
  )
);
create index notification_jobs_due_idx
  on public.notification_jobs (status, next_attempt_at, created_at)
  where status in ('PENDING', 'FAILED');
create index notification_jobs_scope_idx
  on public.notification_jobs (organization_id, stall_id, created_at desc);

create table public.line_link_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  integration_id uuid not null references public.notification_integrations(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  state_hash text not null unique,
  ephemeral_secret_reference uuid not null,
  status public.line_link_session_status not null default 'ACTIVE',
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint line_link_sessions_state_hash_check check (state_hash ~ '^[0-9a-f]{64}$'),
  constraint line_link_sessions_lifetime_check check (
    expires_at > created_at and expires_at <= created_at + interval '15 minutes'
  ),
  constraint line_link_sessions_status_check check (
    (status = 'CONSUMED'::public.line_link_session_status and consumed_at is not null)
    or (status <> 'CONSUMED'::public.line_link_session_status and consumed_at is null)
  )
);
create unique index line_link_sessions_one_active_order_idx
  on public.line_link_sessions (order_id)
  where status = 'ACTIVE';
create index line_link_sessions_expiry_idx
  on public.line_link_sessions (status, expires_at);

create table public.line_webhook_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  integration_id uuid not null references public.notification_integrations(id) on delete cascade,
  provider_event_hash text not null unique,
  event_type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint line_webhook_events_hash_check check (provider_event_hash ~ '^[0-9a-f]{64}$'),
  constraint line_webhook_events_type_check check (char_length(event_type) between 1 and 60)
);
create index line_webhook_events_integration_idx
  on public.line_webhook_events (integration_id, received_at desc);

create or replace function public.touch_notification_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger notification_integrations_touch_before_update
before update on public.notification_integrations
for each row execute function public.touch_notification_updated_at();
create trigger customer_contact_links_touch_before_update
before update on public.customer_contact_links
for each row execute function public.touch_notification_updated_at();
create trigger notification_jobs_touch_before_update
before update on public.notification_jobs
for each row execute function public.touch_notification_updated_at();
create trigger line_link_sessions_touch_before_update
before update on public.line_link_sessions
for each row execute function public.touch_notification_updated_at();
create trigger line_webhook_events_touch_before_update
before update on public.line_webhook_events
for each row execute function public.touch_notification_updated_at();

create or replace function public.enforce_notification_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_stall_id uuid;
  v_provider public.notification_provider;
  v_order_id uuid;
  v_integration_id uuid;
begin
  if new.stall_id is not null then
    select stall.organization_id into v_organization_id
    from public.stalls stall where stall.id = new.stall_id;
    if v_organization_id is null or v_organization_id <> new.organization_id then
      raise exception 'NOTIFICATION_STALL_SCOPE_MISMATCH';
    end if;
  end if;

  if tg_table_name = 'notification_integrations' then
    return new;
  end if;

  select integration.organization_id, integration.stall_id, integration.provider
    into v_organization_id, v_stall_id, v_provider
  from public.notification_integrations integration
  where integration.id = new.integration_id;
  if v_organization_id <> new.organization_id
     or v_stall_id is distinct from new.stall_id
     or v_provider <> new.provider then
    raise exception 'NOTIFICATION_INTEGRATION_SCOPE_MISMATCH';
  end if;

  if tg_table_name = 'customer_contact_links' then
    v_order_id := new.customer_reference_id;
  elsif tg_table_name = 'notification_jobs' then
    select link.customer_reference_id, link.integration_id
      into v_order_id, v_integration_id
    from public.customer_contact_links link where link.id = new.contact_link_id;
    if v_integration_id <> new.integration_id
       or new.recipient_reference is distinct from (
         select link.provider_user_secret_reference
         from public.customer_contact_links link where link.id = new.contact_link_id
       ) then
      raise exception 'NOTIFICATION_CONTACT_SCOPE_MISMATCH';
    end if;
    if new.order_id is distinct from v_order_id then
      raise exception 'NOTIFICATION_ORDER_REFERENCE_MISMATCH';
    end if;
  else
    return new;
  end if;

  if v_order_id is not null and not exists (
    select 1 from public.orders order_record
    where order_record.id = v_order_id
      and order_record.organization_id = new.organization_id
      and order_record.stall_id = new.stall_id
  ) then
    raise exception 'NOTIFICATION_ORDER_SCOPE_MISMATCH';
  end if;
  return new;
end;
$$;

-- LINE-only tables do not contain a provider column; enforce their scope separately.
create or replace function public.enforce_line_notification_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_stall_id uuid;
  v_provider public.notification_provider;
begin
  select integration.organization_id, integration.stall_id, integration.provider
    into v_organization_id, v_stall_id, v_provider
  from public.notification_integrations integration
  where integration.id = new.integration_id;
  if v_organization_id <> new.organization_id
     or v_stall_id is distinct from new.stall_id
     or v_provider <> 'LINE'::public.notification_provider then
    raise exception 'LINE_INTEGRATION_SCOPE_MISMATCH';
  end if;
  if tg_table_name = 'line_link_sessions' and not exists (
    select 1 from public.orders order_record
    where order_record.id = new.order_id
      and order_record.organization_id = new.organization_id
      and order_record.stall_id = new.stall_id
  ) then
    raise exception 'LINE_ORDER_SCOPE_MISMATCH';
  end if;
  return new;
end;
$$;

create trigger notification_integrations_scope_before_write
before insert or update on public.notification_integrations
for each row execute function public.enforce_notification_scope();
create trigger customer_contact_links_scope_before_write
before insert or update on public.customer_contact_links
for each row execute function public.enforce_notification_scope();
create trigger notification_jobs_scope_before_write
before insert or update on public.notification_jobs
for each row execute function public.enforce_notification_scope();
create trigger line_link_sessions_scope_before_write
before insert or update on public.line_link_sessions
for each row execute function public.enforce_line_notification_scope();
create trigger line_webhook_events_scope_before_write
before insert or update on public.line_webhook_events
for each row execute function public.enforce_line_notification_scope();

create or replace function public.store_notification_secret(
  p_name text,
  p_secret text,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
begin
  if p_name !~ '^stallorder_[a-z0-9_:-]{3,120}$'
     or char_length(coalesce(p_secret, '')) not between 16 and 20000 then
    raise exception 'NOTIFICATION_SECRET_INVALID';
  end if;
  select vault.create_secret(p_secret, p_name, left(coalesce(p_description, ''), 200))
    into v_secret_id;
  return v_secret_id;
end;
$$;

create or replace function public.read_notification_secret(p_secret_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select secret.decrypted_secret
  from vault.decrypted_secrets secret
  where secret.id = p_secret_id;
$$;

create or replace function public.delete_notification_secret(p_secret_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from vault.secrets secret where secret.id = p_secret_id;
$$;

create or replace function public.notification_feature_access_code(
  p_organization_id uuid,
  p_feature_code text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_subscription public.subscriptions%rowtype;
begin
  select subscription.* into v_subscription
  from public.subscriptions subscription
  where subscription.organization_id = p_organization_id;
  if not found or v_subscription.status = 'CANCELLED' then
    return 'SUBSCRIPTION_NOT_ACTIVE';
  elsif v_subscription.status = 'SUSPENDED' then
    return 'SUBSCRIPTION_SUSPENDED';
  elsif v_subscription.status = 'TRIALING'
        and (v_subscription.trial_ends_at is null or v_subscription.trial_ends_at <= now()) then
    return 'TRIAL_EXPIRED';
  elsif v_subscription.status not in ('TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE_PERIOD') then
    return 'SUBSCRIPTION_NOT_ACTIVE';
  end if;

  if exists (
    select 1 from public.plan_entitlements entitlement
    where entitlement.plan_version_id = v_subscription.plan_version_id
      and entitlement.feature_code = p_feature_code
      and entitlement.is_enabled
  ) or exists (
    select 1
    from public.subscription_items item
    join public.add_on_catalog add_on
      on add_on.code = item.code and add_on.feature_code = p_feature_code
    where item.subscription_id = v_subscription.id
      and item.status = 'ACTIVE'
      and item.starts_at <= now()
      and (item.ends_at is null or item.ends_at > now())
      and add_on.is_active
  ) then
    return 'OK';
  end if;
  return 'FEATURE_NOT_INCLUDED';
end;
$$;

create or replace function public.start_line_link_session(
  p_organization_id uuid,
  p_stall_id uuid,
  p_integration_id uuid,
  p_order_id uuid,
  p_state_hash text,
  p_ephemeral_secret text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid := gen_random_uuid();
  v_secret_id uuid;
  v_previous_secret_id uuid;
begin
  if p_state_hash !~ '^[0-9a-f]{64}$'
     or p_expires_at <= now()
     or p_expires_at > now() + interval '15 minutes'
     or char_length(coalesce(p_ephemeral_secret, '')) not between 16 and 20000 then
    raise exception 'LINE_LINK_SESSION_INVALID';
  end if;
  if public.notification_feature_access_code(p_organization_id, 'LINE_ORDER_LINKING') <> 'OK' then
    raise exception 'LINE_LINKING_NOT_AVAILABLE';
  end if;
  if not exists (
    select 1
    from public.notification_integrations integration
    where integration.id = p_integration_id
      and integration.organization_id = p_organization_id
      and integration.stall_id = p_stall_id
      and integration.provider = 'LINE'::public.notification_provider
      and integration.status = 'ACTIVE'::public.notification_integration_status
  ) or not exists (
    select 1
    from public.orders order_record
    where order_record.id = p_order_id
      and order_record.organization_id = p_organization_id
      and order_record.stall_id = p_stall_id
  ) then
    raise exception 'LINE_LINK_SCOPE_MISMATCH';
  end if;

  for v_previous_secret_id in
    select session.ephemeral_secret_reference
    from public.line_link_sessions session
    where session.order_id = p_order_id
      and session.status = 'ACTIVE'::public.line_link_session_status
    for update
  loop
    delete from vault.secrets secret where secret.id = v_previous_secret_id;
  end loop;
  update public.line_link_sessions
  set status = 'REVOKED'::public.line_link_session_status,
      updated_at = now()
  where order_id = p_order_id
    and status = 'ACTIVE'::public.line_link_session_status;

  select public.store_notification_secret(
    'stallorder_line_link_' || replace(v_session_id::text, '-', '_'),
    p_ephemeral_secret,
    'StallOrder one-time LINE OAuth state'
  ) into v_secret_id;

  insert into public.line_link_sessions (
    id, organization_id, stall_id, integration_id, order_id,
    state_hash, ephemeral_secret_reference, status, expires_at
  ) values (
    v_session_id, p_organization_id, p_stall_id, p_integration_id, p_order_id,
    p_state_hash, v_secret_id, 'ACTIVE'::public.line_link_session_status, p_expires_at
  );
  return v_session_id;
end;
$$;

create or replace function public.revoke_line_contact_link(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link_id uuid;
  v_secret_id uuid;
begin
  select link.id, link.provider_user_secret_reference
    into v_link_id, v_secret_id
  from public.customer_contact_links link
  where link.customer_reference_id = p_order_id
    and link.provider = 'LINE'::public.notification_provider
  for update;
  if v_link_id is null then
    return false;
  end if;

  update public.customer_contact_links
  set consent_status = 'REVOKED'::public.customer_consent_status,
      revoked_at = now(),
      updated_at = now()
  where id = v_link_id;
  update public.notification_jobs
  set status = 'CANCELLED'::public.notification_job_status,
      next_attempt_at = null,
      last_error_code = 'CONSENT_REVOKED',
      updated_at = now()
  where contact_link_id = v_link_id
    and status in ('PENDING', 'FAILED');
  delete from vault.secrets secret where secret.id = v_secret_id;
  return true;
end;
$$;

create or replace function public.enqueue_order_notification_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template_code text;
begin
  if old.status = new.status then
    return null;
  end if;
  v_template_code := case new.status
    when 'CONFIRMED'::public.order_status then 'ORDER_CONFIRMED'
    when 'READY'::public.order_status then 'ORDER_READY'
    when 'CANCELLED'::public.order_status then 'ORDER_CANCELLED'
    else null
  end;
  if v_template_code is null
     or public.notification_feature_access_code(new.organization_id, 'LINE_NOTIFICATIONS') <> 'OK' then
    return null;
  end if;

  insert into public.notification_jobs (
    organization_id, stall_id, integration_id, contact_link_id, order_id,
    provider, template_code, recipient_reference, status, next_attempt_at
  )
  select link.organization_id, link.stall_id, link.integration_id, link.id,
    new.id, link.provider, v_template_code, link.provider_user_secret_reference,
    'PENDING'::public.notification_job_status, now()
  from public.customer_contact_links link
  join public.notification_integrations integration on integration.id = link.integration_id
  where link.customer_reference_id = new.id
    and link.provider = 'LINE'::public.notification_provider
    and link.consent_status = 'GRANTED'::public.customer_consent_status
    and integration.status = 'ACTIVE'::public.notification_integration_status
  on conflict (order_id, provider, template_code) do nothing;
  return null;
end;
$$;

create trigger orders_enqueue_notification_job
after update of status on public.orders
for each row execute function public.enqueue_order_notification_job();

create or replace function app_private.expire_line_link_sessions(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_secret_id uuid;
begin
  for v_secret_id in
    select session.ephemeral_secret_reference
    from public.line_link_sessions session
    where session.status = 'ACTIVE'::public.line_link_session_status
      and session.expires_at <= p_now
    for update skip locked
  loop
    delete from vault.secrets secret where secret.id = v_secret_id;
  end loop;

  update public.line_link_sessions
  set status = 'EXPIRED'::public.line_link_session_status, updated_at = p_now
  where status = 'ACTIVE'::public.line_link_session_status and expires_at <= p_now;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

alter table public.operational_alerts
  drop constraint if exists operational_alerts_alert_type_check;
alter table public.operational_alerts
  add constraint operational_alerts_alert_type_check check (alert_type in (
    'EXCESSIVE_PENDING_ORDERS', 'HIGH_CANCELLATION_RATE', 'PAYMENT_MISMATCH',
    'ORDERING_PAUSED', 'STALL_OFFLINE', 'NO_RECENT_ACTIVITY',
    'UNPAID_COMPLETED_ORDER', 'KDS_ORDER_OVERDUE', 'STATION_BACKLOG',
    'CDS_DISCONNECTED', 'CAPACITY_WARNING', 'CAPACITY_AUTO_PAUSED',
    'CASH_SHIFT_NOT_CLOSED', 'CASH_OVER_SHORT', 'SCHEDULE_START_DELAYED',
    'LINE_NOTIFICATION_FAILURE'
  ));

alter table public.notification_integrations enable row level security;
alter table public.notification_integrations force row level security;
alter table public.customer_contact_links enable row level security;
alter table public.customer_contact_links force row level security;
alter table public.notification_jobs enable row level security;
alter table public.notification_jobs force row level security;
alter table public.line_link_sessions enable row level security;
alter table public.line_link_sessions force row level security;
alter table public.line_webhook_events enable row level security;
alter table public.line_webhook_events force row level security;

revoke all on table public.notification_integrations from public, anon, authenticated;
revoke all on table public.customer_contact_links from public, anon, authenticated;
revoke all on table public.notification_jobs from public, anon, authenticated;
revoke all on table public.line_link_sessions from public, anon, authenticated;
revoke all on table public.line_webhook_events from public, anon, authenticated;
grant select on table public.notification_integrations to authenticated;
grant select on table public.notification_jobs to authenticated;
grant select, insert, update, delete on table public.notification_integrations to service_role;
grant select, insert, update, delete on table public.customer_contact_links to service_role;
grant select, insert, update, delete on table public.notification_jobs to service_role;
grant select, insert, update, delete on table public.line_link_sessions to service_role;
grant select, insert, update, delete on table public.line_webhook_events to service_role;

create policy notification_integrations_manager_select on public.notification_integrations
for select to authenticated
using (
  (stall_id is not null and public.has_stall_role(
    stall_id, array['STALL_MANAGER']::public.user_role[]
  ))
  or public.has_organization_role(
    organization_id,
    array['ORGANIZATION_OWNER', 'ORGANIZATION_ADMIN']::public.user_role[]
  )
);
create policy notification_jobs_manager_select on public.notification_jobs
for select to authenticated
using (
  public.has_stall_role(stall_id, array['STALL_MANAGER']::public.user_role[])
  or public.has_organization_role(
    organization_id,
    array['ORGANIZATION_OWNER', 'ORGANIZATION_ADMIN']::public.user_role[]
  )
);

insert into public.plan_entitlements (
  plan_version_id, feature_code, is_enabled, limit_value, configuration_json
)
select version.id, feature.feature_code, true, null, feature.configuration_json
from public.plan_versions version
join public.plans plan on plan.id = version.plan_id
cross join lateral (
  values
    ('LINE_NOTIFICATIONS'::text, jsonb_build_object(
      'confirmed', true, 'ready', true, 'cancelled', true
    )),
    ('LINE_ORDER_LINKING'::text, jsonb_build_object('oauthPkce', true)),
    ('LINE_REPEAT_ORDER'::text, jsonb_build_object('currentPriceRevalidation', true))
) feature(feature_code, configuration_json)
where (
  feature.feature_code in ('LINE_NOTIFICATIONS', 'LINE_ORDER_LINKING')
  and plan.code in ('TRIAL', 'STANDARD', 'PRO', 'ENTERPRISE')
) or (
  feature.feature_code = 'LINE_REPEAT_ORDER'
  and plan.code in ('TRIAL', 'PRO', 'ENTERPRISE')
)
on conflict (plan_version_id, feature_code) do update
set is_enabled = excluded.is_enabled,
    limit_value = excluded.limit_value,
    configuration_json = excluded.configuration_json,
    updated_at = now();

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and not exists (select 1 from cron.job where jobname = 'stallorder-line-link-session-cleanup') then
    perform cron.schedule(
      'stallorder-line-link-session-cleanup',
      '*/5 * * * *',
      'select app_private.expire_line_link_sessions()'
    );
  end if;
end
$$;

create or replace function app_private.invoke_due_notification_jobs()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report_url text;
  v_url text;
  v_secret text;
  v_vercel_bypass_secret text;
  v_headers jsonb;
  v_request_id bigint;
begin
  select nullif(decrypted_secret, '') into v_report_url
  from vault.decrypted_secrets
  where name = 'stallorder_report_delivery_url'
  order by updated_at desc
  limit 1;
  select nullif(decrypted_secret, '') into v_secret
  from vault.decrypted_secrets
  where name = 'stallorder_report_delivery_cron_secret'
  order by updated_at desc
  limit 1;
  select nullif(decrypted_secret, '') into v_vercel_bypass_secret
  from vault.decrypted_secrets
  where name = 'stallorder_vercel_protection_bypass_secret'
  order by updated_at desc
  limit 1;

  if v_report_url is null or v_secret is null then
    raise notice 'NOTIFICATION_JOB_CRON_NOT_CONFIGURED';
    return null;
  end if;
  if v_report_url !~ '^https://[A-Za-z0-9.-]+/api/cron/report-deliveries$' then
    raise exception 'NOTIFICATION_JOB_CRON_URL_INVALID';
  end if;
  v_url := regexp_replace(
    v_report_url,
    '/api/cron/report-deliveries$',
    '/api/cron/notification-jobs'
  );
  v_headers := jsonb_build_object(
    'authorization', 'Bearer ' || v_secret,
    'user-agent', 'StallOrder Supabase Cron'
  );
  if v_vercel_bypass_secret is not null then
    v_headers := v_headers || jsonb_build_object(
      'x-vercel-protection-bypass', v_vercel_bypass_secret
    );
  end if;
  select net.http_get(
    url := v_url,
    headers := v_headers,
    timeout_milliseconds := 10000
  ) into v_request_id;
  return v_request_id;
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'stallorder-notification-jobs') then
      perform cron.unschedule('stallorder-notification-jobs');
    end if;
    perform cron.schedule(
      'stallorder-notification-jobs',
      '* * * * *',
      'select app_private.invoke_due_notification_jobs()'
    );
  end if;
end
$$;

revoke all on function public.touch_notification_updated_at() from public, anon, authenticated;
revoke all on function public.enforce_notification_scope() from public, anon, authenticated;
revoke all on function public.enforce_line_notification_scope() from public, anon, authenticated;
revoke all on function public.store_notification_secret(text, text, text) from public, anon, authenticated;
revoke all on function public.read_notification_secret(uuid) from public, anon, authenticated;
revoke all on function public.delete_notification_secret(uuid) from public, anon, authenticated;
revoke all on function public.notification_feature_access_code(uuid, text) from public, anon, authenticated;
revoke all on function public.start_line_link_session(uuid, uuid, uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.revoke_line_contact_link(uuid) from public, anon, authenticated;
revoke all on function public.enqueue_order_notification_job() from public, anon, authenticated;
revoke all on function app_private.expire_line_link_sessions(timestamptz) from public, anon, authenticated;
revoke all on function app_private.invoke_due_notification_jobs() from public, anon, authenticated;
grant execute on function public.store_notification_secret(text, text, text) to service_role;
grant execute on function public.read_notification_secret(uuid) to service_role;
grant execute on function public.delete_notification_secret(uuid) to service_role;
grant execute on function public.notification_feature_access_code(uuid, text) to service_role;
grant execute on function public.start_line_link_session(uuid, uuid, uuid, uuid, text, text, timestamptz) to service_role;
grant execute on function public.revoke_line_contact_link(uuid) to service_role;
grant execute on function app_private.expire_line_link_sessions(timestamptz) to service_role;
