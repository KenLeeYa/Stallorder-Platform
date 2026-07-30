-- Commercial entitlements and operational flags are intentionally separate.
-- Every delivery capability ships disabled and requires server-side approval.

insert into public.resilience_feature_flags (
  code,
  description,
  default_enabled,
  is_emergency
)
values
  ('DELIVERY_PLATFORM_FOUNDATION_ENABLED', '外送平台中立基礎服務', false, false),
  ('DELIVERY_PLATFORM_UI_ENABLED', '商家與平台管理外送整合介面', false, false),
  ('DELIVERY_EXTERNAL_ORDER_IMPORT_ENABLED', '外送平台訂單匯入', false, false),
  ('DELIVERY_PROVIDER_ACTIONS_ENABLED', '外送平台接單與狀態動作', false, false),
  ('DELIVERY_MENU_SYNC_ENABLED', '外送平台菜單同步', false, false),
  ('DELIVERY_MOCK_PROVIDER_ENABLED', '合成 Mock 外送平台', false, false),
  ('UBER_EATS_INTEGRATION_ENABLED', 'Uber Eats 整合總開關', false, false),
  ('UBER_EATS_OAUTH_ENABLED', 'Uber Eats OAuth 授權', false, false),
  ('UBER_EATS_API_ENABLED', 'Uber Eats Partner API', false, false),
  ('FOODPANDA_INTEGRATION_ENABLED', 'foodpanda 整合總開關', false, false),
  ('FOODPANDA_PARTNER_API_ENABLED', 'foodpanda Partner API', false, false),
  ('FOODPANDA_WEBHOOK_ENABLED', 'foodpanda Webhook 接收', false, false)
on conflict (code) do update
set
  description = excluded.description,
  default_enabled = false,
  is_emergency = false,
  updated_at = now();

insert into public.plan_entitlements (
  plan_version_id,
  feature_code,
  is_enabled,
  limit_value,
  configuration_json
)
select
  version.id,
  feature.feature_code,
  false,
  null,
  jsonb_build_object('partnerApprovalRequired', true)
from public.plan_versions version
cross join (
  values
    ('DELIVERY_PLATFORM_INTEGRATIONS'::text),
    ('UBER_EATS_INTEGRATION'::text),
    ('FOODPANDA_INTEGRATION'::text),
    ('DELIVERY_MENU_SYNC'::text),
    ('DELIVERY_ORDER_IMPORT'::text),
    ('DELIVERY_ORDER_RECONCILIATION'::text)
) feature(feature_code)
on conflict (plan_version_id, feature_code) do update
set
  is_enabled = false,
  limit_value = null,
  configuration_json = excluded.configuration_json,
  updated_at = now();
