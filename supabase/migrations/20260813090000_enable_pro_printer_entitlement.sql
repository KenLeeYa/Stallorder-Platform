-- Every existing Pro and Enterprise plan version includes printer integration.
-- Stall-level print modules remain opt-in and retain their false default.

insert into public.plan_entitlements as entitlement (
  plan_version_id,
  feature_code,
  is_enabled,
  limit_value,
  configuration_json
)
select
  version.id,
  'PRINTER_INTEGRATION',
  true,
  null,
  jsonb_build_object('merchantModuleOptIn', true)
from public.plan_versions version
join public.plans plan on plan.id = version.plan_id
where plan.code in ('PRO', 'ENTERPRISE')
on conflict (plan_version_id, feature_code) do update
set is_enabled = true,
    configuration_json = coalesce(entitlement.configuration_json, '{}'::jsonb)
      || excluded.configuration_json,
    updated_at = now();
