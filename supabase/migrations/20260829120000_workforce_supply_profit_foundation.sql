-- Workforce, purchasing, freshness and operating-profit foundation.
-- Additive only. Attendance events, orders, payments and supply movements remain
-- the canonical source ledgers; payroll and profit rows are auditable snapshots.

create table public.workforce_payroll_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  regular_day_minutes smallint not null default 480
    check (regular_day_minutes between 60 and 720),
  rounding_increment_minutes smallint not null default 1
    check (rounding_increment_minutes in (1, 5, 10, 15, 30)),
  overtime_tier1_minutes smallint not null default 120
    check (overtime_tier1_minutes between 0 and 360),
  overtime_tier1_multiplier_bps integer not null default 13333
    check (overtime_tier1_multiplier_bps between 10000 and 50000),
  overtime_tier2_multiplier_bps integer not null default 16667
    check (overtime_tier2_multiplier_bps between 10000 and 50000),
  default_holiday_multiplier_bps integer not null default 20000
    check (default_holiday_multiplier_bps between 10000 and 50000),
  updated_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workforce_wage_rates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  stall_id uuid,
  hourly_rate integer not null check (hourly_rate between 1 and 1000000),
  effective_from date not null,
  effective_to date,
  note varchar(300),
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workforce_wage_rates_stall_scope_fkey
    foreign key (stall_id, organization_id)
    references public.stalls(id, organization_id) on delete cascade,
  check (effective_to is null or effective_to >= effective_from)
);

create index workforce_wage_rates_lookup_idx
  on public.workforce_wage_rates (organization_id, profile_id, stall_id, effective_from desc);

create table public.workforce_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  work_date date not null,
  shift_start_at timestamptz,
  shift_end_at timestamptz,
  unpaid_break_minutes smallint not null default 0
    check (unpaid_break_minutes between 0 and 480),
  day_type varchar(24) not null default 'WORKDAY'
    check (day_type in ('WORKDAY', 'REST_DAY', 'REGULAR_DAY_OFF', 'NATIONAL_HOLIDAY')),
  status varchar(16) not null default 'PUBLISHED'
    check (status in ('DRAFT', 'PUBLISHED', 'CANCELLED')),
  note varchar(300),
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workforce_schedules_stall_scope_fkey
    foreign key (stall_id, organization_id)
    references public.stalls(id, organization_id) on delete cascade,
  check ((shift_start_at is null) = (shift_end_at is null)),
  check (shift_end_at is null or shift_end_at > shift_start_at)
);

create index workforce_schedules_employee_date_idx
  on public.workforce_schedules (organization_id, profile_id, work_date, status);
create index workforce_schedules_stall_date_idx
  on public.workforce_schedules (stall_id, work_date, status);

create table public.workforce_leave_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  leave_type varchar(24) not null
    check (leave_type in ('DAY_OFF', 'ANNUAL', 'PERSONAL', 'SICK', 'FAMILY', 'OTHER')),
  start_date date not null,
  end_date date not null,
  reason varchar(500),
  status varchar(16) not null default 'PENDING'
    check (status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  requested_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  reviewed_by_profile_id uuid references public.profiles(id) on delete set null,
  review_note varchar(500),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workforce_leave_requests_stall_scope_fkey
    foreign key (stall_id, organization_id)
    references public.stalls(id, organization_id) on delete cascade,
  check (end_date >= start_date)
);

create index workforce_leave_requests_queue_idx
  on public.workforce_leave_requests (organization_id, status, start_date, created_at);
create index workforce_leave_requests_employee_idx
  on public.workforce_leave_requests (profile_id, start_date desc, created_at desc);

create table public.workforce_holiday_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  holiday_date date not null,
  name varchar(120) not null,
  multiplier_bps integer not null default 20000
    check (multiplier_bps between 10000 and 50000),
  note varchar(300),
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, holiday_date)
);

create table public.workforce_payroll_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status varchar(16) not null default 'DRAFT'
    check (status in ('DRAFT', 'FINALIZED', 'VOID')),
  generated_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  generated_at timestamptz not null default now(),
  finalized_by_profile_id uuid references public.profiles(id) on delete set null,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, period_start, period_end),
  unique (id, organization_id),
  check (period_end >= period_start)
);

create table public.workforce_payroll_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payroll_period_id uuid not null,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  hourly_rate integer not null check (hourly_rate between 1 and 1000000),
  regular_minutes integer not null default 0 check (regular_minutes between 0 and 100000),
  overtime_tier1_minutes integer not null default 0 check (overtime_tier1_minutes between 0 and 100000),
  overtime_tier2_minutes integer not null default 0 check (overtime_tier2_minutes between 0 and 100000),
  holiday_minutes integer not null default 0 check (holiday_minutes between 0 and 100000),
  regular_amount integer not null default 0,
  overtime_amount integer not null default 0,
  holiday_amount integer not null default 0,
  manual_adjustment_amount integer not null default 0,
  gross_amount integer not null default 0 check (gross_amount >= 0),
  calculation_snapshot jsonb not null default '{}'::jsonb,
  note varchar(500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workforce_payroll_lines_period_scope_fkey
    foreign key (payroll_period_id, organization_id)
    references public.workforce_payroll_periods(id, organization_id) on delete cascade,
  unique (payroll_period_id, profile_id)
);

create index workforce_payroll_lines_org_profile_idx
  on public.workforce_payroll_lines (organization_id, profile_id, created_at desc);

create table public.supply_suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code varchar(40) not null,
  name varchar(120) not null,
  contact_name varchar(120),
  phone varchar(40),
  email varchar(254),
  payment_terms_days smallint not null default 0 check (payment_terms_days between 0 and 365),
  lead_time_days smallint not null default 0 check (lead_time_days between 0 and 365),
  is_active boolean not null default true,
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  unique (id, organization_id),
  check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$')
);

alter table public.supply_ingredients
  add column item_type varchar(20) not null default 'INGREDIENT'
    check (item_type in ('INGREDIENT', 'PACKAGING', 'CONSUMABLE')),
  add column track_expiry boolean not null default false,
  add column default_shelf_life_days smallint
    check (default_shelf_life_days is null or default_shelf_life_days between 1 and 3650),
  add column preferred_supplier_id uuid,
  add constraint supply_ingredients_preferred_supplier_scope_fkey
    foreign key (preferred_supplier_id, organization_id)
    references public.supply_suppliers(id, organization_id)
    on delete set null (preferred_supplier_id);

create table public.supply_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  supplier_id uuid not null,
  stall_id uuid,
  document_number varchar(80) not null,
  ordered_on date not null,
  expected_on date,
  status varchar(16) not null default 'DRAFT'
    check (status in ('DRAFT', 'ORDERED', 'PARTIAL', 'RECEIVED', 'CANCELLED')),
  subtotal_amount integer not null default 0 check (subtotal_amount >= 0),
  tax_amount integer not null default 0 check (tax_amount >= 0),
  freight_amount integer not null default 0 check (freight_amount >= 0),
  total_amount integer not null default 0 check (total_amount >= 0),
  note varchar(500),
  received_at timestamptz,
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supply_purchase_orders_supplier_scope_fkey
    foreign key (supplier_id, organization_id)
    references public.supply_suppliers(id, organization_id) on delete restrict,
  constraint supply_purchase_orders_stall_scope_fkey
    foreign key (stall_id, organization_id)
    references public.stalls(id, organization_id)
    on delete set null (stall_id),
  unique (organization_id, document_number),
  unique (id, organization_id)
);

create index supply_purchase_orders_date_idx
  on public.supply_purchase_orders (organization_id, ordered_on desc, status);

create table public.supply_purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  purchase_order_id uuid not null,
  ingredient_id uuid not null,
  location_id uuid not null,
  quantity_micros bigint not null check (quantity_micros > 0),
  unit_cost_micros bigint not null check (unit_cost_micros >= 0),
  line_amount integer not null check (line_amount >= 0),
  lot_number varchar(100),
  manufactured_on date,
  expires_on date,
  created_at timestamptz not null default now(),
  constraint supply_purchase_order_lines_order_scope_fkey
    foreign key (purchase_order_id, organization_id)
    references public.supply_purchase_orders(id, organization_id) on delete cascade,
  constraint supply_purchase_order_lines_ingredient_scope_fkey
    foreign key (ingredient_id, organization_id)
    references public.supply_ingredients(id, organization_id) on delete restrict,
  constraint supply_purchase_order_lines_location_scope_fkey
    foreign key (location_id, organization_id)
    references public.supply_locations(id, organization_id) on delete restrict,
  unique (id, organization_id),
  check (expires_on is null or manufactured_on is null or expires_on >= manufactured_on)
);

create index supply_purchase_order_lines_order_idx
  on public.supply_purchase_order_lines (purchase_order_id, id);

create table public.supply_inventory_lots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  purchase_order_line_id uuid,
  ingredient_id uuid not null,
  location_id uuid not null,
  lot_number varchar(100) not null,
  received_quantity_micros bigint not null check (received_quantity_micros > 0),
  remaining_quantity_micros bigint not null check (remaining_quantity_micros >= 0),
  unit_cost_micros bigint not null check (unit_cost_micros >= 0),
  manufactured_on date,
  expires_on date,
  received_at timestamptz not null default now(),
  status varchar(16) not null default 'AVAILABLE'
    check (status in ('AVAILABLE', 'CONSUMED', 'EXPIRED', 'QUARANTINED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supply_inventory_lots_purchase_line_scope_fkey
    foreign key (purchase_order_line_id, organization_id)
    references public.supply_purchase_order_lines(id, organization_id)
    on delete set null (purchase_order_line_id),
  constraint supply_inventory_lots_ingredient_scope_fkey
    foreign key (ingredient_id, organization_id)
    references public.supply_ingredients(id, organization_id) on delete restrict,
  constraint supply_inventory_lots_location_scope_fkey
    foreign key (location_id, organization_id)
    references public.supply_locations(id, organization_id) on delete restrict,
  unique (organization_id, ingredient_id, location_id, lot_number),
  check (remaining_quantity_micros <= received_quantity_micros),
  check (expires_on is null or manufactured_on is null or expires_on >= manufactured_on)
);

create index supply_inventory_lots_expiry_idx
  on public.supply_inventory_lots (organization_id, status, expires_on, ingredient_id)
  where remaining_quantity_micros > 0;

create table public.operating_expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid,
  expense_date date not null,
  category varchar(24) not null
    check (category in ('RENT', 'UTILITIES', 'PLATFORM_FEE', 'DELIVERY_FEE', 'MARKETING', 'MAINTENANCE', 'INSURANCE', 'TAX', 'OTHER')),
  amount integer not null check (amount > 0),
  vendor_name varchar(120),
  description varchar(300) not null,
  is_recurring boolean not null default false,
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operating_expenses_stall_scope_fkey
    foreign key (stall_id, organization_id)
    references public.stalls(id, organization_id)
    on delete set null (stall_id)
);

create index operating_expenses_period_idx
  on public.operating_expenses (organization_id, expense_date desc, category);

alter table public.workforce_payroll_policies enable row level security;
alter table public.workforce_payroll_policies force row level security;
alter table public.workforce_wage_rates enable row level security;
alter table public.workforce_wage_rates force row level security;
alter table public.workforce_schedules enable row level security;
alter table public.workforce_schedules force row level security;
alter table public.workforce_leave_requests enable row level security;
alter table public.workforce_leave_requests force row level security;
alter table public.workforce_holiday_rules enable row level security;
alter table public.workforce_holiday_rules force row level security;
alter table public.workforce_payroll_periods enable row level security;
alter table public.workforce_payroll_periods force row level security;
alter table public.workforce_payroll_lines enable row level security;
alter table public.workforce_payroll_lines force row level security;
alter table public.supply_suppliers enable row level security;
alter table public.supply_suppliers force row level security;
alter table public.supply_purchase_orders enable row level security;
alter table public.supply_purchase_orders force row level security;
alter table public.supply_purchase_order_lines enable row level security;
alter table public.supply_purchase_order_lines force row level security;
alter table public.supply_inventory_lots enable row level security;
alter table public.supply_inventory_lots force row level security;
alter table public.operating_expenses enable row level security;
alter table public.operating_expenses force row level security;

revoke all on table
  public.workforce_payroll_policies,
  public.workforce_wage_rates,
  public.workforce_schedules,
  public.workforce_leave_requests,
  public.workforce_holiday_rules,
  public.workforce_payroll_periods,
  public.workforce_payroll_lines,
  public.supply_suppliers,
  public.supply_purchase_orders,
  public.supply_purchase_order_lines,
  public.supply_inventory_lots,
  public.operating_expenses
from public, anon, authenticated;

grant select, insert, update, delete on table
  public.workforce_payroll_policies,
  public.workforce_wage_rates,
  public.workforce_schedules,
  public.workforce_leave_requests,
  public.workforce_holiday_rules,
  public.workforce_payroll_periods,
  public.workforce_payroll_lines,
  public.supply_suppliers,
  public.supply_purchase_orders,
  public.supply_purchase_order_lines,
  public.supply_inventory_lots,
  public.operating_expenses
to service_role;

create trigger workforce_payroll_policies_touch_updated_at before update on public.workforce_payroll_policies
for each row execute function app_private.touch_competitive_enhancement_updated_at();
create trigger workforce_wage_rates_touch_updated_at before update on public.workforce_wage_rates
for each row execute function app_private.touch_competitive_enhancement_updated_at();
create trigger workforce_schedules_touch_updated_at before update on public.workforce_schedules
for each row execute function app_private.touch_competitive_enhancement_updated_at();
create trigger workforce_leave_requests_touch_updated_at before update on public.workforce_leave_requests
for each row execute function app_private.touch_competitive_enhancement_updated_at();
create trigger workforce_holiday_rules_touch_updated_at before update on public.workforce_holiday_rules
for each row execute function app_private.touch_competitive_enhancement_updated_at();
create trigger workforce_payroll_periods_touch_updated_at before update on public.workforce_payroll_periods
for each row execute function app_private.touch_competitive_enhancement_updated_at();
create trigger workforce_payroll_lines_touch_updated_at before update on public.workforce_payroll_lines
for each row execute function app_private.touch_competitive_enhancement_updated_at();
create trigger supply_suppliers_touch_updated_at before update on public.supply_suppliers
for each row execute function app_private.touch_competitive_enhancement_updated_at();
create trigger supply_purchase_orders_touch_updated_at before update on public.supply_purchase_orders
for each row execute function app_private.touch_competitive_enhancement_updated_at();
create trigger supply_inventory_lots_touch_updated_at before update on public.supply_inventory_lots
for each row execute function app_private.touch_competitive_enhancement_updated_at();
create trigger operating_expenses_touch_updated_at before update on public.operating_expenses
for each row execute function app_private.touch_competitive_enhancement_updated_at();

create trigger backend_writable_guard before insert or update or delete on public.workforce_payroll_policies
for each statement execute function app_private.enforce_backend_writable();
create trigger backend_writable_guard before insert or update or delete on public.workforce_wage_rates
for each statement execute function app_private.enforce_backend_writable();
create trigger backend_writable_guard before insert or update or delete on public.workforce_schedules
for each statement execute function app_private.enforce_backend_writable();
create trigger backend_writable_guard before insert or update or delete on public.workforce_leave_requests
for each statement execute function app_private.enforce_backend_writable();
create trigger backend_writable_guard before insert or update or delete on public.workforce_holiday_rules
for each statement execute function app_private.enforce_backend_writable();
create trigger backend_writable_guard before insert or update or delete on public.workforce_payroll_periods
for each statement execute function app_private.enforce_backend_writable();
create trigger backend_writable_guard before insert or update or delete on public.workforce_payroll_lines
for each statement execute function app_private.enforce_backend_writable();
create trigger backend_writable_guard before insert or update or delete on public.supply_suppliers
for each statement execute function app_private.enforce_backend_writable();
create trigger backend_writable_guard before insert or update or delete on public.supply_purchase_orders
for each statement execute function app_private.enforce_backend_writable();
create trigger backend_writable_guard before insert or update or delete on public.supply_purchase_order_lines
for each statement execute function app_private.enforce_backend_writable();
create trigger backend_writable_guard before insert or update or delete on public.supply_inventory_lots
for each statement execute function app_private.enforce_backend_writable();
create trigger backend_writable_guard before insert or update or delete on public.operating_expenses
for each statement execute function app_private.enforce_backend_writable();

comment on table public.workforce_payroll_lines is
  'Auditable payroll calculation snapshots. Attendance events remain the source ledger; finalized rows are not a statutory filing.';
comment on table public.supply_inventory_lots is
  'Lot and expiry metadata for freshness alerts; quantity corrections must also post a supply inventory movement.';
comment on table public.operating_expenses is
  'Merchant-entered operating expenses used by management P&L, not a general ledger or tax filing.';
