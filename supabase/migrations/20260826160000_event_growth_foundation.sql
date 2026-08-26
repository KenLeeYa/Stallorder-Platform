-- Competitive enhancement Phase 6: signed event attribution foundation.
-- Existing market_events remain canonical. Attribution is evidence-based and
-- estimated only; it is not connected to either public-order circuit yet.

create table public.event_growth_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  market_event_id uuid not null references public.market_events(id) on delete cascade,
  name text not null,
  source text not null,
  medium text not null,
  campaign_code text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'DRAFT',
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_growth_campaigns_scope_key unique (id, organization_id),
  constraint event_growth_campaigns_code_key unique (organization_id, market_event_id, campaign_code),
  constraint event_growth_campaigns_name_check check (char_length(btrim(name)) between 1 and 120),
  constraint event_growth_campaigns_source_check check (source ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
  constraint event_growth_campaigns_medium_check check (medium ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
  constraint event_growth_campaigns_code_check check (campaign_code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
  constraint event_growth_campaigns_window_check check (ends_at > starts_at),
  constraint event_growth_campaigns_status_check check (status in ('DRAFT','ACTIVE','PAUSED','ENDED'))
);
create index event_growth_campaigns_lifecycle_idx
  on public.event_growth_campaigns (organization_id, market_event_id, status, starts_at, ends_at, id);

create table public.event_growth_touchpoints (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  market_event_id uuid not null references public.market_events(id) on delete cascade,
  campaign_id uuid not null,
  stall_id uuid,
  visitor_hash text not null,
  token_hash text not null,
  referrer_domain text,
  landing_path text not null,
  channel text not null,
  first_touched_at timestamptz not null default now(),
  last_touched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_growth_touchpoints_campaign_scope_fkey
    foreign key (campaign_id, organization_id)
    references public.event_growth_campaigns(id, organization_id) on delete restrict,
  constraint event_growth_touchpoints_stall_scope_fkey
    foreign key (stall_id, organization_id)
    references public.stalls(id, organization_id) on delete cascade,
  constraint event_growth_touchpoints_visitor_check check (visitor_hash ~ '^[a-f0-9]{64}$'),
  constraint event_growth_touchpoints_token_check check (token_hash ~ '^[a-f0-9]{64}$'),
  constraint event_growth_touchpoints_referrer_check check (
    referrer_domain is null or char_length(referrer_domain) between 1 and 253
  ),
  constraint event_growth_touchpoints_path_check check (
    char_length(landing_path) between 1 and 500 and landing_path like '/%'
  ),
  constraint event_growth_touchpoints_channel_check check (channel in ('QR','LINE','WEB','SOCIAL','PARTNER','DIRECT')),
  constraint event_growth_touchpoints_window_check check (
    last_touched_at >= first_touched_at and expires_at > first_touched_at
  )
);
create unique index event_growth_touchpoints_dedupe_key
  on public.event_growth_touchpoints (campaign_id, visitor_hash, coalesce(stall_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index event_growth_touchpoints_timeline_idx
  on public.event_growth_touchpoints (organization_id, market_event_id, first_touched_at, id);

create table public.event_growth_order_attributions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null,
  order_id uuid not null references public.orders(id) on delete restrict,
  market_event_id uuid not null references public.market_events(id) on delete restrict,
  campaign_id uuid not null,
  touchpoint_id uuid not null references public.event_growth_touchpoints(id) on delete restrict,
  attribution_model text not null,
  estimated_revenue_amount integer not null,
  confidence_basis_points integer not null,
  source_event_id text not null,
  attributed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint event_growth_order_attributions_campaign_scope_fkey
    foreign key (campaign_id, organization_id)
    references public.event_growth_campaigns(id, organization_id) on delete restrict,
  constraint event_growth_order_attributions_stall_scope_fkey
    foreign key (stall_id, organization_id)
    references public.stalls(id, organization_id) on delete restrict,
  constraint event_growth_order_attributions_order_key unique (order_id, attribution_model),
  constraint event_growth_order_attributions_event_key unique (organization_id, source_event_id),
  constraint event_growth_order_attributions_model_check check (attribution_model in ('FIRST_TOUCH','LAST_TOUCH','LINEAR')),
  constraint event_growth_order_attributions_revenue_check check (estimated_revenue_amount between 0 and 100000000),
  constraint event_growth_order_attributions_confidence_check check (confidence_basis_points between 0 and 10000),
  constraint event_growth_order_attributions_source_check check (char_length(source_event_id) between 1 and 160)
);
create index event_growth_order_attributions_report_idx
  on public.event_growth_order_attributions (organization_id, market_event_id, campaign_id, attributed_at, id);

create table public.event_growth_expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  market_event_id uuid not null references public.market_events(id) on delete cascade,
  category text not null,
  expense_amount integer not null,
  currency text not null default 'TWD',
  note text not null,
  incurred_at timestamptz not null,
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_growth_expenses_scope_key unique (id, organization_id),
  constraint event_growth_expenses_category_check check (category in ('BOOTH_FEE','ADVERTISING','TRANSPORT','STAFF','OTHER')),
  constraint event_growth_expenses_amount_check check (expense_amount between 0 and 100000000),
  constraint event_growth_expenses_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint event_growth_expenses_note_check check (char_length(btrim(note)) between 1 and 300)
);
create index event_growth_expenses_report_idx
  on public.event_growth_expenses (organization_id, market_event_id, incurred_at, id);

create table public.event_growth_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  market_event_id uuid not null references public.market_events(id) on delete cascade,
  campaign_id uuid,
  snapshot_at timestamptz not null,
  attribution_model text not null,
  touch_count integer not null,
  attributed_order_count integer not null,
  estimated_revenue_amount integer not null,
  expense_amount integer not null,
  created_at timestamptz not null default now(),
  constraint event_growth_metric_snapshots_campaign_scope_fkey
    foreign key (campaign_id, organization_id)
    references public.event_growth_campaigns(id, organization_id) on delete restrict,
  constraint event_growth_metric_snapshots_key unique (
    market_event_id, campaign_id, snapshot_at, attribution_model
  ),
  constraint event_growth_metric_snapshots_model_check check (attribution_model in ('FIRST_TOUCH','LAST_TOUCH','LINEAR')),
  constraint event_growth_metric_snapshots_counts_check check (touch_count >= 0 and attributed_order_count >= 0),
  constraint event_growth_metric_snapshots_amounts_check check (
    estimated_revenue_amount between 0 and 2000000000 and expense_amount between 0 and 2000000000
  )
);
create index event_growth_metric_snapshots_timeline_idx
  on public.event_growth_metric_snapshots (organization_id, market_event_id, snapshot_at desc, id);

create trigger event_growth_campaigns_touch before update on public.event_growth_campaigns for each row execute function app_private.touch_competitive_enhancement_updated_at();
create trigger backend_writable_guard before insert or update or delete on public.event_growth_campaigns for each statement execute function app_private.enforce_backend_writable();
create trigger event_growth_touchpoints_touch before update on public.event_growth_touchpoints for each row execute function app_private.touch_competitive_enhancement_updated_at();
create trigger backend_writable_guard before insert or update or delete on public.event_growth_touchpoints for each statement execute function app_private.enforce_backend_writable();
create trigger backend_writable_guard before insert or update or delete on public.event_growth_order_attributions for each statement execute function app_private.enforce_backend_writable();
create trigger event_growth_expenses_touch before update on public.event_growth_expenses for each row execute function app_private.touch_competitive_enhancement_updated_at();
create trigger backend_writable_guard before insert or update or delete on public.event_growth_expenses for each statement execute function app_private.enforce_backend_writable();
create trigger backend_writable_guard before insert or update or delete on public.event_growth_metric_snapshots for each statement execute function app_private.enforce_backend_writable();

alter table public.event_growth_campaigns enable row level security;
alter table public.event_growth_campaigns force row level security;
alter table public.event_growth_touchpoints enable row level security;
alter table public.event_growth_touchpoints force row level security;
alter table public.event_growth_order_attributions enable row level security;
alter table public.event_growth_order_attributions force row level security;
alter table public.event_growth_expenses enable row level security;
alter table public.event_growth_expenses force row level security;
alter table public.event_growth_metric_snapshots enable row level security;
alter table public.event_growth_metric_snapshots force row level security;

revoke all on table public.event_growth_campaigns from public, anon, authenticated;
revoke all on table public.event_growth_touchpoints from public, anon, authenticated;
revoke all on table public.event_growth_order_attributions from public, anon, authenticated;
revoke all on table public.event_growth_expenses from public, anon, authenticated;
revoke all on table public.event_growth_metric_snapshots from public, anon, authenticated;
grant select, insert, update, delete on table public.event_growth_campaigns to service_role;
grant select, insert, update, delete on table public.event_growth_touchpoints to service_role;
grant select, insert, update, delete on table public.event_growth_order_attributions to service_role;
grant select, insert, update, delete on table public.event_growth_expenses to service_role;
grant select, insert, update, delete on table public.event_growth_metric_snapshots to service_role;

comment on table public.event_growth_order_attributions is
  'Evidence-based event attribution with an explicit model, estimate and confidence score.';
comment on table public.event_growth_metric_snapshots is
  'Organizer-facing aggregate metric snapshot with estimated revenue and recorded expense.';
