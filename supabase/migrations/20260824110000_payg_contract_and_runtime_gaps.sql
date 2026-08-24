begin;

set local lock_timeout = '5s';
set local statement_timeout = '10min';

alter table public.plan_versions
  add column if not exists billing_timezone text not null default 'Asia/Taipei',
  add column if not exists billing_cycle_anchor_day smallint not null default 1,
  add column if not exists billing_period_type text not null default 'CALENDAR_MONTH',
  add column if not exists invoice_close_delay_hours integer,
  add column if not exists tax_treatment text not null default 'UNCONFIGURED',
  add column if not exists tax_rate_bps integer,
  add column if not exists tax_jurisdiction text,
  add column if not exists tax_rounding_mode text not null default 'HALF_UP',
  add column if not exists tax_rounding_scope text not null default 'INVOICE',
  add column if not exists cap_tax_basis text,
  add column if not exists tax_document_required boolean not null default false,
  add column if not exists sealed_at timestamptz,
  add column if not exists sealed_by_profile_id uuid references public.profiles(id) on delete restrict,
  add column if not exists contract_hash varchar(64);

alter table public.plan_versions
  add constraint plan_versions_billing_timezone_check
    check (char_length(billing_timezone) between 3 and 100 and billing_timezone ~ '^[A-Za-z0-9_+./-]+$'),
  add constraint plan_versions_billing_cycle_check
    check (billing_cycle_anchor_day = 1 and billing_period_type = 'CALENDAR_MONTH'),
  add constraint plan_versions_close_delay_check
    check (invoice_close_delay_hours is null or invoice_close_delay_hours between 0 and 744),
  add constraint plan_versions_tax_treatment_check
    check (tax_treatment in ('UNCONFIGURED', 'INCLUSIVE', 'EXCLUSIVE', 'EXEMPT', 'OUT_OF_SCOPE')),
  add constraint plan_versions_tax_rate_check
    check (
      (tax_treatment = 'UNCONFIGURED' and tax_rate_bps is null and tax_jurisdiction is null and cap_tax_basis is null)
      or (tax_treatment in ('INCLUSIVE', 'EXCLUSIVE') and tax_rate_bps between 0 and 10000 and nullif(btrim(tax_jurisdiction), '') is not null and cap_tax_basis in ('TAX_INCLUSIVE_TOTAL', 'PRE_TAX_USAGE'))
      or (tax_treatment in ('EXEMPT', 'OUT_OF_SCOPE') and coalesce(tax_rate_bps, 0) = 0 and nullif(btrim(tax_jurisdiction), '') is not null)
    ),
  add constraint plan_versions_tax_rounding_check
    check (tax_rounding_mode in ('HALF_UP', 'HALF_EVEN', 'FLOOR', 'CEILING') and tax_rounding_scope in ('INVOICE', 'STALL_LINE')),
  add constraint plan_versions_seal_check
    check (
      (sealed_at is null and sealed_by_profile_id is null and contract_hash is null)
      or (sealed_at is not null and sealed_by_profile_id is not null and contract_hash ~ '^[a-f0-9]{64}$')
    );

alter table public.subscriptions
  add column if not exists billing_timezone text not null default 'Asia/Taipei',
  add column if not exists billing_cycle_anchor_day smallint not null default 1,
  add column if not exists billing_period_type text not null default 'CALENDAR_MONTH',
  add column if not exists invoice_close_delay_hours integer;

alter table public.subscriptions
  add constraint subscriptions_billing_timezone_check
    check (char_length(billing_timezone) between 3 and 100 and billing_timezone ~ '^[A-Za-z0-9_+./-]+$'),
  add constraint subscriptions_billing_cycle_check
    check (billing_cycle_anchor_day = 1 and billing_period_type = 'CALENDAR_MONTH'),
  add constraint subscriptions_close_delay_check
    check (invoice_close_delay_hours is null or invoice_close_delay_hours between 0 and 744);

create table public.billing_credit_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  subscription_id uuid not null references public.subscriptions(id) on delete restrict,
  stall_id uuid not null references public.stalls(id) on delete restrict,
  original_order_id uuid not null references public.orders(id) on delete restrict,
  original_usage_event_id uuid not null references public.usage_events(id) on delete restrict,
  refund_usage_event_id uuid not null unique references public.usage_events(id) on delete restrict,
  original_invoice_id uuid not null references public.invoices(id) on delete restrict,
  target_invoice_id uuid references public.invoices(id) on delete restrict,
  credit_amount integer not null check (credit_amount > 0),
  tax_credit_amount integer not null default 0 check (tax_credit_amount >= 0),
  currency text not null default 'TWD' check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'UNAPPLIED' check (status in ('UNAPPLIED', 'APPLIED', 'VOID')),
  reason_code text not null default 'LATE_FULL_REFUND' check (reason_code = 'LATE_FULL_REFUND'),
  idempotency_key text not null unique check (char_length(idempotency_key) between 10 and 160),
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  constraint billing_credit_adjustments_application_check check (
    (status = 'UNAPPLIED' and target_invoice_id is null and applied_at is null)
    or (status = 'APPLIED' and target_invoice_id is not null and applied_at is not null)
    or status = 'VOID'
  )
);

create index billing_credit_adjustments_org_status_idx
  on public.billing_credit_adjustments (organization_id, status, created_at);
create index billing_credit_adjustments_subscription_status_idx
  on public.billing_credit_adjustments (subscription_id, status, created_at);
create index billing_credit_adjustments_original_invoice_idx
  on public.billing_credit_adjustments (original_invoice_id, created_at);

create table public.payg_close_jobs (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete restrict,
  billing_period date not null,
  idempotency_key text not null unique check (char_length(idempotency_key) between 10 and 160),
  status text not null default 'PENDING' check (status in ('PENDING', 'RUNNING', 'SUCCEEDED', 'SKIPPED', 'FAILED')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 20),
  last_error_code text check (last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{1,100}$'),
  last_request_id text check (last_request_id is null or char_length(last_request_id) <= 120),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subscription_id, billing_period)
);

create index payg_close_jobs_status_period_idx
  on public.payg_close_jobs (status, billing_period, updated_at);

create trigger payg_close_jobs_touch_updated_at
before update on public.payg_close_jobs
for each row execute function public.touch_commercial_updated_at();

alter table public.invoice_line_items
  drop constraint if exists invoice_line_items_type_check;
alter table public.invoice_line_items
  add constraint invoice_line_items_type_check check (item_type in (
    'BASE_PLAN', 'ADDITIONAL_STALL', 'EXCESS_ORDER', 'ORDER_PACKAGE',
    'ADD_ON', 'CUSTOM_SERVICE', 'CREDIT', 'DISCOUNT', 'PAYG_USAGE'
  ));

create function app_private.enforce_plan_version_contract_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_in_use boolean;
  v_is_payg boolean;
begin
  select exists (
    select 1
    from public.plans plan
    where plan.id = old.plan_id
      and plan.code = 'PAYG'
  ) into v_is_payg;

  if not v_is_payg then
    return new;
  end if;

  select exists (
    select 1 from public.subscriptions where plan_version_id = old.id
    union all
    select 1 from public.invoices where plan_version_id = old.id
  ) into v_in_use;

  if (old.sealed_at is not null or v_in_use) and (
    old.plan_id is distinct from new.plan_id
    or old.version is distinct from new.version
    or old.display_name is distinct from new.display_name
    or old.billing_interval is distinct from new.billing_interval
    or old.base_price is distinct from new.base_price
    or old.annual_price is distinct from new.annual_price
    or old.currency is distinct from new.currency
    or old.trial_days is distinct from new.trial_days
    or old.included_stalls is distinct from new.included_stalls
    or old.max_stalls is distinct from new.max_stalls
    or old.additional_stall_price is distinct from new.additional_stall_price
    or old.max_staff is distinct from new.max_staff
    or old.max_products is distinct from new.max_products
    or old.max_qr_codes is distinct from new.max_qr_codes
    or old.included_orders is distinct from new.included_orders
    or old.report_retention_days is distinct from new.report_retention_days
    or old.overage_policy is distinct from new.overage_policy
    or old.pricing_mode is distinct from new.pricing_mode
    or old.usage_unit_price is distinct from new.usage_unit_price
    or old.usage_metric is distinct from new.usage_metric
    or old.usage_scope is distinct from new.usage_scope
    or old.monthly_cap_amount is distinct from new.monthly_cap_amount
    or old.minimum_charge is distinct from new.minimum_charge
    or old.billing_timezone is distinct from new.billing_timezone
    or old.billing_cycle_anchor_day is distinct from new.billing_cycle_anchor_day
    or old.billing_period_type is distinct from new.billing_period_type
    or old.invoice_close_delay_hours is distinct from new.invoice_close_delay_hours
    or old.tax_treatment is distinct from new.tax_treatment
    or old.tax_rate_bps is distinct from new.tax_rate_bps
    or old.tax_jurisdiction is distinct from new.tax_jurisdiction
    or old.tax_rounding_mode is distinct from new.tax_rounding_mode
    or old.tax_rounding_scope is distinct from new.tax_rounding_scope
    or old.cap_tax_basis is distinct from new.cap_tax_basis
    or old.tax_document_required is distinct from new.tax_document_required
  ) then
    raise exception using errcode = 'P0001', message = 'PLAN_VERSION_CONTRACT_IMMUTABLE';
  end if;

  if old.sealed_at is not null and (
    old.sealed_at is distinct from new.sealed_at
    or old.sealed_by_profile_id is distinct from new.sealed_by_profile_id
    or old.contract_hash is distinct from new.contract_hash
  ) then
    raise exception using errcode = 'P0001', message = 'PLAN_VERSION_SEAL_IMMUTABLE';
  end if;
  return new;
end;
$$;

create trigger plan_versions_contract_immutability_before_update
before update on public.plan_versions
for each row execute function app_private.enforce_plan_version_contract_immutability();

create function app_private.enforce_plan_entitlement_snapshot_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_plan_version_id uuid := coalesce(new.plan_version_id, old.plan_version_id);
begin
  if exists (
    select 1
    from public.plan_versions version
    join public.plans plan on plan.id = version.plan_id
    where version.id = v_plan_version_id
      and plan.code = 'PAYG'
      and (
        version.sealed_at is not null
        or exists (select 1 from public.subscriptions where plan_version_id = version.id)
        or exists (select 1 from public.invoices where plan_version_id = version.id)
      )
  ) then
    raise exception using errcode = 'P0001', message = 'PLAN_ENTITLEMENT_SNAPSHOT_IMMUTABLE';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger plan_entitlements_snapshot_immutability_before_write
before insert or update or delete on public.plan_entitlements
for each row execute function app_private.enforce_plan_entitlement_snapshot_immutability();

create or replace function public.record_billable_order_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period date;
  v_timezone text := 'Asia/Taipei';
begin
  if not new.is_test
    and new.origin not in ('TEST'::public.order_origin, 'SYSTEM_CANARY'::public.order_origin)
    and new.status = 'COMPLETED'::public.order_status
    and (tg_op = 'INSERT' or old.status <> 'COMPLETED'::public.order_status) then
    select subscription.billing_timezone into v_timezone
    from public.subscriptions subscription
    where subscription.organization_id = new.organization_id;
    v_timezone := coalesce(v_timezone, 'Asia/Taipei');
    v_period := date_trunc(
      'month', coalesce(new.completed_at, now()) at time zone v_timezone
    )::date;

    insert into public.usage_events (
      organization_id, stall_id, event_type, quantity, billing_period,
      reference_type, reference_id, occurred_at
    ) values (
      new.organization_id, new.stall_id, 'BILLABLE_ORDER_COMPLETED', 1,
      v_period, 'ORDER', new.id::text, coalesce(new.completed_at, now())
    ) on conflict do nothing;

    perform public.rebuild_billing_usage_summary(new.organization_id, v_period);
    perform public.rebuild_payg_stall_usage_summaries(new.organization_id, v_period);
    perform public.reconcile_billing_usage_warnings(new.organization_id, v_period);
  end if;
  return null;
end;
$$;

create or replace function public.record_billable_order_full_refund()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_completion public.usage_events%rowtype;
  v_refund public.usage_events%rowtype;
  v_invoice public.invoices%rowtype;
  v_subscription_id uuid;
  v_unit_price integer := 1;
  v_tax_treatment text := 'UNCONFIGURED';
  v_tax_rate_bps integer := 0;
  v_credit_amount integer := 1;
  v_tax_credit_amount integer := 0;
begin
  if new.payment_status = 'REFUNDED'::public.payment_status
    and old.payment_status is distinct from new.payment_status then
    select event.* into v_completion
    from public.usage_events event
    where event.event_type = 'BILLABLE_ORDER_COMPLETED'
      and event.reference_id = new.id::text
      and event.organization_id = new.organization_id
      and event.stall_id = new.stall_id
    limit 1;

    if found then
      insert into public.usage_events (
        organization_id, stall_id, event_type, quantity, billing_period,
        reference_type, reference_id, occurred_at
      ) values (
        new.organization_id, new.stall_id, 'BILLABLE_ORDER_FULL_REFUND', -1,
        v_completion.billing_period, 'ORDER', new.id::text, now()
      ) on conflict do nothing
      returning * into v_refund;

      perform public.rebuild_payg_stall_usage_summaries(
        new.organization_id, v_completion.billing_period
      );

      if v_refund.id is not null then
        select invoice.* into v_invoice
        from public.invoices invoice
        where invoice.organization_id = new.organization_id
          and invoice.billing_period_start = v_completion.billing_period
          and (
            invoice.status = 'PAID'
            or exists (
              select 1 from public.tax_documents document
              where document.invoice_id = invoice.id and document.status = 'ISSUED'
            )
          )
        order by invoice.created_at
        limit 1;

        if found then
          select subscription.id into v_subscription_id
          from public.subscriptions subscription
          where subscription.organization_id = new.organization_id;
          v_unit_price := greatest(coalesce((v_invoice.pricing_snapshot_json ->> 'usageUnitPrice')::integer, 1), 1);
          v_tax_treatment := coalesce(v_invoice.pricing_snapshot_json ->> 'taxTreatment', 'UNCONFIGURED');
          v_tax_rate_bps := greatest(coalesce((v_invoice.pricing_snapshot_json ->> 'taxRateBps')::integer, 0), 0);
          if v_tax_treatment = 'INCLUSIVE' then
            v_tax_credit_amount := floor((v_unit_price::numeric * v_tax_rate_bps / (10000 + v_tax_rate_bps)) + 0.5)::integer;
            v_credit_amount := greatest(v_unit_price - v_tax_credit_amount, 0);
          elsif v_tax_treatment = 'EXCLUSIVE' then
            v_credit_amount := v_unit_price;
            v_tax_credit_amount := floor((v_unit_price::numeric * v_tax_rate_bps / 10000) + 0.5)::integer;
          else
            v_credit_amount := v_unit_price;
            v_tax_credit_amount := 0;
          end if;

          insert into public.billing_credit_adjustments (
            organization_id, subscription_id, stall_id, original_order_id,
            original_usage_event_id, refund_usage_event_id, original_invoice_id,
            credit_amount, tax_credit_amount, currency, idempotency_key
          ) values (
            new.organization_id, v_subscription_id, new.stall_id, new.id,
            v_completion.id, v_refund.id, v_invoice.id,
            v_credit_amount, v_tax_credit_amount, v_invoice.currency,
            'PAYG_REFUND:' || v_refund.id::text
          ) on conflict (refund_usage_event_id) do nothing;
        end if;
      end if;
    end if;
  end if;
  return null;
end;
$$;

alter table public.billing_credit_adjustments enable row level security;
alter table public.billing_credit_adjustments force row level security;
alter table public.payg_close_jobs enable row level security;
alter table public.payg_close_jobs force row level security;

create policy billing_credit_adjustments_platform_select
on public.billing_credit_adjustments
for select to authenticated using (app_private.is_platform_admin());
create policy payg_close_jobs_platform_select
on public.payg_close_jobs
for select to authenticated using (app_private.is_platform_admin());

revoke all on table public.billing_credit_adjustments from public, anon, authenticated;
revoke all on table public.payg_close_jobs from public, anon, authenticated;
grant select on table public.billing_credit_adjustments to authenticated;
grant select on table public.payg_close_jobs to authenticated;
grant select, insert, update on table public.billing_credit_adjustments to service_role;
grant select, insert, update on table public.payg_close_jobs to service_role;

revoke all on function app_private.enforce_plan_version_contract_immutability()
  from public, anon, authenticated, service_role;
revoke all on function app_private.enforce_plan_entitlement_snapshot_immutability()
  from public, anon, authenticated, service_role;

comment on column public.plan_versions.contract_hash is
  'SHA-256 of the normalized immutable PlanVersion contract and ordered entitlement snapshot.';
comment on column public.subscriptions.billing_timezone is
  'Immutable billing timezone snapshotted from the sealed PlanVersion at activation or migration.';
comment on table public.billing_credit_adjustments is
  'Append-only late full-refund credits linked to the original paid PAYG invoice and usage ledger events.';
comment on table public.payg_close_jobs is
  'Durable idempotency and operational state for automatic PAYG month-close execution.';

commit;
