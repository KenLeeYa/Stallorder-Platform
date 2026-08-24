do $preview_fixture$
begin

-- PAYG plan versions become immutable once subscribed or sealed. Provision a
-- disposable Preview-only version instead of mutating the production contract
-- snapshot that the local seed subscription currently references.
insert into public.plan_versions (
  id,
  plan_id,
  version,
  display_name,
  billing_interval,
  base_price,
  annual_price,
  currency,
  trial_days,
  included_stalls,
  max_stalls,
  additional_stall_price,
  max_staff,
  max_products,
  max_qr_codes,
  included_orders,
  report_retention_days,
  overage_policy,
  pricing_mode,
  usage_unit_price,
  usage_metric,
  usage_scope,
  monthly_cap_amount,
  minimum_charge,
  billing_timezone,
  billing_cycle_anchor_day,
  billing_period_type,
  invoice_close_delay_hours,
  tax_treatment,
  tax_rate_bps,
  tax_jurisdiction,
  tax_rounding_mode,
  tax_rounding_scope,
  cap_tax_basis,
  tax_document_required,
  emergency_hard_cap_enabled,
  emergency_hard_cap_orders,
  is_public,
  requires_quote,
  effective_from,
  effective_until,
  created_by
)
select
  'de100000-0000-4000-8000-000000000001',
  source.plan_id,
  900000001,
  source.display_name || '（合成 Preview）',
  source.billing_interval,
  source.base_price,
  source.annual_price,
  source.currency,
  source.trial_days,
  source.included_stalls,
  source.max_stalls,
  source.additional_stall_price,
  source.max_staff,
  source.max_products,
  source.max_qr_codes,
  source.included_orders,
  source.report_retention_days,
  source.overage_policy,
  source.pricing_mode,
  source.usage_unit_price,
  source.usage_metric,
  source.usage_scope,
  source.monthly_cap_amount,
  source.minimum_charge,
  source.billing_timezone,
  source.billing_cycle_anchor_day,
  source.billing_period_type,
  source.invoice_close_delay_hours,
  source.tax_treatment,
  source.tax_rate_bps,
  source.tax_jurisdiction,
  source.tax_rounding_mode,
  source.tax_rounding_scope,
  source.cap_tax_basis,
  source.tax_document_required,
  source.emergency_hard_cap_enabled,
  source.emergency_hard_cap_orders,
  false,
  source.requires_quote,
  now(),
  null,
  source.created_by
from public.subscriptions subscription
join public.plan_versions source on source.id = subscription.plan_version_id
join public.plans plan on plan.id = source.plan_id
where subscription.organization_id = '11111111-1111-4111-8111-111111111111'
  and plan.code = 'PAYG'
  and source.id <> 'de100000-0000-4000-8000-000000000001'
on conflict (id) do nothing;

insert into public.plan_entitlements (
  plan_version_id,
  feature_code,
  is_enabled,
  limit_value,
  configuration_json
)
select
  'de100000-0000-4000-8000-000000000001',
  entitlement.feature_code,
  case when entitlement.feature_code in (
    'DELIVERY_PLATFORM_INTEGRATIONS',
    'DELIVERY_MENU_SYNC',
    'DELIVERY_ORDER_IMPORT',
    'DELIVERY_ORDER_RECONCILIATION'
  ) then true else entitlement.is_enabled end,
  entitlement.limit_value,
  case when entitlement.feature_code in (
    'DELIVERY_PLATFORM_INTEGRATIONS',
    'DELIVERY_MENU_SYNC',
    'DELIVERY_ORDER_IMPORT',
    'DELIVERY_ORDER_RECONCILIATION'
  ) then jsonb_build_object(
    'syntheticPreviewOnly', true,
    'partnerApprovalRequired', false
  ) else entitlement.configuration_json end
from public.plan_entitlements entitlement
where entitlement.plan_version_id = (
  select candidate.id
  from public.plan_versions candidate
  join public.plans plan on plan.id = candidate.plan_id
  where plan.code = 'PAYG'
    and candidate.id <> 'de100000-0000-4000-8000-000000000001'
  order by candidate.version desc
  limit 1
)
and not exists (
  select 1
  from public.plan_entitlements existing
  where existing.plan_version_id = 'de100000-0000-4000-8000-000000000001'
    and existing.feature_code = entitlement.feature_code
)
on conflict (plan_version_id, feature_code) do nothing;

update public.subscriptions
set
  plan_version_id = 'de100000-0000-4000-8000-000000000001',
  updated_at = now()
where organization_id = '11111111-1111-4111-8111-111111111111'
  and plan_version_id <> 'de100000-0000-4000-8000-000000000001';

delete from public.resilience_feature_flag_overrides override
using public.resilience_feature_flags flag
where override.flag_id = flag.id
  and override.scope_type = 'GLOBAL'
  and flag.code in (
    'OAUTH_IDENTITY_FOUNDATION_ENABLED',
    'OAUTH_GOOGLE_ENABLED',
    'OAUTH_IDENTITY_LINKING_ENABLED',
    'OAUTH_MOCK_PROVIDER_ENABLED',
    'DELIVERY_PLATFORM_FOUNDATION_ENABLED',
    'DELIVERY_PLATFORM_UI_ENABLED',
    'DELIVERY_EXTERNAL_ORDER_IMPORT_ENABLED',
    'DELIVERY_PROVIDER_ACTIONS_ENABLED',
    'DELIVERY_MENU_SYNC_ENABLED',
    'DELIVERY_MOCK_PROVIDER_ENABLED'
  );

insert into public.resilience_feature_flag_overrides (
  flag_id,
  scope_type,
  enabled,
  reason
)
select
  flag.id,
  'GLOBAL',
  true,
  'Ephemeral synthetic Preview validation only'
from public.resilience_feature_flags flag
where flag.code in (
  'OAUTH_IDENTITY_FOUNDATION_ENABLED',
  'OAUTH_GOOGLE_ENABLED',
  'OAUTH_IDENTITY_LINKING_ENABLED',
  'OAUTH_MOCK_PROVIDER_ENABLED',
  'DELIVERY_PLATFORM_FOUNDATION_ENABLED',
  'DELIVERY_PLATFORM_UI_ENABLED',
  'DELIVERY_EXTERNAL_ORDER_IMPORT_ENABLED',
  'DELIVERY_PROVIDER_ACTIONS_ENABLED',
  'DELIVERY_MENU_SYNC_ENABLED',
  'DELIVERY_MOCK_PROVIDER_ENABLED'
);

insert into public.delivery_platform_connections (
  id,
  organization_id,
  stall_id,
  provider,
  status,
  external_chain_id,
  external_store_id,
  external_store_name,
  external_account_reference,
  capabilities_json,
  connected_by_profile_id,
  reviewed_by_profile_id,
  connected_at,
  activated_at
) values (
  'de110000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'MOCK',
  'ACTIVE',
  'mock-chain-001',
  'mock-store-taipei-001',
  '合成台北測試門市',
  'synthetic-preview-account',
  '["STORE_LISTING","MENU_PUSH","AVAILABILITY_PUSH","ORDER_WEBHOOK","ORDER_ACCEPT","ORDER_REJECT","ORDER_PREPARING","ORDER_READY","ORDER_RECONCILIATION","PAYMENT_BREAKDOWN"]'::jsonb,
  '55555555-5555-4555-8555-555555555551',
  '55555555-5555-4555-8555-555555555551',
  now(),
  now()
)
on conflict (id) do update
set
  status = 'ACTIVE',
  external_store_id = excluded.external_store_id,
  external_store_name = excluded.external_store_name,
  activated_at = now(),
  paused_at = null,
  disconnected_at = null,
  updated_at = now();

insert into public.external_store_mappings (
  id,
  organization_id,
  stall_id,
  connection_id,
  provider,
  external_chain_id,
  external_store_id,
  external_store_name,
  mapping_status,
  verified_at,
  verified_by_profile_id
) values (
  'de120000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'de110000-0000-4000-8000-000000000001',
  'MOCK',
  'mock-chain-001',
  'mock-store-taipei-001',
  '合成台北測試門市',
  'VERIFIED',
  now(),
  '55555555-5555-4555-8555-555555555551'
)
on conflict (id) do update
set
  mapping_status = 'VERIFIED',
  verified_at = now(),
  updated_at = now();

insert into public.external_menu_mappings (
  id,
  organization_id,
  stall_id,
  connection_id,
  provider,
  internal_entity_type,
  internal_entity_id,
  external_entity_id,
  mapping_status,
  last_synced_at
) values (
  'de130000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'de110000-0000-4000-8000-000000000001',
  'MOCK',
  'PRODUCT',
  '44444444-4444-4444-8444-444444444441',
  'mock-product-001',
  'SYNCED',
  now()
)
on conflict (id) do update
set
  external_entity_id = excluded.external_entity_id,
  mapping_status = 'SYNCED',
  last_synced_at = now(),
  updated_at = now();

end
$preview_fixture$;
