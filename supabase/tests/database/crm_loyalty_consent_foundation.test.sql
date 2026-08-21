begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(36);

select has_table('public', 'crm_profiles', 'CRM profiles exist');
select has_table('public', 'crm_consent_records', 'granular consent records exist');
select has_table('public', 'loyalty_accounts', 'loyalty accounts exist');
select has_table('public', 'loyalty_points_ledger', 'immutable points ledger exists');
select has_table('public', 'crm_erasure_tombstones', 'erasure tombstones exist');

select is(
  (select default_enabled from public.resilience_feature_flags
   where code = 'CRM_LOYALTY_CONSENT_FOUNDATION_ENABLED'),
  false,
  'CRM and loyalty foundation defaults off'
);

select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity)
   from pg_class
   where oid in (
     'public.crm_profiles'::regclass,
     'public.crm_consent_records'::regclass,
     'public.loyalty_accounts'::regclass,
     'public.loyalty_points_ledger'::regclass,
     'public.crm_erasure_tombstones'::regclass
   )),
  'all five data tables force RLS'
);

select ok(
  not has_table_privilege('anon', 'public.crm_profiles', 'SELECT')
  and not has_table_privilege('authenticated', 'public.crm_profiles', 'INSERT')
  and not has_column_privilege('authenticated', 'public.crm_profiles', 'contact_identifier_hash', 'SELECT')
  and not has_column_privilege('authenticated', 'public.crm_profiles', 'contact_reference', 'SELECT')
  and has_table_privilege('service_role', 'public.crm_profiles', 'SELECT')
  and not has_table_privilege('service_role', 'public.crm_profiles', 'INSERT')
  and not has_table_privilege('service_role', 'public.crm_profiles', 'UPDATE')
  and not has_table_privilege('service_role', 'public.crm_profiles', 'DELETE'),
  'profile identifiers and direct writes stay behind security-definer RPCs'
);

select ok(
  to_regprocedure('public.opt_in_crm_loyalty_profile(uuid,uuid,text,text,text,timestamp with time zone,text,text,text,text,text,text)') is not null
  and to_regprocedure('public.withdraw_crm_consent(uuid,uuid,uuid,text,text,text,text)') is not null
  and to_regprocedure('public.unsubscribe_crm_profile(uuid,uuid,uuid,text,text)') is not null
  and to_regprocedure('public.post_loyalty_points_event(uuid,uuid,uuid,text,integer,uuid,text,text,uuid,uuid,text)') is not null
  and to_regprocedure('public.export_crm_loyalty_profile(uuid,uuid,uuid,text)') is not null
  and to_regprocedure('public.erase_crm_loyalty_profile(uuid,uuid,uuid,text,text,text)') is not null,
  'trusted consent, lifecycle, and points contracts exist'
);

select ok(
  not has_function_privilege('anon', 'public.opt_in_crm_loyalty_profile(uuid,uuid,text,text,text,timestamp with time zone,text,text,text,text,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.opt_in_crm_loyalty_profile(uuid,uuid,text,text,text,timestamp with time zone,text,text,text,text,text,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.opt_in_crm_loyalty_profile(uuid,uuid,text,text,text,timestamp with time zone,text,text,text,text,text,text)', 'EXECUTE'),
  'only service_role may opt in a profile'
);

-- Owner-only test fixture: exercise the dormant implementation without
-- weakening the Production role boundary. Both DDL changes roll back here.
alter table public.resilience_feature_flags
  disable trigger resilience_feature_flags_phase_three_lock_guard;
alter table public.resilience_feature_flags
  drop constraint resilience_feature_flags_phase_three_default_off_check;

update public.resilience_feature_flags
set default_enabled = true
where code = 'CRM_LOYALTY_CONSENT_FOUNDATION_ENABLED';

create temporary table pg_temp.crm_results (
  name text primary key,
  value jsonb not null
) on commit drop;

insert into pg_temp.crm_results values (
  'unverified',
  public.opt_in_crm_loyalty_profile(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    repeat('1', 64), 'vault://contact/unverified', 'PHONE', null,
    'MARKETING_EMAIL', 'v1', 'QR_CHECKOUT', 'CONSENT', 'EXPLICIT_OPT_IN',
    'crm-unverified'
  )
);
select is((select value->>'code' from pg_temp.crm_results where name = 'unverified'),
  'CRM_CONTACT_NOT_VERIFIED', 'unverified contact cannot create a profile');
select is((select count(*)::integer from public.crm_profiles
           where contact_identifier_hash = repeat('1', 64)), 0,
  'failed verification leaves no profile');

insert into pg_temp.crm_results values (
  'not_opted_in',
  public.opt_in_crm_loyalty_profile(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    repeat('2', 64), 'vault://contact/no-consent', 'PHONE', now(),
    'MARKETING_EMAIL', 'v1', 'QR_CHECKOUT', 'CONSENT', 'DECLINED',
    'crm-declined'
  )
);
select is((select value->>'code' from pg_temp.crm_results where name = 'not_opted_in'),
  'CRM_EXPLICIT_OPT_IN_REQUIRED', 'declining consent creates no profile');
select is((select count(*)::integer from public.crm_profiles
           where contact_identifier_hash = repeat('2', 64)), 0,
  'declining remains independent from ordering and creates no CRM row');

insert into pg_temp.crm_results values (
  'opted_in',
  public.opt_in_crm_loyalty_profile(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    repeat('3', 64), 'vault://contact/verified-1', 'PHONE', now(),
    'LOYALTY_MEMBERSHIP', 'v1', 'QR_CHECKOUT', 'CONSENT', 'EXPLICIT_OPT_IN',
    'crm-opt-in'
  )
);
select is((select value->>'code' from pg_temp.crm_results where name = 'opted_in'),
  'CRM_PROFILE_CREATED', 'explicit opt-in creates a profile');
select is((select count(*)::integer from public.crm_profiles
           where contact_identifier_hash = repeat('3', 64)), 1,
  'one consented profile is stored');
select is((select count(*)::integer from public.crm_consent_records consent_record
           join public.crm_profiles profile on profile.id = consent_record.profile_id
           where profile.contact_identifier_hash = repeat('3', 64)
             and consent_record.decision = 'GRANTED'), 1,
  'granular consent evidence is stored');

insert into pg_temp.crm_results values (
  'marketing_opt_in',
  public.opt_in_crm_loyalty_profile(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    repeat('3', 64), 'vault://contact/verified-1', 'PHONE', now(),
    'MARKETING_EMAIL', 'v1', 'QR_CHECKOUT', 'CONSENT', 'EXPLICIT_OPT_IN',
    'crm-marketing-opt-in'
  )
);

insert into pg_temp.crm_results values (
  'second_opted_in',
  public.opt_in_crm_loyalty_profile(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    repeat('5', 64), 'vault://contact/verified-2', 'PHONE', now(),
    'LOYALTY_MEMBERSHIP', 'v1', 'QR_CHECKOUT', 'CONSENT', 'EXPLICIT_OPT_IN',
    'crm-second-opt-in'
  )
);

insert into pg_temp.crm_results
select 'earn', public.post_loyalty_points_event(
  account.organization_id, account.stall_id, account.id, 'EARN', 120,
  'b5100000-0000-4000-8000-000000000001', 'ORDER_COMPLETED',
  'order:b5100000-0000-4000-8000-000000000001:earn:v1', null, null,
  'crm-points-earn'
)
from public.loyalty_accounts account
join public.crm_profiles profile on profile.id = account.profile_id
where profile.contact_identifier_hash = repeat('3', 64);
select is((select (value->>'balance')::integer from pg_temp.crm_results where name = 'earn'),
  120, 'earn event establishes ledger-derived balance');

insert into pg_temp.crm_results
select 'earn_replay', public.post_loyalty_points_event(
  account.organization_id, account.stall_id, account.id, 'EARN', 120,
  'b5100000-0000-4000-8000-000000000001', 'ORDER_COMPLETED',
  'order:b5100000-0000-4000-8000-000000000001:earn:v1', null, null,
  'crm-points-earn-replay'
)
from public.loyalty_accounts account
join public.crm_profiles profile on profile.id = account.profile_id
where profile.contact_identifier_hash = repeat('3', 64);
select is((select value->>'code' from pg_temp.crm_results where name = 'earn_replay'),
  'LOYALTY_EVENT_REPLAYED', 'order event idempotency returns the original entry');
select is((select count(*)::integer from public.loyalty_points_ledger), 1,
  'replayed earn does not add ledger rows');

insert into pg_temp.crm_results
select 'earn_conflict_account', public.post_loyalty_points_event(
  account.organization_id, account.stall_id, account.id, 'EARN', 120,
  'b5100000-0000-4000-8000-000000000001', 'ORDER_COMPLETED',
  'order:b5100000-0000-4000-8000-000000000001:earn:v1', null, null,
  'crm-points-conflict-account'
)
from public.loyalty_accounts account
join public.crm_profiles profile on profile.id = account.profile_id
where profile.contact_identifier_hash = repeat('5', 64);
select is((select value from pg_temp.crm_results where name = 'earn_conflict_account'),
  '{"ok": false, "code": "LOYALTY_EVENT_IDEMPOTENCY_CONFLICT"}'::jsonb,
  'same event key with a different account fails closed without leaking the original event');

insert into pg_temp.crm_results
select 'earn_conflict_points', public.post_loyalty_points_event(
  account.organization_id, account.stall_id, account.id, 'EARN', 121,
  'b5100000-0000-4000-8000-000000000001', 'ORDER_COMPLETED',
  'order:b5100000-0000-4000-8000-000000000001:earn:v1', null, null,
  'crm-points-conflict-points'
)
from public.loyalty_accounts account
join public.crm_profiles profile on profile.id = account.profile_id
where profile.contact_identifier_hash = repeat('3', 64);
select is((select value from pg_temp.crm_results where name = 'earn_conflict_points'),
  '{"ok": false, "code": "LOYALTY_EVENT_IDEMPOTENCY_CONFLICT"}'::jsonb,
  'same event key with different points fails closed without leaking the original event');

insert into pg_temp.crm_results
select 'earn_conflict_order', public.post_loyalty_points_event(
  account.organization_id, account.stall_id, account.id, 'EARN', 120,
  'b5100000-0000-4000-8000-000000000002', 'ORDER_COMPLETED',
  'order:b5100000-0000-4000-8000-000000000001:earn:v1', null, null,
  'crm-points-conflict-order'
)
from public.loyalty_accounts account
join public.crm_profiles profile on profile.id = account.profile_id
where profile.contact_identifier_hash = repeat('3', 64);
select is((select value from pg_temp.crm_results where name = 'earn_conflict_order'),
  '{"ok": false, "code": "LOYALTY_EVENT_IDEMPOTENCY_CONFLICT"}'::jsonb,
  'same event key with a different order fails closed without leaking the original event');

insert into pg_temp.crm_results
select 'earn_conflict_reversal', public.post_loyalty_points_event(
  account.organization_id, account.stall_id, account.id, 'EARN', 120,
  'b5100000-0000-4000-8000-000000000001', 'ORDER_COMPLETED',
  'order:b5100000-0000-4000-8000-000000000001:earn:v1', ledger.id, null,
  'crm-points-conflict-reversal'
)
from public.loyalty_accounts account
join public.crm_profiles profile on profile.id = account.profile_id
join public.loyalty_points_ledger ledger on ledger.account_id = account.id
where profile.contact_identifier_hash = repeat('3', 64)
  and ledger.entry_type = 'EARN';
select is((select value from pg_temp.crm_results where name = 'earn_conflict_reversal'),
  '{"ok": false, "code": "LOYALTY_EVENT_IDEMPOTENCY_CONFLICT"}'::jsonb,
  'same event key with a different reversal link fails closed without leaking the original event');

insert into pg_temp.crm_results
select 'earn_conflict_entry_type', public.post_loyalty_points_event(
  account.organization_id, account.stall_id, account.id, 'ADJUST', 120,
  'b5100000-0000-4000-8000-000000000001', 'ORDER_COMPLETED',
  'order:b5100000-0000-4000-8000-000000000001:earn:v1', null, null,
  'crm-points-conflict-entry-type'
)
from public.loyalty_accounts account
join public.crm_profiles profile on profile.id = account.profile_id
where profile.contact_identifier_hash = repeat('3', 64);
select is((select value from pg_temp.crm_results where name = 'earn_conflict_entry_type'),
  '{"ok": false, "code": "LOYALTY_EVENT_IDEMPOTENCY_CONFLICT"}'::jsonb,
  'same event key with a different entry type fails closed without leaking the original event');

insert into pg_temp.crm_results
select 'earn_conflict_actor', public.post_loyalty_points_event(
  account.organization_id, account.stall_id, account.id, 'EARN', 120,
  'b5100000-0000-4000-8000-000000000001', 'ORDER_COMPLETED',
  'order:b5100000-0000-4000-8000-000000000001:earn:v1', null,
  '33333333-3333-4333-8333-333333333333', 'crm-points-conflict-actor'
)
from public.loyalty_accounts account
join public.crm_profiles profile on profile.id = account.profile_id
where profile.contact_identifier_hash = repeat('3', 64);
select is((select value from pg_temp.crm_results where name = 'earn_conflict_actor'),
  '{"ok": false, "code": "LOYALTY_EVENT_IDEMPOTENCY_CONFLICT"}'::jsonb,
  'same event key with a different actor fails closed without leaking the original event');

insert into pg_temp.crm_results
select 'reverse', public.post_loyalty_points_event(
  account.organization_id, account.stall_id, account.id, 'REVERSE', -120,
  'b5100000-0000-4000-8000-000000000001', 'ORDER_REFUNDED',
  'order:b5100000-0000-4000-8000-000000000001:refund:v1',
  ledger.id, null, 'crm-points-reverse'
)
from public.loyalty_accounts account
join public.crm_profiles profile on profile.id = account.profile_id
join public.loyalty_points_ledger ledger on ledger.account_id = account.id
where profile.contact_identifier_hash = repeat('3', 64)
  and ledger.entry_type = 'EARN';
select is((select (value->>'balance')::integer from pg_temp.crm_results where name = 'reverse'),
  0, 'refund reversal converges balance through a new ledger entry');
select throws_ok(
  $$ update public.loyalty_points_ledger set points_delta = 999 where entry_type = 'EARN' $$,
  '55000', 'LOYALTY_LEDGER_IMMUTABLE', 'ledger entries cannot be edited'
);
select throws_ok(
  $$ delete from public.loyalty_points_ledger where entry_type = 'EARN' $$,
  '55000', 'LOYALTY_LEDGER_IMMUTABLE', 'ledger entries cannot be deleted'
);

insert into pg_temp.crm_results
select 'withdraw', public.withdraw_crm_consent(
  profile.organization_id, profile.stall_id, profile.id,
  'MARKETING_EMAIL', 'USER_SELF_SERVICE', 'WITHDRAWN', 'crm-withdraw'
)
from public.crm_profiles profile
where profile.contact_identifier_hash = repeat('3', 64);
select is((select value->>'code' from pg_temp.crm_results where name = 'withdraw'),
  'CRM_CONSENT_WITHDRAWN', 'withdrawal is easy and recorded');
select ok((select marketing_suppressed_at is not null from public.crm_profiles
           where contact_identifier_hash = repeat('3', 64)),
  'withdrawal suppresses marketing without touching order fulfillment');

insert into pg_temp.crm_results
select 'export', public.export_crm_loyalty_profile(
  profile.organization_id, profile.stall_id, profile.id, 'crm-export'
)
from public.crm_profiles profile
where profile.contact_identifier_hash = repeat('3', 64);
select is((select value->>'code' from pg_temp.crm_results where name = 'export'),
  'CRM_EXPORT_READY', 'data subject export contract returns foundation data');

insert into pg_temp.crm_results
select 'erase', public.erase_crm_loyalty_profile(
  profile.organization_id, profile.stall_id, profile.id,
  repeat('4', 64), 'USER_REQUEST', 'crm-erase'
)
from public.crm_profiles profile
where profile.contact_identifier_hash = repeat('3', 64);
select is((select value->>'code' from pg_temp.crm_results where name = 'erase'),
  'CRM_PROFILE_ERASED', 'erasure removes the operational profile');
select is((select count(*)::integer from public.crm_profiles
           where contact_identifier_hash = repeat('3', 64)), 0,
  'operational profile is deleted');
select is((select count(*)::integer from public.crm_erasure_tombstones
           where subject_hash = repeat('4', 64)), 1,
  'minimal required erasure tombstone remains');
select is((select count(*)::integer from public.audit_logs
           where action like 'CRM_%' or action like 'LOYALTY_%') > 0,
  true, 'consent, lifecycle, and points changes are auditable');

select * from finish();
rollback;
