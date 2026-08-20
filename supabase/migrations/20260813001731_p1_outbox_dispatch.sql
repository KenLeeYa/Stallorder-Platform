-- QR-P1-06: make the billing notification outbox dispatchable and keep the
-- contract-free domain outbox dormant. All worker functions are server-only.

alter table public.notification_outbox
  add column if not exists max_attempts integer not null default 5,
  add column if not exists claimed_by_worker text,
  add column if not exists lease_expires_at timestamptz;

alter table public.notification_outbox
  add constraint notification_outbox_max_attempts_check
    check (max_attempts between 1 and 20),
  add constraint notification_outbox_claim_check check (
    (claimed_by_worker is null and lease_expires_at is null)
    or (
      status = 'PENDING'
      and claimed_by_worker is not null
      and lease_expires_at is not null
    )
  ),
  add constraint notification_outbox_worker_check check (
    claimed_by_worker is null
    or (
      char_length(claimed_by_worker) between 1 and 120
      and claimed_by_worker ~ '^[A-Za-z0-9:_-]+$'
    )
  );

create index notification_outbox_dispatch_queue_idx
  on public.notification_outbox (status, available_at, created_at)
  where status = 'PENDING';
create index notification_outbox_expired_lease_idx
  on public.notification_outbox (lease_expires_at)
  where status = 'PENDING' and claimed_by_worker is not null;
create index notification_outbox_dead_letter_idx
  on public.notification_outbox (updated_at desc)
  where status = 'FAILED';

create function app_private.claim_notification_outbox(
  p_worker_id text,
  p_limit integer default 20,
  p_now timestamptz default now(),
  p_lease_seconds integer default 600
)
returns setof public.notification_outbox
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_worker_id is null
     or p_worker_id !~ '^[A-Za-z0-9:_-]{1,120}$' then
    raise exception 'NOTIFICATION_OUTBOX_WORKER_INVALID' using errcode = '22023';
  end if;
  if p_limit not between 1 and 50 then
    raise exception 'NOTIFICATION_OUTBOX_LIMIT_INVALID' using errcode = '22023';
  end if;
  if p_lease_seconds not between 30 and 1800 then
    raise exception 'NOTIFICATION_OUTBOX_LEASE_INVALID' using errcode = '22023';
  end if;

  update public.notification_outbox outbox
  set status = case
        when outbox.attempt_count >= outbox.max_attempts then 'FAILED'
        else 'PENDING'
      end,
      available_at = case
        when outbox.attempt_count >= outbox.max_attempts then outbox.available_at
        else p_now
      end,
      claimed_by_worker = null,
      lease_expires_at = null,
      last_error_code = case
        when outbox.attempt_count >= outbox.max_attempts
          then 'OUTBOX_LEASE_EXPIRED_MAX_ATTEMPTS'
        else 'OUTBOX_LEASE_EXPIRED'
      end,
      updated_at = p_now
  where outbox.status = 'PENDING'
    and outbox.claimed_by_worker is not null
    and outbox.lease_expires_at <= p_now;

  update public.notification_outbox outbox
  set status = 'FAILED',
      claimed_by_worker = null,
      lease_expires_at = null,
      last_error_code = coalesce(outbox.last_error_code, 'OUTBOX_MAX_ATTEMPTS_EXHAUSTED'),
      updated_at = p_now
  where outbox.status = 'PENDING'
    and outbox.claimed_by_worker is null
    and outbox.lease_expires_at is null
    and outbox.attempt_count >= outbox.max_attempts;

  return query
  with candidates as (
    select outbox.id
    from public.notification_outbox outbox
    where outbox.status = 'PENDING'
      and outbox.claimed_by_worker is null
      and outbox.lease_expires_at is null
      and outbox.available_at <= p_now
      and outbox.attempt_count < outbox.max_attempts
    order by outbox.available_at, outbox.created_at, outbox.id
    for update skip locked
    limit p_limit
  )
  update public.notification_outbox outbox
  set attempt_count = outbox.attempt_count + 1,
      claimed_by_worker = p_worker_id,
      lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
      updated_at = p_now
  from candidates
  where outbox.id = candidates.id
  returning outbox.*;
end;
$$;

create function app_private.complete_notification_outbox(
  p_outbox_id uuid,
  p_worker_id text,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.notification_outbox outbox
    where outbox.id = p_outbox_id
      and outbox.status = 'DELIVERED'
  ) then
    return true;
  end if;

  update public.notification_outbox outbox
  set status = 'DELIVERED',
      delivered_at = coalesce(outbox.delivered_at, p_now),
      claimed_by_worker = null,
      lease_expires_at = null,
      last_error_code = null,
      updated_at = p_now
  where outbox.id = p_outbox_id
    and outbox.status = 'PENDING'
    and outbox.claimed_by_worker = p_worker_id;
  return found;
end;
$$;

create function app_private.fail_notification_outbox(
  p_outbox_id uuid,
  p_worker_id text,
  p_error_code text,
  p_retry_at timestamptz,
  p_now timestamptz default now()
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox public.notification_outbox%rowtype;
  v_status text;
  v_error_code text;
begin
  select * into v_outbox
  from public.notification_outbox outbox
  where outbox.id = p_outbox_id
  for update;

  if not found then return 'SKIPPED'; end if;
  if v_outbox.status = 'DELIVERED' then return 'DELIVERED'; end if;
  if v_outbox.status <> 'PENDING'
     or v_outbox.claimed_by_worker is distinct from p_worker_id then
    return 'SKIPPED';
  end if;

  v_error_code := left(regexp_replace(
    upper(coalesce(nullif(trim(p_error_code), ''), 'OUTBOX_DELIVERY_FAILED')),
    '[^A-Z0-9_]', '_', 'g'
  ), 120);
  v_status := case
    when p_retry_at is not null and v_outbox.attempt_count < v_outbox.max_attempts
      then 'RETRY_PENDING'
    else 'DEAD_LETTER'
  end;

  update public.notification_outbox outbox
  set status = case when v_status = 'RETRY_PENDING' then 'PENDING' else 'FAILED' end,
      available_at = case when v_status = 'RETRY_PENDING' then p_retry_at else outbox.available_at end,
      claimed_by_worker = null,
      lease_expires_at = null,
      last_error_code = v_error_code,
      updated_at = p_now
  where outbox.id = p_outbox_id;
  return v_status;
end;
$$;

create function app_private.notification_outbox_health(
  p_now timestamptz default now()
)
returns table (
  pending_depth integer,
  oldest_pending_age_seconds integer,
  dead_letter_depth integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    count(*) filter (
      where outbox.status = 'PENDING'
    )::integer as pending_depth,
    case
      when count(*) filter (
        where outbox.status = 'PENDING'
      ) = 0 then null
      else greatest(
        0,
        floor(extract(epoch from (
          p_now - min(outbox.created_at) filter (
            where outbox.status = 'PENDING'
          )
        )))
      )::integer
    end as oldest_pending_age_seconds,
    count(*) filter (where outbox.status = 'FAILED')::integer as dead_letter_depth
  from public.notification_outbox outbox;
$$;

create function app_private.quarantine_dormant_domain_outbox(
  p_now timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.domain_outbox outbox
  set status = 'CANCELLED',
      processed_at = coalesce(outbox.processed_at, p_now),
      last_error_code = 'DOMAIN_OUTBOX_DORMANT_NO_CONSUMER',
      updated_at = p_now
  where outbox.status in ('PENDING', 'PROCESSING', 'FAILED');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function app_private.claim_notification_outbox(text, integer, timestamptz, integer)
  from public, anon, authenticated;
revoke all on function app_private.complete_notification_outbox(uuid, text, timestamptz)
  from public, anon, authenticated;
revoke all on function app_private.fail_notification_outbox(uuid, text, text, timestamptz, timestamptz)
  from public, anon, authenticated;
revoke all on function app_private.notification_outbox_health(timestamptz)
  from public, anon, authenticated;
revoke all on function app_private.quarantine_dormant_domain_outbox(timestamptz)
  from public, anon, authenticated;

grant execute on function app_private.claim_notification_outbox(text, integer, timestamptz, integer)
  to service_role;
grant execute on function app_private.complete_notification_outbox(uuid, text, timestamptz)
  to service_role;
grant execute on function app_private.fail_notification_outbox(uuid, text, text, timestamptz, timestamptz)
  to service_role;
grant execute on function app_private.notification_outbox_health(timestamptz)
  to service_role;
grant execute on function app_private.quarantine_dormant_domain_outbox(timestamptz)
  to service_role;

comment on function app_private.claim_notification_outbox(text, integer, timestamptz, integer) is
  'Atomically claims billing notification deliveries with a bounded worker lease. The outbox UUID is the stable provider idempotency key.';
comment on function app_private.quarantine_dormant_domain_outbox(timestamptz) is
  'Fail-closed quarantine for domain events while no downstream consumer contract is approved.';
