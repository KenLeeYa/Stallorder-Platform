-- Phase 3 foundations remain dormant until a later, separately reviewed
-- activation migration removes this database boundary.

create function app_private.enforce_phase_three_feature_flag_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_flag_code text;
begin
  if tg_table_schema = 'public'
     and tg_table_name = 'resilience_feature_flags' then
    if tg_op = 'UPDATE'
       and old.code is distinct from new.code
       and (
         old.code in (
           'DIGITAL_WAITLIST_FOUNDATION_ENABLED',
           'ONLINE_ORDER_PAYMENT_ENABLED',
           'RESERVATION_PREORDER_ENABLED',
           'DYNAMIC_ORDERING_QR_FOUNDATION_ENABLED',
           'CRM_LOYALTY_CONSENT_FOUNDATION_ENABLED'
         )
         or new.code in (
           'DIGITAL_WAITLIST_FOUNDATION_ENABLED',
           'ONLINE_ORDER_PAYMENT_ENABLED',
           'RESERVATION_PREORDER_ENABLED',
           'DYNAMIC_ORDERING_QR_FOUNDATION_ENABLED',
           'CRM_LOYALTY_CONSENT_FOUNDATION_ENABLED'
         )
       ) then
      raise exception 'RESILIENCE_PHASE_THREE_FLAG_LOCKED'
        using errcode = '23514';
    end if;

    if new.code in (
      'DIGITAL_WAITLIST_FOUNDATION_ENABLED',
      'ONLINE_ORDER_PAYMENT_ENABLED',
      'RESERVATION_PREORDER_ENABLED',
      'DYNAMIC_ORDERING_QR_FOUNDATION_ENABLED',
      'CRM_LOYALTY_CONSENT_FOUNDATION_ENABLED'
    ) then
      if new.default_enabled then
        raise exception 'RESILIENCE_PHASE_THREE_FLAG_LOCKED'
          using errcode = '23514';
      end if;
    end if;

    return new;
  end if;

  if tg_table_schema = 'public'
     and tg_table_name = 'resilience_feature_flag_overrides' then
    if not new.enabled then
      return new;
    end if;

    select flag.code
    into v_flag_code
    from public.resilience_feature_flags flag
    where flag.id = new.flag_id;

    if v_flag_code in (
      'DIGITAL_WAITLIST_FOUNDATION_ENABLED',
      'ONLINE_ORDER_PAYMENT_ENABLED',
      'RESERVATION_PREORDER_ENABLED',
      'DYNAMIC_ORDERING_QR_FOUNDATION_ENABLED',
      'CRM_LOYALTY_CONSENT_FOUNDATION_ENABLED'
    ) then
      raise exception 'RESILIENCE_PHASE_THREE_FLAG_LOCKED'
        using errcode = '23514';
    end if;

    return new;
  end if;

  raise exception 'RESILIENCE_PHASE_THREE_FLAG_GUARD_MISCONFIGURED'
    using errcode = '55000';
end;
$$;

create trigger resilience_feature_flags_phase_three_lock_guard
before insert or update of code, default_enabled
on public.resilience_feature_flags
for each row execute function app_private.enforce_phase_three_feature_flag_lock();

create trigger resilience_feature_flag_overrides_phase_three_lock_guard
before insert or update of flag_id, enabled
on public.resilience_feature_flag_overrides
for each row execute function app_private.enforce_phase_three_feature_flag_lock();

-- Install both write guards before cleanup. CREATE TRIGGER holds the table lock
-- through commit, so a concurrent writer either finishes before cleanup or
-- resumes after the guards are visible.
update public.resilience_feature_flag_overrides flag_override
set enabled = false,
    reason = case
      when position('[PHASE3_HARD_LOCK]' in flag_override.reason) > 0
        then flag_override.reason
      else left(flag_override.reason || ' [PHASE3_HARD_LOCK]', 500)
    end
from public.resilience_feature_flags flag
where flag_override.flag_id = flag.id
  and flag_override.enabled
  and flag.code in (
    'DIGITAL_WAITLIST_FOUNDATION_ENABLED',
    'ONLINE_ORDER_PAYMENT_ENABLED',
    'RESERVATION_PREORDER_ENABLED',
    'DYNAMIC_ORDERING_QR_FOUNDATION_ENABLED',
    'CRM_LOYALTY_CONSENT_FOUNDATION_ENABLED'
  );

update public.resilience_feature_flags
set default_enabled = false
where default_enabled
  and code in (
    'DIGITAL_WAITLIST_FOUNDATION_ENABLED',
    'ONLINE_ORDER_PAYMENT_ENABLED',
    'RESERVATION_PREORDER_ENABLED',
    'DYNAMIC_ORDERING_QR_FOUNDATION_ENABLED',
    'CRM_LOYALTY_CONSENT_FOUNDATION_ENABLED'
  );

alter table public.resilience_feature_flags
  add constraint resilience_feature_flags_phase_three_default_off_check
  check (
    code not in (
      'DIGITAL_WAITLIST_FOUNDATION_ENABLED',
      'ONLINE_ORDER_PAYMENT_ENABLED',
      'RESERVATION_PREORDER_ENABLED',
      'DYNAMIC_ORDERING_QR_FOUNDATION_ENABLED',
      'CRM_LOYALTY_CONSENT_FOUNDATION_ENABLED'
    )
    or not default_enabled
  );

revoke all on function app_private.enforce_phase_three_feature_flag_lock()
  from public, anon, authenticated, service_role;

comment on function app_private.enforce_phase_three_feature_flag_lock() is
  'Database hard lock that keeps the five unapproved Phase 3 foundations disabled across catalog and scoped override writes.';
