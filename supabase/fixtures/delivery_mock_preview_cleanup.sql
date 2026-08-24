do $preview_cleanup$
declare
  synthetic_order_ids uuid[];
begin

select coalesce(array_agg(distinct external_order.internal_order_id), array[]::uuid[])
into synthetic_order_ids
from public.external_orders external_order
where external_order.provider = 'MOCK'
  and external_order.external_order_id like 'preview-%'
  and external_order.internal_order_id is not null;

delete from public.delivery_webhook_events
where provider = 'MOCK'
  and external_event_id like 'preview-event-%';

delete from public.external_orders
where provider = 'MOCK'
  and external_order_id like 'preview-%';

delete from public.orders orders
where orders.id = any(synthetic_order_ids)
  and orders.source = 'MOCK'
  and orders.is_test = true;

delete from public.delivery_platform_connections
where id = 'de110000-0000-4000-8000-000000000001';

delete from public.resilience_feature_flag_overrides override
using public.resilience_feature_flags flag
where override.flag_id = flag.id
  and override.scope_type = 'GLOBAL'
  and override.reason = 'Ephemeral synthetic Preview validation only'
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

update public.subscriptions subscription
set
  plan_version_id = (
    select candidate.id
    from public.plan_versions candidate
    where candidate.plan_id = subscription.plan_id
      and candidate.id <> 'de100000-0000-4000-8000-000000000001'
      and candidate.effective_from <= now()
      and (candidate.effective_until is null or candidate.effective_until > now())
    order by candidate.version desc
    limit 1
  ),
  updated_at = now()
where subscription.organization_id = '11111111-1111-4111-8111-111111111111'
  and subscription.plan_version_id = 'de100000-0000-4000-8000-000000000001'
  and exists (
    select 1
    from public.plan_versions candidate
    where candidate.plan_id = subscription.plan_id
      and candidate.id <> 'de100000-0000-4000-8000-000000000001'
      and candidate.effective_from <= now()
      and (candidate.effective_until is null or candidate.effective_until > now())
  );

delete from public.plan_entitlements
where plan_version_id = 'de100000-0000-4000-8000-000000000001';

delete from public.plan_versions
where id = 'de100000-0000-4000-8000-000000000001';

end
$preview_cleanup$;
