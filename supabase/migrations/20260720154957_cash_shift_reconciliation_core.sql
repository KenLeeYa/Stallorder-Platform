-- Extend the existing P1 cash-shift ledger with payment attachment, review,
-- immutable close-out records, entitlement checks, and operational alerts.

do $$
begin
  create type public.cash_shift_review_decision as enum (
    'APPROVED', 'REJECTED', 'ADJUSTMENT_REQUIRED'
  );
exception when duplicate_object then null;
end
$$;

alter table public.cash_shifts
  drop constraint if exists cash_shifts_close_fields_check;
alter table public.cash_shifts
  add constraint cash_shifts_close_fields_check check (
    (
      status = 'OPEN'::public.cash_shift_status
      and closed_at is null
      and closed_by is null
      and system_expected_amount is null
      and counted_amount is null
      and variance_amount is null
    )
    or
    (
      status in (
        'CLOSING'::public.cash_shift_status,
        'REVIEW_REQUIRED'::public.cash_shift_status,
        'CLOSED'::public.cash_shift_status
      )
      and closed_at is not null
      and closed_by is not null
      and system_expected_amount is not null
      and counted_amount is not null
      and variance_amount is not null
    )
  );

create index if not exists cash_shifts_review_queue_idx
  on public.cash_shifts (organization_id, status, closed_at desc)
  where status in (
    'CLOSING'::public.cash_shift_status,
    'REVIEW_REQUIRED'::public.cash_shift_status
  );

alter table public.cash_movements
  add column if not exists reference_type text,
  add column if not exists reference_id uuid,
  add column if not exists updated_at timestamptz not null default now();
alter table public.cash_movements
  drop constraint if exists cash_movements_amount_check,
  drop constraint if exists cash_movements_reference_check;
alter table public.cash_movements
  add constraint cash_movements_amount_check check (
    amount between -100000000 and 100000000
    and amount <> 0
    and (
      type = 'CORRECTION'::public.cash_movement_type
      or amount > 0
    )
  ),
  add constraint cash_movements_reference_check check (
    (
      type in (
        'OPENING_FLOAT'::public.cash_movement_type,
        'CASH_SALE'::public.cash_movement_type,
        'CASH_REFUND'::public.cash_movement_type
      )
      and reference_type is not null
      and reference_id is not null
    )
    or
    (
      type in (
        'CASH_IN'::public.cash_movement_type,
        'CASH_OUT'::public.cash_movement_type,
        'CORRECTION'::public.cash_movement_type
      )
      and (
        (reference_type is null and reference_id is null)
        or (reference_type is not null and reference_id is not null)
      )
    )
  );

create unique index if not exists cash_movements_reference_type_unique
  on public.cash_movements (reference_type, reference_id, type)
  where reference_id is not null;

alter table public.payments
  add column if not exists cash_shift_id uuid references public.cash_shifts(id) on delete restrict;
create index if not exists payments_cash_shift_paid_idx
  on public.payments (cash_shift_id, status, paid_at)
  where cash_shift_id is not null;

-- Attach historical cash payments when an unambiguous shift time range exists.
update public.payments payment
set cash_shift_id = (
  select shift.id
  from public.cash_shifts shift
  where shift.organization_id = payment.organization_id
    and shift.stall_id = payment.stall_id
    and payment.paid_at >= shift.opened_at
    and payment.paid_at <= coalesce(shift.closed_at, now())
  order by shift.opened_at desc
  limit 1
)
where payment.method = 'CASH'::public.payment_method
  and payment.status = 'PAID'::public.payment_status
  and payment.cash_shift_id is null
  and exists (
    select 1
    from public.cash_shifts shift
    where shift.organization_id = payment.organization_id
      and shift.stall_id = payment.stall_id
      and payment.paid_at >= shift.opened_at
      and payment.paid_at <= coalesce(shift.closed_at, now())
  );

create table public.cash_shift_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  cash_shift_id uuid not null references public.cash_shifts(id) on delete restrict,
  reviewed_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  decision public.cash_shift_review_decision not null,
  comment text,
  reviewed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cash_shift_reviews_comment_length_check check (
    comment is null or char_length(comment) between 1 and 500
  ),
  constraint cash_shift_reviews_comment_required_check check (
    decision = 'APPROVED'::public.cash_shift_review_decision
    or comment is not null
  )
);

create index cash_shift_reviews_shift_idx
  on public.cash_shift_reviews (cash_shift_id, reviewed_at desc);
create index cash_shift_reviews_tenant_idx
  on public.cash_shift_reviews (organization_id, stall_id, reviewed_at desc);
create index cash_shift_reviews_reviewer_idx
  on public.cash_shift_reviews (reviewed_by_profile_id, reviewed_at desc);

create or replace function public.touch_cash_shift_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger cash_shifts_scope_before_write
before insert or update on public.cash_shifts
for each row execute function public.derive_stall_organization_scope();

create trigger cash_shifts_touch_before_update
before update on public.cash_shifts
for each row execute function public.touch_cash_shift_updated_at();

create trigger cash_movements_touch_before_update
before update on public.cash_movements
for each row execute function public.touch_cash_shift_updated_at();

create trigger cash_shift_reviews_touch_before_update
before update on public.cash_shift_reviews
for each row execute function public.touch_cash_shift_updated_at();

create or replace function public.enforce_cash_shift_review_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_shift public.cash_shifts%rowtype;
begin
  select * into v_shift
  from public.cash_shifts shift
  where shift.id = new.cash_shift_id;

  if not found then
    raise exception 'CASH_SHIFT_NOT_FOUND';
  end if;
  if new.organization_id <> v_shift.organization_id
     or new.stall_id <> v_shift.stall_id then
    raise exception 'CASH_SHIFT_REVIEW_SCOPE_MISMATCH';
  end if;
  return new;
end;
$$;

create trigger cash_shift_reviews_scope_before_write
before insert or update on public.cash_shift_reviews
for each row execute function public.enforce_cash_shift_review_scope();

create or replace function public.enforce_cash_movement_ledger()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_shift public.cash_shifts%rowtype;
begin
  select * into v_shift
  from public.cash_shifts shift
  where shift.id = new.cash_shift_id;

  if not found then
    raise exception 'CASH_SHIFT_NOT_FOUND';
  end if;
  if new.organization_id <> v_shift.organization_id
     or new.stall_id <> v_shift.stall_id then
    raise exception 'CASH_MOVEMENT_SCOPE_MISMATCH';
  end if;

  if v_shift.status = 'OPEN'::public.cash_shift_status then
    if new.type not in (
      'OPENING_FLOAT'::public.cash_movement_type,
      'CASH_SALE'::public.cash_movement_type,
      'CASH_REFUND'::public.cash_movement_type,
      'CASH_IN'::public.cash_movement_type,
      'CASH_OUT'::public.cash_movement_type
    ) then
      raise exception 'CASH_MOVEMENT_NOT_ALLOWED_FOR_OPEN_SHIFT';
    end if;
  elsif v_shift.status = 'REVIEW_REQUIRED'::public.cash_shift_status then
    if new.type <> 'CORRECTION'::public.cash_movement_type then
      raise exception 'ONLY_CORRECTION_ALLOWED_DURING_REVIEW';
    end if;
  else
    raise exception 'CASH_SHIFT_LEDGER_LOCKED';
  end if;

  return new;
end;
$$;

create trigger cash_movements_ledger_before_insert
before insert on public.cash_movements
for each row execute function public.enforce_cash_movement_ledger();

create or replace function public.prevent_cash_ledger_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'CASH_LEDGER_ENTRY_IMMUTABLE';
end;
$$;

create trigger cash_movements_immutable_before_update
before update on public.cash_movements
for each row execute function public.prevent_cash_ledger_update();

create or replace function public.prevent_closed_cash_shift_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'CLOSED'::public.cash_shift_status then
    raise exception 'CLOSED_CASH_SHIFT_IMMUTABLE';
  end if;
  return new;
end;
$$;

create trigger cash_shifts_closed_immutable_before_update
before update on public.cash_shifts
for each row execute function public.prevent_closed_cash_shift_update();

create or replace function public.enforce_payment_cash_shift()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_shift public.cash_shifts%rowtype;
  v_validate_paid boolean := false;
begin
  if tg_op = 'UPDATE' and (
    new.cash_shift_id is distinct from old.cash_shift_id
    or new.method is distinct from old.method
    or (
      new.method = 'CASH'::public.payment_method
      and new.amount is distinct from old.amount
    )
  ) then
    raise exception 'PAYMENT_CASH_SHIFT_IMMUTABLE';
  end if;

  if new.method <> 'CASH'::public.payment_method then
    if new.cash_shift_id is not null then
      raise exception 'NON_CASH_PAYMENT_CANNOT_HAVE_CASH_SHIFT';
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_validate_paid := new.status = 'PAID'::public.payment_status;
  else
    v_validate_paid := new.status = 'PAID'::public.payment_status
      and old.status is distinct from new.status;
  end if;

  if v_validate_paid then
    if new.cash_shift_id is null then
      raise exception 'ACTIVE_CASH_SHIFT_REQUIRED';
    end if;
    select * into v_shift
    from public.cash_shifts shift
    where shift.id = new.cash_shift_id
    for update;
    if not found
       or v_shift.organization_id <> new.organization_id
       or v_shift.stall_id <> new.stall_id
       or v_shift.status <> 'OPEN'::public.cash_shift_status then
      raise exception 'ACTIVE_CASH_SHIFT_REQUIRED';
    end if;
  end if;

  return new;
end;
$$;

create trigger payments_cash_shift_before_write
before insert or update on public.payments
for each row execute function public.enforce_payment_cash_shift();

create or replace function public.record_cash_sale_movement()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_record_sale boolean := false;
begin
  if tg_op = 'INSERT' then
    v_record_sale := true;
  else
    v_record_sale := old.status is distinct from new.status;
  end if;

  if v_record_sale
     and new.method = 'CASH'::public.payment_method
     and new.status = 'PAID'::public.payment_status
     and new.cash_shift_id is not null then
    insert into public.cash_movements (
      organization_id, stall_id, cash_shift_id, type, amount, reason,
      reference_type, reference_id, recorded_by, created_at, updated_at
    ) values (
      new.organization_id, new.stall_id, new.cash_shift_id,
      'CASH_SALE'::public.cash_movement_type, new.amount, '現金訂單收款',
      'PAYMENT', new.id, coalesce(new.recorded_by, (
        select shift.opened_by from public.cash_shifts shift where shift.id = new.cash_shift_id
      )), new.paid_at, now()
    ) on conflict (reference_type, reference_id, type) where reference_id is not null
      do nothing;
  end if;
  return null;
end;
$$;

create trigger payments_cash_sale_after_insert
after insert or update of status on public.payments
for each row execute function public.record_cash_sale_movement();

insert into public.cash_movements (
  organization_id, stall_id, cash_shift_id, type, amount, reason,
  reference_type, reference_id, recorded_by, created_at, updated_at
)
select
  shift.organization_id, shift.stall_id, shift.id,
  'OPENING_FLOAT'::public.cash_movement_type, shift.opening_amount,
  '開班預備金', 'CASH_SHIFT', shift.id, shift.opened_by,
  shift.opened_at, now()
from public.cash_shifts shift
where shift.opening_amount > 0
on conflict (reference_type, reference_id, type) where reference_id is not null
do nothing;

insert into public.cash_movements (
  organization_id, stall_id, cash_shift_id, type, amount, reason,
  reference_type, reference_id, recorded_by, created_at, updated_at
)
select
  payment.organization_id, payment.stall_id, payment.cash_shift_id,
  'CASH_SALE'::public.cash_movement_type, payment.amount,
  '現金訂單收款', 'PAYMENT', payment.id,
  coalesce(payment.recorded_by, shift.opened_by), payment.paid_at, now()
from public.payments payment
join public.cash_shifts shift on shift.id = payment.cash_shift_id
where payment.method = 'CASH'::public.payment_method
  and payment.status = 'PAID'::public.payment_status
  and payment.cash_shift_id is not null
on conflict (reference_type, reference_id, type) where reference_id is not null
do nothing;

create or replace function public.can_view_cash_shift(p_stall_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_view_stall_financials(p_stall_id)
    or public.has_stall_role(
      p_stall_id,
      array['STAFF'::public.user_role]
    );
$$;

alter table public.cash_shift_reviews enable row level security;
alter table public.cash_shift_reviews force row level security;

drop policy if exists cash_shifts_authorized_select on public.cash_shifts;
create policy cash_shifts_authorized_select on public.cash_shifts
for select to authenticated using (public.can_view_cash_shift(stall_id));

drop policy if exists cash_movements_authorized_select on public.cash_movements;
create policy cash_movements_authorized_select on public.cash_movements
for select to authenticated using (public.can_view_cash_shift(stall_id));

create policy cash_shift_reviews_authorized_select on public.cash_shift_reviews
for select to authenticated using (public.can_view_cash_shift(stall_id));

revoke all on table public.cash_shift_reviews from public, anon, authenticated;
grant select on table public.cash_shift_reviews to authenticated;
grant select, insert, update, delete on table public.cash_shift_reviews to service_role;

alter table public.operational_alerts
  drop constraint if exists operational_alerts_alert_type_check;
alter table public.operational_alerts
  add constraint operational_alerts_alert_type_check check (alert_type in (
    'EXCESSIVE_PENDING_ORDERS', 'HIGH_CANCELLATION_RATE', 'PAYMENT_MISMATCH',
    'ORDERING_PAUSED', 'STALL_OFFLINE', 'NO_RECENT_ACTIVITY',
    'UNPAID_COMPLETED_ORDER', 'KDS_ORDER_OVERDUE', 'STATION_BACKLOG',
    'CDS_DISCONNECTED', 'CAPACITY_WARNING', 'CAPACITY_AUTO_PAUSED',
    'CASH_SHIFT_NOT_CLOSED', 'CASH_OVER_SHORT'
  ));

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create or replace function app_private.refresh_cash_shift_alerts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed integer := 0;
  v_affected integer := 0;
begin
  update public.operational_alerts alert
  set status = 'RESOLVED', resolved_at = now(), updated_at = now()
  where alert.alert_type in ('CASH_SHIFT_NOT_CLOSED', 'CASH_OVER_SHORT')
    and alert.status in ('ACTIVE', 'ACKNOWLEDGED')
    and (
      (
        alert.alert_type = 'CASH_SHIFT_NOT_CLOSED'
        and not exists (
          select 1 from public.cash_shifts shift
          where shift.stall_id = alert.stall_id
            and shift.status = 'OPEN'::public.cash_shift_status
            and shift.opened_at <= now() - interval '12 hours'
        )
      )
      or
      (
        alert.alert_type = 'CASH_OVER_SHORT'
        and not exists (
          select 1 from public.cash_shifts shift
          where shift.stall_id = alert.stall_id
            and shift.status in (
              'CLOSING'::public.cash_shift_status,
              'REVIEW_REQUIRED'::public.cash_shift_status
            )
            and shift.variance_amount <> 0
        )
      )
    );
  get diagnostics v_affected = row_count;
  v_changed := v_changed + v_affected;

  insert into public.operational_alerts (
    organization_id, stall_id, alert_type, severity, message
  )
  select shift.organization_id, shift.stall_id, 'CASH_SHIFT_NOT_CLOSED', 'WARNING',
    '現金班次已超過 12 小時尚未關班，請確認交班狀態。'
  from public.cash_shifts shift
  where shift.status = 'OPEN'::public.cash_shift_status
    and shift.opened_at <= now() - interval '12 hours'
    and not exists (
      select 1 from public.operational_alerts alert
      where alert.stall_id = shift.stall_id
        and alert.alert_type = 'CASH_SHIFT_NOT_CLOSED'
        and alert.status in ('ACTIVE', 'ACKNOWLEDGED')
    )
  on conflict do nothing;
  get diagnostics v_affected = row_count;
  v_changed := v_changed + v_affected;

  insert into public.operational_alerts (
    organization_id, stall_id, alert_type, severity, message
  )
  select shift.organization_id, shift.stall_id, 'CASH_OVER_SHORT',
    case when abs(shift.variance_amount) >= 1000 then 'CRITICAL' else 'WARNING' end,
    '現金交班有短溢收差異，請由店長或組織管理者複核。'
  from public.cash_shifts shift
  where shift.status in (
      'CLOSING'::public.cash_shift_status,
      'REVIEW_REQUIRED'::public.cash_shift_status
    )
    and shift.variance_amount <> 0
    and not exists (
      select 1 from public.operational_alerts alert
      where alert.stall_id = shift.stall_id
        and alert.alert_type = 'CASH_OVER_SHORT'
        and alert.status in ('ACTIVE', 'ACKNOWLEDGED')
    )
  on conflict do nothing;
  get diagnostics v_affected = row_count;
  v_changed := v_changed + v_affected;

  return v_changed;
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and not exists (select 1 from cron.job where jobname = 'stallorder-cash-shift-alerts') then
    perform cron.schedule(
      'stallorder-cash-shift-alerts',
      '13 * * * *',
      'select app_private.refresh_cash_shift_alerts()'
    );
  end if;
end
$$;

insert into public.plan_entitlements (
  plan_version_id, feature_code, is_enabled, limit_value, configuration_json
)
select version.id, feature.feature_code, feature.is_enabled, feature.limit_value,
  feature.configuration_json
from public.plan_versions version
join public.plans plan on plan.id = version.plan_id
cross join lateral (
  values
    ('CASH_SHIFT'::text, true, 1::integer,
      jsonb_build_object('singleOpenShift', true)),
    ('CASH_RECONCILIATION'::text,
      plan.code in ('TRIAL', 'STANDARD', 'PRO', 'ENTERPRISE'),
      case when plan.code in ('TRIAL', 'STANDARD', 'PRO', 'ENTERPRISE') then 1 else 0 end,
      jsonb_build_object(
        'managerReview', plan.code in ('TRIAL', 'STANDARD', 'PRO', 'ENTERPRISE'),
        'crossStallReporting', plan.code in ('PRO', 'ENTERPRISE')
      ))
) feature(feature_code, is_enabled, limit_value, configuration_json)
where plan.code in ('TRIAL', 'LITE', 'STANDARD', 'PRO', 'ENTERPRISE')
on conflict (plan_version_id, feature_code) do update
set is_enabled = excluded.is_enabled,
    limit_value = excluded.limit_value,
    configuration_json = excluded.configuration_json,
    updated_at = now();

revoke all on function public.touch_cash_shift_updated_at() from public, anon, authenticated;
revoke all on function public.enforce_cash_shift_review_scope() from public, anon, authenticated;
revoke all on function public.enforce_cash_movement_ledger() from public, anon, authenticated;
revoke all on function public.prevent_cash_ledger_update() from public, anon, authenticated;
revoke all on function public.prevent_closed_cash_shift_update() from public, anon, authenticated;
revoke all on function public.enforce_payment_cash_shift() from public, anon, authenticated;
revoke all on function public.record_cash_sale_movement() from public, anon, authenticated;
revoke all on function public.can_view_cash_shift(uuid) from public, anon;
revoke all on function app_private.refresh_cash_shift_alerts() from public, anon, authenticated;

grant execute on function public.can_view_cash_shift(uuid) to authenticated;
grant execute on function app_private.refresh_cash_shift_alerts() to service_role;
