-- Phase 6: database-configured plans, manual additional-stall billing,
-- usage metering, invitation tokens, and structured audit snapshots.

-- The legacy schema created this as a standalone unique index, so the Phase 1
-- DROP CONSTRAINT did not remove it. The scoped role constraint already
-- enforces the intended stall + profile + role uniqueness.
drop index if exists public.stall_memberships_user_id_stall_id_key;

alter table public.audit_logs
  add column before_json jsonb,
  add column after_json jsonb,
  add constraint audit_logs_before_object check (before_json is null or jsonb_typeof(before_json) = 'object'),
  add constraint audit_logs_after_object check (after_json is null or jsonb_typeof(after_json) = 'object');

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z][A-Z0-9_]{1,29}$'),
  display_name text not null check (char_length(display_name) between 1 and 80),
  base_price integer not null default 0 check (base_price >= 0),
  included_stalls integer not null check (included_stalls >= 1),
  additional_stall_price integer check (additional_stall_price is null or additional_stall_price >= 0),
  max_stalls integer check (max_stalls is null or max_stalls >= included_stalls),
  included_orders integer check (included_orders is null or included_orders >= 0),
  excess_order_price integer not null default 0 check (excess_order_price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.plans (
  code, display_name, base_price, included_stalls, additional_stall_price,
  max_stalls, included_orders, excess_order_price
) values
  ('LITE', 'Lite', 0, 1, null, 1, null, 0),
  ('STANDARD', 'Standard', 0, 1, 299, 10, null, 0),
  ('PRO', 'Pro', 0, 3, 199, 50, null, 0),
  ('ENTERPRISE', 'Enterprise', 0, 1, null, null, null, 0);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete restrict,
  status text not null default 'TRIALING' check (status in ('TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE_PERIOD', 'SUSPENDED', 'CANCELLED')),
  billing_period_start date not null,
  billing_period_end date not null,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_period_valid check (billing_period_end > billing_period_start)
);

create index subscriptions_plan_status_idx on public.subscriptions (plan_id, status);

insert into public.subscriptions (
  organization_id, plan_id, status, billing_period_start, billing_period_end
)
select organization.id, plan.id,
  case when organization.status = 'TRIALING'::public.tenant_status then 'TRIALING' else 'ACTIVE' end,
  date_trunc('month', now() at time zone organization.default_timezone)::date,
  (date_trunc('month', now() at time zone organization.default_timezone) + interval '1 month')::date
from public.organizations organization
cross join public.plans plan
where plan.code = 'STANDARD'
on conflict (organization_id) do nothing;

create table public.additional_stall_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  quantity integer not null check (quantity between 1 and 1000),
  unit_price integer not null check (unit_price >= 0),
  status text not null default 'APPROVED' check (status in ('APPROVED', 'REVOKED', 'EXPIRED')),
  approved_by uuid references public.profiles(id) on delete set null,
  reason text not null default '' check (char_length(reason) <= 500),
  effective_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint additional_stall_approval_expiry check (expires_at is null or expires_at > effective_at)
);

create index additional_stall_approvals_org_status_idx
  on public.additional_stall_approvals (organization_id, status, effective_at);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid not null references public.subscriptions(id) on delete restrict,
  invoice_number text not null unique check (char_length(invoice_number) between 1 and 80),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'ISSUED', 'PAID', 'VOID')),
  currency text not null default 'TWD' check (currency ~ '^[A-Z]{3}$'),
  billing_period_start date not null,
  billing_period_end date not null,
  subtotal integer not null default 0 check (subtotal >= 0),
  total integer not null default 0 check (total >= 0),
  issued_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_period_valid check (billing_period_end > billing_period_start),
  constraint invoices_total_consistent check (total >= subtotal)
);

create unique index invoices_org_period_idx
  on public.invoices (organization_id, billing_period_start, billing_period_end);
create index invoices_org_status_idx on public.invoices (organization_id, status, created_at desc);

create table public.invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  line_type text not null check (line_type in ('BASE_PLAN', 'ADDITIONAL_STALL', 'EXCESS_ORDER', 'ADD_ON')),
  description text not null check (char_length(description) between 1 and 300),
  quantity integer not null check (quantity > 0),
  unit_amount integer not null check (unit_amount >= 0),
  amount integer not null check (amount >= 0),
  reference_id text check (reference_id is null or char_length(reference_id) <= 120),
  created_at timestamptz not null default now(),
  constraint invoice_line_item_amount check (amount = quantity * unit_amount)
);

create index invoice_line_items_invoice_idx on public.invoice_line_items (invoice_id, created_at);
create index invoice_line_items_org_type_idx on public.invoice_line_items (organization_id, line_type, created_at);

create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid references public.stalls(id) on delete set null,
  event_type text not null check (event_type in (
    'ORDER_CREATED', 'ACTIVE_STALL_CHANGED', 'STAFF_MEMBERSHIP_CHANGED',
    'QR_CODE_CREATED', 'CSV_EXPORTED'
  )),
  quantity integer not null check (quantity <> 0),
  billing_period date not null,
  reference_id text check (reference_id is null or char_length(reference_id) <= 160),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint usage_events_billing_month check (extract(day from billing_period) = 1)
);

create unique index usage_events_dedupe_idx
  on public.usage_events (organization_id, event_type, reference_id)
  where reference_id is not null;
create index usage_events_org_period_type_idx
  on public.usage_events (organization_id, billing_period, event_type);
create index usage_events_stall_period_type_idx
  on public.usage_events (stall_id, billing_period, event_type)
  where stall_id is not null;

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid references public.stalls(id) on delete cascade,
  email text not null check (char_length(email) between 3 and 120),
  role public.user_role not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'PENDING' check (status in ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED')),
  invited_by uuid references public.profiles(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invitation_expiry_valid check (expires_at > created_at),
  constraint invitation_role_scope check (
    (stall_id is null and role in ('ORGANIZATION_OWNER', 'ORGANIZATION_ADMIN', 'FINANCE_VIEWER'))
    or
    (stall_id is not null and role in ('STALL_MANAGER', 'STAFF', 'KITCHEN'))
  )
);

create unique index organization_invitations_pending_idx
  on public.organization_invitations (organization_id, email, role, coalesce(stall_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'PENDING';
create index organization_invitations_org_status_idx
  on public.organization_invitations (organization_id, status, created_at desc);
create index organization_invitations_token_status_idx
  on public.organization_invitations (token_hash, status, expires_at);

create or replace function public.touch_commercial_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger plans_touch_updated_at
before update on public.plans
for each row execute function public.touch_commercial_updated_at();
create trigger subscriptions_touch_updated_at
before update on public.subscriptions
for each row execute function public.touch_commercial_updated_at();
create trigger additional_stall_approvals_touch_updated_at
before update on public.additional_stall_approvals
for each row execute function public.touch_commercial_updated_at();
create trigger invoices_touch_updated_at
before update on public.invoices
for each row execute function public.touch_commercial_updated_at();
create trigger organization_invitations_touch_updated_at
before update on public.organization_invitations
for each row execute function public.touch_commercial_updated_at();

create or replace function public.enforce_commercial_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  expected_organization_id uuid;
begin
  if tg_table_name = 'additional_stall_approvals' then
    select subscription.organization_id into expected_organization_id
    from public.subscriptions subscription where subscription.id = new.subscription_id;
  elsif tg_table_name = 'invoices' then
    select subscription.organization_id into expected_organization_id
    from public.subscriptions subscription where subscription.id = new.subscription_id;
  elsif tg_table_name = 'invoice_line_items' then
    select invoice.organization_id into expected_organization_id
    from public.invoices invoice where invoice.id = new.invoice_id;
  elsif tg_table_name = 'organization_invitations' and new.stall_id is not null then
    select stall.organization_id into expected_organization_id
    from public.stalls stall where stall.id = new.stall_id;
  elsif tg_table_name = 'usage_events' and new.stall_id is not null then
    select stall.organization_id into expected_organization_id
    from public.stalls stall where stall.id = new.stall_id;
  else
    expected_organization_id := new.organization_id;
  end if;

  if expected_organization_id is null or new.organization_id <> expected_organization_id then
    raise exception 'COMMERCIAL_ORGANIZATION_SCOPE_MISMATCH';
  end if;
  return new;
end;
$$;

create trigger additional_stall_approvals_scope_before_write
before insert or update on public.additional_stall_approvals
for each row execute function public.enforce_commercial_scope();
create trigger invoices_scope_before_write
before insert or update on public.invoices
for each row execute function public.enforce_commercial_scope();
create trigger invoice_line_items_scope_before_write
before insert or update on public.invoice_line_items
for each row execute function public.enforce_commercial_scope();
create trigger usage_events_scope_before_write
before insert or update on public.usage_events
for each row execute function public.enforce_commercial_scope();
create trigger organization_invitations_scope_before_write
before insert or update on public.organization_invitations
for each row execute function public.enforce_commercial_scope();

create or replace function public.record_order_usage()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  stall_timezone text;
begin
  select stall.timezone into stall_timezone from public.stalls stall where stall.id = new.stall_id;
  insert into public.usage_events (
    organization_id, stall_id, event_type, quantity, billing_period, reference_id, occurred_at
  ) values (
    new.organization_id, new.stall_id, 'ORDER_CREATED', 1,
    date_trunc('month', new.created_at at time zone coalesce(stall_timezone, 'Asia/Taipei'))::date,
    new.id::text, new.created_at
  ) on conflict do nothing;
  return new;
end;
$$;

create trigger orders_record_usage_after_insert
after insert on public.orders
for each row execute function public.record_order_usage();

create or replace function public.record_stall_usage()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or old.is_active is distinct from new.is_active then
    insert into public.usage_events (
      organization_id, stall_id, event_type, quantity, billing_period, reference_id
    ) values (
      new.organization_id, new.id, 'ACTIVE_STALL_CHANGED',
      case when new.is_active then 1 else -1 end,
      date_trunc('month', now() at time zone new.timezone)::date,
      new.id::text || ':' || extract(epoch from clock_timestamp())::text
    );
  end if;
  return new;
end;
$$;

create trigger stalls_record_usage_after_write
after insert or update of is_active on public.stalls
for each row execute function public.record_stall_usage();

create or replace function public.record_qr_usage()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  stall_timezone text;
begin
  select stall.timezone into stall_timezone from public.stalls stall where stall.id = new.stall_id;
  insert into public.usage_events (
    organization_id, stall_id, event_type, quantity, billing_period, reference_id, occurred_at
  ) values (
    new.organization_id, new.stall_id, 'QR_CODE_CREATED', 1,
    date_trunc('month', new.created_at at time zone coalesce(stall_timezone, 'Asia/Taipei'))::date,
    new.id::text, new.created_at
  ) on conflict do nothing;
  return new;
end;
$$;

create trigger qr_codes_record_usage_after_insert
after insert on public.qr_codes
for each row execute function public.record_qr_usage();

create or replace function public.record_organization_member_usage()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_organization_id uuid := coalesce(new.organization_id, old.organization_id);
  target_profile_id uuid := coalesce(new.profile_id, old.profile_id);
  target_membership_id uuid := coalesce(new.id, old.id);
  was_active boolean := case when tg_op = 'INSERT' then false else old.is_active end;
  is_active_now boolean := case when tg_op = 'DELETE' then false else new.is_active end;
  active_membership_count integer;
  organization_timezone text;
  usage_quantity integer;
begin
  if was_active = is_active_now then
    return coalesce(new, old);
  end if;

  select count(*) into active_membership_count
  from (
    select 1 from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.profile_id = target_profile_id
      and membership.is_active
    union all
    select 1 from public.stall_memberships membership
    where membership.organization_id = target_organization_id
      and membership.profile_id = target_profile_id
      and membership.is_active
  ) active_memberships;

  if is_active_now and active_membership_count = 1 then
    usage_quantity := 1;
  elsif not is_active_now and active_membership_count = 0 then
    usage_quantity := -1;
  else
    return coalesce(new, old);
  end if;

  select organization.default_timezone into organization_timezone
  from public.organizations organization where organization.id = target_organization_id;
  insert into public.usage_events (
    organization_id, event_type, quantity, billing_period, reference_id
  ) values (
    target_organization_id, 'STAFF_MEMBERSHIP_CHANGED', usage_quantity,
    date_trunc('month', now() at time zone coalesce(organization_timezone, 'Asia/Taipei'))::date,
    'organization-membership:' || target_membership_id::text || ':' || extract(epoch from clock_timestamp())::text
  );
  return coalesce(new, old);
end;
$$;

create trigger organization_memberships_record_usage_after_write
after insert or update of is_active or delete on public.organization_memberships
for each row execute function public.record_organization_member_usage();

create or replace function public.record_stall_member_usage()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_organization_id uuid := coalesce(new.organization_id, old.organization_id);
  target_stall_id uuid := coalesce(new.stall_id, old.stall_id);
  target_profile_id uuid := coalesce(new.profile_id, old.profile_id);
  target_membership_id uuid := coalesce(new.id, old.id);
  was_active boolean := case when tg_op = 'INSERT' then false else old.is_active end;
  is_active_now boolean := case when tg_op = 'DELETE' then false else new.is_active end;
  active_membership_count integer;
  stall_timezone text;
  usage_quantity integer;
begin
  if was_active = is_active_now then
    return coalesce(new, old);
  end if;

  select count(*) into active_membership_count
  from (
    select 1 from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.profile_id = target_profile_id
      and membership.is_active
    union all
    select 1 from public.stall_memberships membership
    where membership.organization_id = target_organization_id
      and membership.profile_id = target_profile_id
      and membership.is_active
  ) active_memberships;

  if is_active_now and active_membership_count = 1 then
    usage_quantity := 1;
  elsif not is_active_now and active_membership_count = 0 then
    usage_quantity := -1;
  else
    return coalesce(new, old);
  end if;

  select stall.timezone into stall_timezone from public.stalls stall where stall.id = target_stall_id;
  insert into public.usage_events (
    organization_id, stall_id, event_type, quantity, billing_period, reference_id
  ) values (
    target_organization_id, target_stall_id, 'STAFF_MEMBERSHIP_CHANGED', usage_quantity,
    date_trunc('month', now() at time zone coalesce(stall_timezone, 'Asia/Taipei'))::date,
    'stall-membership:' || target_membership_id::text || ':' || extract(epoch from clock_timestamp())::text
  );
  return coalesce(new, old);
end;
$$;

create trigger stall_memberships_record_usage_after_write
after insert or update of is_active or delete on public.stall_memberships
for each row execute function public.record_stall_member_usage();

insert into public.usage_events (
  organization_id, stall_id, event_type, quantity, billing_period, reference_id, occurred_at
)
select orders.organization_id, orders.stall_id, 'ORDER_CREATED', 1,
  date_trunc('month', orders.created_at at time zone stall.timezone)::date,
  orders.id::text, orders.created_at
from public.orders orders
join public.stalls stall on stall.id = orders.stall_id
on conflict do nothing;

insert into public.usage_events (
  organization_id, stall_id, event_type, quantity, billing_period, reference_id, occurred_at
)
select stall.organization_id, stall.id, 'ACTIVE_STALL_CHANGED', 1,
  date_trunc('month', stall.created_at at time zone stall.timezone)::date,
  stall.id::text || ':backfill', stall.created_at
from public.stalls stall where stall.is_active
on conflict do nothing;

insert into public.usage_events (
  organization_id, stall_id, event_type, quantity, billing_period, reference_id, occurred_at
)
select qr.organization_id, qr.stall_id, 'QR_CODE_CREATED', 1,
  date_trunc('month', qr.created_at at time zone stall.timezone)::date,
  qr.id::text, qr.created_at
from public.qr_codes qr
join public.stalls stall on stall.id = qr.stall_id
on conflict do nothing;

insert into public.usage_events (
  organization_id, event_type, quantity, billing_period, reference_id, occurred_at
)
select membership.organization_id, 'STAFF_MEMBERSHIP_CHANGED', 1,
  date_trunc('month', now() at time zone organization.default_timezone)::date,
  'profile:' || membership.profile_id::text || ':backfill', now()
from (
  select organization_id, profile_id from public.organization_memberships where is_active
  union
  select organization_id, profile_id from public.stall_memberships where is_active
) membership
join public.organizations organization on organization.id = membership.organization_id
on conflict do nothing;

alter table public.plans enable row level security;
alter table public.plans force row level security;
alter table public.subscriptions enable row level security;
alter table public.subscriptions force row level security;
alter table public.additional_stall_approvals enable row level security;
alter table public.additional_stall_approvals force row level security;
alter table public.invoices enable row level security;
alter table public.invoices force row level security;
alter table public.invoice_line_items enable row level security;
alter table public.invoice_line_items force row level security;
alter table public.usage_events enable row level security;
alter table public.usage_events force row level security;
alter table public.organization_invitations enable row level security;
alter table public.organization_invitations force row level security;

revoke all on public.plans, public.subscriptions, public.additional_stall_approvals,
  public.invoices, public.invoice_line_items, public.usage_events,
  public.organization_invitations from public, anon, authenticated;
grant select on public.plans to authenticated;
grant select on public.subscriptions, public.additional_stall_approvals,
  public.invoices, public.invoice_line_items, public.usage_events,
  public.organization_invitations to authenticated;
grant select, insert, update, delete on public.plans, public.subscriptions,
  public.additional_stall_approvals, public.invoices, public.invoice_line_items,
  public.usage_events, public.organization_invitations to service_role;

create policy plans_authenticated_select on public.plans
for select to authenticated using (is_active);

create policy subscriptions_financial_select on public.subscriptions
for select to authenticated using (
  public.has_organization_role(
    organization_id,
    array[
      'ORGANIZATION_OWNER'::public.user_role,
      'ORGANIZATION_ADMIN'::public.user_role,
      'FINANCE_VIEWER'::public.user_role
    ]
  )
);

create policy additional_stall_approvals_financial_select on public.additional_stall_approvals
for select to authenticated using (
  public.has_organization_role(
    organization_id,
    array[
      'ORGANIZATION_OWNER'::public.user_role,
      'ORGANIZATION_ADMIN'::public.user_role,
      'FINANCE_VIEWER'::public.user_role
    ]
  )
);

create policy invoices_financial_select on public.invoices
for select to authenticated using (
  public.has_organization_role(
    organization_id,
    array[
      'ORGANIZATION_OWNER'::public.user_role,
      'ORGANIZATION_ADMIN'::public.user_role,
      'FINANCE_VIEWER'::public.user_role
    ]
  )
);

create policy invoice_line_items_financial_select on public.invoice_line_items
for select to authenticated using (
  public.has_organization_role(
    organization_id,
    array[
      'ORGANIZATION_OWNER'::public.user_role,
      'ORGANIZATION_ADMIN'::public.user_role,
      'FINANCE_VIEWER'::public.user_role
    ]
  )
);

create policy usage_events_financial_select on public.usage_events
for select to authenticated using (
  public.has_organization_role(
    organization_id,
    array[
      'ORGANIZATION_OWNER'::public.user_role,
      'ORGANIZATION_ADMIN'::public.user_role,
      'FINANCE_VIEWER'::public.user_role
    ]
  )
);

create policy organization_invitations_manager_select on public.organization_invitations
for select to authenticated using (
  public.has_organization_role(
    organization_id,
    array['ORGANIZATION_OWNER'::public.user_role, 'ORGANIZATION_ADMIN'::public.user_role]
  )
  or (
    stall_id is not null
    and public.has_stall_role(stall_id, array['STALL_MANAGER'::public.user_role])
  )
);
