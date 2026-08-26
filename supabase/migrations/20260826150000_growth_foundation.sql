-- Competitive enhancement Phase 5: consent-governed Growth foundation.
-- Additive only. Existing CRM/loyalty hard lock remains unchanged; this module
-- stores no plaintext contact identifier, coupon token, or referral token.

create table public.growth_coupon_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  discount_type text not null,
  discount_value integer not null,
  budget_amount integer not null,
  redeemed_amount integer not null default 0,
  per_customer_limit integer not null default 1,
  minimum_order_amount integer not null default 0,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  channels text[] not null,
  stall_ids uuid[] not null default '{}'::uuid[],
  product_ids uuid[] not null default '{}'::uuid[],
  stacking_policy text not null default 'EXCLUSIVE',
  attribution_window_days integer not null default 7,
  status text not null default 'DRAFT',
  issued_count integer not null default 0,
  redemption_count integer not null default 0,
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint growth_coupon_campaigns_scope_key unique (id, organization_id),
  constraint growth_coupon_campaigns_name_check check (char_length(btrim(name)) between 1 and 120),
  constraint growth_coupon_campaigns_discount_check check (
    (discount_type = 'PERCENT' and discount_value between 1 and 100)
    or (discount_type = 'FIXED' and discount_value between 1 and 1000000)
  ),
  constraint growth_coupon_campaigns_budget_check check (
    budget_amount between 1 and 100000000 and redeemed_amount between 0 and budget_amount
  ),
  constraint growth_coupon_campaigns_limit_check check (per_customer_limit between 1 and 100),
  constraint growth_coupon_campaigns_minimum_check check (minimum_order_amount between 0 and 10000000),
  constraint growth_coupon_campaigns_window_check check (ends_at > starts_at),
  constraint growth_coupon_campaigns_channels_check check (
    cardinality(channels) between 1 and 6
    and channels <@ array['QR','STAFF_POS','LINE_ORDERING','BRANDED_WEB','FOODPANDA','UBER_EATS']::text[]
  ),
  constraint growth_coupon_campaigns_scope_arrays_check check (
    cardinality(stall_ids) <= 500 and cardinality(product_ids) <= 5000
  ),
  constraint growth_coupon_campaigns_stacking_check check (stacking_policy in ('EXCLUSIVE','STACK_WITH_POINTS','STACK_ALL')),
  constraint growth_coupon_campaigns_attribution_check check (attribution_window_days between 0 and 90),
  constraint growth_coupon_campaigns_status_check check (status in ('DRAFT','ACTIVE','PAUSED','ENDED')),
  constraint growth_coupon_campaigns_counts_check check (issued_count >= 0 and redemption_count >= 0)
);
create index growth_coupon_campaigns_lifecycle_idx
  on public.growth_coupon_campaigns (organization_id, status, starts_at, ends_at, id);

create table public.growth_coupon_issuances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null,
  campaign_id uuid not null,
  crm_profile_id uuid not null,
  token_prefix text not null,
  token_hash text not null,
  status text not null default 'ISSUED',
  idempotency_key text not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint growth_coupon_issuances_scope_key unique (id, organization_id, stall_id),
  constraint growth_coupon_issuances_campaign_scope_fkey
    foreign key (campaign_id, organization_id)
    references public.growth_coupon_campaigns(id, organization_id) on delete restrict,
  constraint growth_coupon_issuances_profile_scope_fkey
    foreign key (crm_profile_id, organization_id, stall_id)
    references public.crm_profiles(id, organization_id, stall_id) on delete restrict,
  constraint growth_coupon_issuances_hash_key unique (organization_id, token_hash),
  constraint growth_coupon_issuances_event_key unique (organization_id, idempotency_key),
  constraint growth_coupon_issuances_prefix_check check (token_prefix ~ '^[A-Z0-9]{4,16}$'),
  constraint growth_coupon_issuances_hash_check check (token_hash ~ '^[a-f0-9]{64}$'),
  constraint growth_coupon_issuances_status_check check (status in ('ISSUED','REDEEMED','EXPIRED','REVOKED')),
  constraint growth_coupon_issuances_key_check check (char_length(idempotency_key) between 16 and 160),
  constraint growth_coupon_issuances_window_check check (expires_at > issued_at),
  constraint growth_coupon_issuances_redemption_check check (
    (status = 'REDEEMED' and redeemed_at is not null) or (status <> 'REDEEMED' and redeemed_at is null)
  )
);
create index growth_coupon_issuances_profile_idx
  on public.growth_coupon_issuances (organization_id, stall_id, crm_profile_id, status, expires_at, id);

create table public.growth_coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null,
  issuance_id uuid not null,
  order_id uuid not null references public.orders(id) on delete restrict,
  entry_type text not null,
  amount_delta integer not null,
  source_event_id text not null,
  reversal_of_redemption_id uuid references public.growth_coupon_redemptions(id) on delete restrict,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint growth_coupon_redemptions_issuance_scope_fkey
    foreign key (issuance_id, organization_id, stall_id)
    references public.growth_coupon_issuances(id, organization_id, stall_id) on delete restrict,
  constraint growth_coupon_redemptions_event_key unique (organization_id, source_event_id),
  constraint growth_coupon_redemptions_one_reversal unique (reversal_of_redemption_id),
  constraint growth_coupon_redemptions_entry_check check (
    (entry_type = 'APPLY' and amount_delta > 0 and reversal_of_redemption_id is null)
    or (entry_type = 'REVERSE' and amount_delta < 0 and reversal_of_redemption_id is not null)
  ),
  constraint growth_coupon_redemptions_event_id_check check (char_length(source_event_id) between 1 and 160)
);
create index growth_coupon_redemptions_order_idx
  on public.growth_coupon_redemptions (organization_id, stall_id, order_id, created_at, id);

create table public.growth_stamp_programs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  stamps_required integer not null,
  reward_type text not null,
  reward_value integer not null,
  expires_after_days integer,
  status text not null default 'DRAFT',
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint growth_stamp_programs_scope_key unique (id, organization_id),
  constraint growth_stamp_programs_name_check check (char_length(btrim(name)) between 1 and 120),
  constraint growth_stamp_programs_required_check check (stamps_required between 2 and 100),
  constraint growth_stamp_programs_reward_check check (
    (reward_type = 'PERCENT' and reward_value between 1 and 100)
    or (reward_type = 'FIXED' and reward_value between 1 and 1000000)
    or (reward_type = 'FREE_ITEM' and reward_value = 0)
  ),
  constraint growth_stamp_programs_expiry_check check (expires_after_days is null or expires_after_days between 1 and 1095),
  constraint growth_stamp_programs_status_check check (status in ('DRAFT','ACTIVE','PAUSED','ENDED'))
);

create table public.growth_stamp_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null,
  program_id uuid not null,
  crm_profile_id uuid not null,
  balance integer not null default 0,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint growth_stamp_accounts_scope_key unique (id, organization_id, stall_id),
  constraint growth_stamp_accounts_program_scope_fkey
    foreign key (program_id, organization_id)
    references public.growth_stamp_programs(id, organization_id) on delete restrict,
  constraint growth_stamp_accounts_profile_scope_fkey
    foreign key (crm_profile_id, organization_id, stall_id)
    references public.crm_profiles(id, organization_id, stall_id) on delete restrict,
  constraint growth_stamp_accounts_profile_key unique (program_id, crm_profile_id),
  constraint growth_stamp_accounts_balance_check check (balance between 0 and 1000000),
  constraint growth_stamp_accounts_status_check check (status in ('ACTIVE','CLOSED'))
);

create table public.growth_stamp_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null,
  account_id uuid not null,
  entry_type text not null,
  stamp_delta integer not null,
  order_id uuid references public.orders(id) on delete restrict,
  source_event_id text not null,
  reversal_of_ledger_id uuid references public.growth_stamp_ledger(id) on delete restrict,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint growth_stamp_ledger_account_scope_fkey
    foreign key (account_id, organization_id, stall_id)
    references public.growth_stamp_accounts(id, organization_id, stall_id) on delete restrict,
  constraint growth_stamp_ledger_event_key unique (organization_id, source_event_id),
  constraint growth_stamp_ledger_one_reversal unique (reversal_of_ledger_id),
  constraint growth_stamp_ledger_delta_check check (
    (entry_type = 'EARN' and stamp_delta > 0 and reversal_of_ledger_id is null)
    or (entry_type in ('REDEEM','EXPIRE') and stamp_delta < 0 and reversal_of_ledger_id is null)
    or (entry_type = 'ADJUST' and stamp_delta <> 0 and reversal_of_ledger_id is null)
    or (entry_type = 'REVERSE' and stamp_delta <> 0 and reversal_of_ledger_id is not null)
  ),
  constraint growth_stamp_ledger_event_id_check check (char_length(source_event_id) between 1 and 160)
);
create index growth_stamp_ledger_account_idx
  on public.growth_stamp_ledger (account_id, created_at, id);

create table public.growth_referral_programs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  referrer_reward_amount integer not null,
  referred_reward_amount integer not null,
  qualification_order_amount integer not null,
  attribution_window_days integer not null default 30,
  budget_amount integer not null,
  rewarded_amount integer not null default 0,
  status text not null default 'DRAFT',
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint growth_referral_programs_scope_key unique (id, organization_id),
  constraint growth_referral_programs_name_check check (char_length(btrim(name)) between 1 and 120),
  constraint growth_referral_programs_amount_check check (
    referrer_reward_amount between 0 and 1000000
    and referred_reward_amount between 0 and 1000000
    and qualification_order_amount between 0 and 10000000
    and budget_amount between 1 and 100000000
    and rewarded_amount between 0 and budget_amount
  ),
  constraint growth_referral_programs_window_check check (attribution_window_days between 1 and 90),
  constraint growth_referral_programs_status_check check (status in ('DRAFT','ACTIVE','PAUSED','ENDED'))
);

create table public.growth_referral_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null,
  program_id uuid not null,
  referrer_crm_profile_id uuid not null,
  token_prefix text not null,
  token_hash text not null,
  status text not null default 'ACTIVE',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint growth_referral_links_scope_key unique (id, organization_id, stall_id),
  constraint growth_referral_links_program_scope_fkey
    foreign key (program_id, organization_id)
    references public.growth_referral_programs(id, organization_id) on delete restrict,
  constraint growth_referral_links_profile_scope_fkey
    foreign key (referrer_crm_profile_id, organization_id, stall_id)
    references public.crm_profiles(id, organization_id, stall_id) on delete restrict,
  constraint growth_referral_links_hash_key unique (organization_id, token_hash),
  constraint growth_referral_links_prefix_check check (token_prefix ~ '^[A-Z0-9]{4,16}$'),
  constraint growth_referral_links_hash_check check (token_hash ~ '^[a-f0-9]{64}$'),
  constraint growth_referral_links_status_check check (status in ('ACTIVE','EXPIRED','REVOKED'))
);

create table public.growth_referral_conversions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null,
  program_id uuid not null,
  referral_link_id uuid not null,
  referred_crm_profile_id uuid not null,
  qualifying_order_id uuid references public.orders(id) on delete restrict,
  status text not null default 'ATTRIBUTED',
  source_event_id text not null,
  attributed_at timestamptz not null default now(),
  qualified_at timestamptz,
  rewarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint growth_referral_conversions_program_scope_fkey
    foreign key (program_id, organization_id)
    references public.growth_referral_programs(id, organization_id) on delete restrict,
  constraint growth_referral_conversions_link_scope_fkey
    foreign key (referral_link_id, organization_id, stall_id)
    references public.growth_referral_links(id, organization_id, stall_id) on delete restrict,
  constraint growth_referral_conversions_profile_scope_fkey
    foreign key (referred_crm_profile_id, organization_id, stall_id)
    references public.crm_profiles(id, organization_id, stall_id) on delete restrict,
  constraint growth_referral_conversions_profile_key unique (program_id, referred_crm_profile_id),
  constraint growth_referral_conversions_event_key unique (organization_id, source_event_id),
  constraint growth_referral_conversions_status_check check (status in ('ATTRIBUTED','QUALIFIED','REWARDED','REJECTED')),
  constraint growth_referral_conversions_event_id_check check (char_length(source_event_id) between 1 and 160)
);

create table public.growth_rfm_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null,
  crm_profile_id uuid not null,
  snapshot_at timestamptz not null,
  recency_days integer not null,
  frequency_count integer not null,
  monetary_amount integer not null,
  segment_code text not null,
  model_version text not null,
  created_at timestamptz not null default now(),
  constraint growth_rfm_snapshots_profile_scope_fkey
    foreign key (crm_profile_id, organization_id, stall_id)
    references public.crm_profiles(id, organization_id, stall_id) on delete restrict,
  constraint growth_rfm_snapshots_key unique (crm_profile_id, snapshot_at, model_version),
  constraint growth_rfm_snapshots_metrics_check check (
    recency_days between 0 and 36500 and frequency_count between 0 and 1000000 and monetary_amount between 0 and 2000000000
  ),
  constraint growth_rfm_snapshots_segment_check check (segment_code in ('CHAMPION','LOYAL','PROMISING','AT_RISK','HIBERNATING')),
  constraint growth_rfm_snapshots_version_check check (char_length(model_version) between 1 and 40)
);
create index growth_rfm_snapshots_segment_idx
  on public.growth_rfm_snapshots (organization_id, stall_id, snapshot_at desc, segment_code, id);

create table public.growth_automation_flows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  trigger_type text not null,
  definition_json jsonb not null default '{}'::jsonb,
  consent_purpose_code text not null,
  frequency_cap_days integer not null default 7,
  budget_amount integer not null,
  spent_amount integer not null default 0,
  dry_run boolean not null default true,
  status text not null default 'DRAFT',
  version integer not null default 1,
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint growth_automation_flows_scope_key unique (id, organization_id),
  constraint growth_automation_flows_name_check check (char_length(btrim(name)) between 1 and 120),
  constraint growth_automation_flows_trigger_check check (trigger_type in ('RFM_SEGMENT_CHANGED','ORDER_COMPLETED','CUSTOMER_INACTIVE','BIRTHDAY_MONTH')),
  constraint growth_automation_flows_definition_check check (jsonb_typeof(definition_json) = 'object'),
  constraint growth_automation_flows_consent_check check (consent_purpose_code ~ '^[A-Z][A-Z0-9_]{1,79}$'),
  constraint growth_automation_flows_frequency_check check (frequency_cap_days between 1 and 365),
  constraint growth_automation_flows_budget_check check (
    budget_amount between 1 and 100000000 and spent_amount between 0 and budget_amount
  ),
  constraint growth_automation_flows_status_check check (status in ('DRAFT','ACTIVE','PAUSED','ENDED')),
  constraint growth_automation_flows_version_check check (version between 1 and 1000000)
);

create table public.growth_automation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  flow_id uuid not null,
  idempotency_key text not null,
  status text not null default 'PENDING',
  evaluation_started_at timestamptz not null,
  evaluation_ended_at timestamptz,
  eligible_count integer not null default 0,
  delivered_count integer not null default 0,
  skipped_consent_count integer not null default 0,
  skipped_frequency_count integer not null default 0,
  cost_amount integer not null default 0,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint growth_automation_runs_flow_scope_fkey
    foreign key (flow_id, organization_id)
    references public.growth_automation_flows(id, organization_id) on delete cascade,
  constraint growth_automation_runs_event_key unique (organization_id, idempotency_key),
  constraint growth_automation_runs_status_check check (status in ('PENDING','RUNNING','SUCCEEDED','RETRY_PENDING','FAILED','CANCELLED')),
  constraint growth_automation_runs_counts_check check (
    eligible_count >= 0 and delivered_count >= 0 and delivered_count <= eligible_count
    and skipped_consent_count >= 0 and skipped_frequency_count >= 0 and cost_amount >= 0
  ),
  constraint growth_automation_runs_attempt_check check (attempt_count between 0 and 20),
  constraint growth_automation_runs_key_check check (char_length(idempotency_key) between 16 and 160),
  constraint growth_automation_runs_error_check check (
    last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{1,119}$'
  )
);
create index growth_automation_runs_queue_idx
  on public.growth_automation_runs (status, next_attempt_at, created_at, id)
  where status in ('PENDING','RETRY_PENDING');

create function app_private.guard_growth_ledger_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'GROWTH_LEDGER_IMMUTABLE' using errcode = '55000';
  return old;
end;
$$;

create trigger growth_coupon_campaigns_touch before update on public.growth_coupon_campaigns for each row execute function app_private.touch_competitive_enhancement_updated_at();
create trigger backend_writable_guard before insert or update or delete on public.growth_coupon_campaigns for each statement execute function app_private.enforce_backend_writable();
create trigger growth_coupon_issuances_touch before update on public.growth_coupon_issuances for each row execute function app_private.touch_competitive_enhancement_updated_at();
create trigger backend_writable_guard before insert or update or delete on public.growth_coupon_issuances for each statement execute function app_private.enforce_backend_writable();
create trigger growth_coupon_redemptions_immutable before update or delete on public.growth_coupon_redemptions for each row execute function app_private.guard_growth_ledger_immutable();
create trigger backend_writable_guard before insert or update or delete on public.growth_coupon_redemptions for each statement execute function app_private.enforce_backend_writable();
create trigger growth_stamp_programs_touch before update on public.growth_stamp_programs for each row execute function app_private.touch_competitive_enhancement_updated_at();
create trigger backend_writable_guard before insert or update or delete on public.growth_stamp_programs for each statement execute function app_private.enforce_backend_writable();
create trigger growth_stamp_accounts_touch before update on public.growth_stamp_accounts for each row execute function app_private.touch_competitive_enhancement_updated_at();
create trigger backend_writable_guard before insert or update or delete on public.growth_stamp_accounts for each statement execute function app_private.enforce_backend_writable();
create trigger growth_stamp_ledger_immutable before update or delete on public.growth_stamp_ledger for each row execute function app_private.guard_growth_ledger_immutable();
create trigger backend_writable_guard before insert or update or delete on public.growth_stamp_ledger for each statement execute function app_private.enforce_backend_writable();
create trigger growth_referral_programs_touch before update on public.growth_referral_programs for each row execute function app_private.touch_competitive_enhancement_updated_at();
create trigger backend_writable_guard before insert or update or delete on public.growth_referral_programs for each statement execute function app_private.enforce_backend_writable();
create trigger growth_referral_links_touch before update on public.growth_referral_links for each row execute function app_private.touch_competitive_enhancement_updated_at();
create trigger backend_writable_guard before insert or update or delete on public.growth_referral_links for each statement execute function app_private.enforce_backend_writable();
create trigger growth_referral_conversions_touch before update on public.growth_referral_conversions for each row execute function app_private.touch_competitive_enhancement_updated_at();
create trigger backend_writable_guard before insert or update or delete on public.growth_referral_conversions for each statement execute function app_private.enforce_backend_writable();
create trigger backend_writable_guard before insert or update or delete on public.growth_rfm_snapshots for each statement execute function app_private.enforce_backend_writable();
create trigger growth_automation_flows_touch before update on public.growth_automation_flows for each row execute function app_private.touch_competitive_enhancement_updated_at();
create trigger backend_writable_guard before insert or update or delete on public.growth_automation_flows for each statement execute function app_private.enforce_backend_writable();
create trigger growth_automation_runs_touch before update on public.growth_automation_runs for each row execute function app_private.touch_competitive_enhancement_updated_at();
create trigger backend_writable_guard before insert or update or delete on public.growth_automation_runs for each statement execute function app_private.enforce_backend_writable();

alter table public.growth_coupon_campaigns enable row level security;
alter table public.growth_coupon_campaigns force row level security;
alter table public.growth_coupon_issuances enable row level security;
alter table public.growth_coupon_issuances force row level security;
alter table public.growth_coupon_redemptions enable row level security;
alter table public.growth_coupon_redemptions force row level security;
alter table public.growth_stamp_programs enable row level security;
alter table public.growth_stamp_programs force row level security;
alter table public.growth_stamp_accounts enable row level security;
alter table public.growth_stamp_accounts force row level security;
alter table public.growth_stamp_ledger enable row level security;
alter table public.growth_stamp_ledger force row level security;
alter table public.growth_referral_programs enable row level security;
alter table public.growth_referral_programs force row level security;
alter table public.growth_referral_links enable row level security;
alter table public.growth_referral_links force row level security;
alter table public.growth_referral_conversions enable row level security;
alter table public.growth_referral_conversions force row level security;
alter table public.growth_rfm_snapshots enable row level security;
alter table public.growth_rfm_snapshots force row level security;
alter table public.growth_automation_flows enable row level security;
alter table public.growth_automation_flows force row level security;
alter table public.growth_automation_runs enable row level security;
alter table public.growth_automation_runs force row level security;

revoke all on table public.growth_coupon_campaigns from public, anon, authenticated;
revoke all on table public.growth_coupon_issuances from public, anon, authenticated;
revoke all on table public.growth_coupon_redemptions from public, anon, authenticated;
revoke all on table public.growth_stamp_programs from public, anon, authenticated;
revoke all on table public.growth_stamp_accounts from public, anon, authenticated;
revoke all on table public.growth_stamp_ledger from public, anon, authenticated;
revoke all on table public.growth_referral_programs from public, anon, authenticated;
revoke all on table public.growth_referral_links from public, anon, authenticated;
revoke all on table public.growth_referral_conversions from public, anon, authenticated;
revoke all on table public.growth_rfm_snapshots from public, anon, authenticated;
revoke all on table public.growth_automation_flows from public, anon, authenticated;
revoke all on table public.growth_automation_runs from public, anon, authenticated;
grant select, insert, update, delete on table public.growth_coupon_campaigns to service_role;
grant select, insert, update, delete on table public.growth_coupon_issuances to service_role;
grant select, insert on table public.growth_coupon_redemptions to service_role;
grant select, insert, update, delete on table public.growth_stamp_programs to service_role;
grant select, insert, update, delete on table public.growth_stamp_accounts to service_role;
grant select, insert on table public.growth_stamp_ledger to service_role;
grant select, insert, update, delete on table public.growth_referral_programs to service_role;
grant select, insert, update, delete on table public.growth_referral_links to service_role;
grant select, insert, update, delete on table public.growth_referral_conversions to service_role;
grant select, insert, update, delete on table public.growth_rfm_snapshots to service_role;
grant select, insert, update, delete on table public.growth_automation_flows to service_role;
grant select, insert, update, delete on table public.growth_automation_runs to service_role;

revoke all on function app_private.guard_growth_ledger_immutable()
  from public, anon, authenticated;

comment on table public.growth_coupon_issuances is
  'Consent-governed coupon issuance metadata. Only a token prefix and SHA-256 hash are stored.';
comment on table public.growth_rfm_snapshots is
  'Pseudonymous, versioned RFM output scoped to an existing CRM profile.';
comment on table public.growth_automation_flows is
  'Rule-based growth automation with consent purpose, frequency cap, budget and dry-run safety.';
