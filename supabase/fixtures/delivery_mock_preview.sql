do $preview_fixture$
begin

update public.plan_entitlements
set
  is_enabled = true,
  configuration_json = jsonb_build_object(
    'syntheticPreviewOnly', true,
    'partnerApprovalRequired', false
  ),
  updated_at = now()
where feature_code in (
  'DELIVERY_PLATFORM_INTEGRATIONS',
  'DELIVERY_MENU_SYNC',
  'DELIVERY_ORDER_IMPORT',
  'DELIVERY_ORDER_RECONCILIATION'
);

delete from public.resilience_feature_flag_overrides override
using public.resilience_feature_flags flag
where override.flag_id = flag.id
  and override.scope_type = 'GLOBAL'
  and flag.code in (
    'OAUTH_IDENTITY_FOUNDATION_ENABLED',
    'OAUTH_GOOGLE_ENABLED',
    'OAUTH_LINE_ENABLED',
    'OAUTH_APPLE_ENABLED',
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
  'OAUTH_LINE_ENABLED',
  'OAUTH_APPLE_ENABLED',
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
