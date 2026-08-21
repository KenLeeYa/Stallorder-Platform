-- QR-P3-05: consent-governed CRM and immutable loyalty ledger foundation.
-- Local foundation only. Product, Legal/Privacy, Security, and Merchant
-- Operations approval is required before the default-off flag may be enabled.

create type public.crm_profile_status as enum (
  'ACTIVE',
  'UNSUBSCRIBED',
  'ERASED'
);

create type public.crm_consent_decision as enum (
  'GRANTED',
  'WITHDRAWN'
);

create type public.loyalty_account_status as enum (
  'ACTIVE',
  'CLOSED'
);

create type public.loyalty_points_entry_type as enum (
  'EARN',
  'ADJUST',
  'EXPIRE',
  'REVERSE'
);

do $$
begin
  if not exists (
    select 1
    from public.backend_runtime_state
    where is_current
      and backend_code = 'DR'
      and backend_role = 'READ_ONLY_STANDBY'
      and not writes_enabled
      and enforcement_enabled
  ) then
    perform app_private.assert_backend_writable();

    insert into public.resilience_feature_flags (
      code,
      description,
      default_enabled,
      is_emergency
    )
    values (
      'CRM_LOYALTY_CONSENT_FOUNDATION_ENABLED',
      'Provisional QR-P3-05 consent-governed CRM and loyalty foundation. Production activation requires Product and Legal/Privacy approval.',
      false,
      false
    )
    on conflict (code) do nothing;
  end if;
end;
$$;

create table public.crm_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  stall_id uuid not null,
  contact_identifier_hash text,
  contact_reference text,
  contact_type text,
  contact_verified_at timestamptz,
  status public.crm_profile_status not null default 'ACTIVE',
  marketing_suppressed_at timestamptz,
  erased_at timestamptz,
  retention_expires_at timestamptz not null default (now() + interval '365 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_profiles_stall_scope_fkey
    foreign key (stall_id, organization_id)
    references public.stalls(id, organization_id) on delete cascade,
  constraint crm_profiles_id_scope_key
    unique (id, organization_id, stall_id),
  constraint crm_profiles_contact_hash_check check (
    contact_identifier_hash is null
    or contact_identifier_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint crm_profiles_contact_reference_check check (
    contact_reference is null
    or (
      char_length(contact_reference) between 12 and 300
      and contact_reference ~ '^(vault|kms)://[A-Za-z0-9._:/-]+$'
    )
  ),
  constraint crm_profiles_contact_type_check check (
    contact_type is null or contact_type in ('PHONE', 'EMAIL')
  ),
  constraint crm_profiles_lifecycle_check check (
    (
      status in ('ACTIVE', 'UNSUBSCRIBED')
      and contact_identifier_hash is not null
      and contact_reference is not null
      and contact_type is not null
      and contact_verified_at is not null
      and erased_at is null
    )
    or (
      status = 'ERASED'
      and contact_identifier_hash is null
      and contact_reference is null
      and contact_type is null
      and contact_verified_at is null
      and erased_at is not null
    )
  ),
  constraint crm_profiles_retention_check check (
    retention_expires_at > created_at
    and retention_expires_at <= updated_at + interval '366 days'
  )
);

create unique index crm_profiles_contact_identity_unique
  on public.crm_profiles (organization_id, stall_id, contact_identifier_hash)
  where contact_identifier_hash is not null;

create index crm_profiles_scope_status_idx
  on public.crm_profiles (organization_id, stall_id, status, created_at desc);

create table public.crm_consent_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  stall_id uuid not null,
  profile_id uuid not null,
  purpose_code text not null,
  notice_version text not null,
  consent_source text not null,
  lawful_basis text not null,
  decision public.crm_consent_decision not null,
  captured_at timestamptz not null default now(),
  contact_verified_at timestamptz not null,
  withdrawn_at timestamptz,
  withdrawal_source text,
  withdrawal_reason text,
  retention_expires_at timestamptz not null default (now() + interval '730 days'),
  request_id text not null,
  created_at timestamptz not null default now(),
  constraint crm_consent_records_profile_scope_fkey
    foreign key (profile_id, organization_id, stall_id)
    references public.crm_profiles(id, organization_id, stall_id) on delete restrict,
  constraint crm_consent_records_purpose_check check (
    purpose_code ~ '^[A-Z][A-Z0-9_]{1,79}$'
  ),
  constraint crm_consent_records_notice_version_check check (
    char_length(btrim(notice_version)) between 1 and 80
  ),
  constraint crm_consent_records_source_check check (
    consent_source ~ '^[A-Z][A-Z0-9_]{1,79}$'
  ),
  constraint crm_consent_records_lawful_basis_check check (
    lawful_basis = 'CONSENT'
  ),
  constraint crm_consent_records_decision_check check (
    (
      decision = 'GRANTED'
      and withdrawn_at is null
      and withdrawal_source is null
      and withdrawal_reason is null
    )
    or (
      decision = 'WITHDRAWN'
      and withdrawn_at is not null
      and withdrawal_source ~ '^[A-Z][A-Z0-9_]{1,79}$'
      and char_length(btrim(withdrawal_reason)) between 1 and 300
    )
  ),
  constraint crm_consent_records_retention_check check (
    retention_expires_at > created_at
    and retention_expires_at <= created_at + interval '731 days'
  ),
  constraint crm_consent_records_request_id_check check (
    char_length(btrim(request_id)) between 1 and 100
  )
);

create index crm_consent_records_profile_purpose_idx
  on public.crm_consent_records (
    organization_id, stall_id, profile_id, purpose_code, captured_at desc, id desc
  );

create table public.loyalty_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  stall_id uuid not null,
  profile_id uuid not null,
  status public.loyalty_account_status not null default 'ACTIVE',
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loyalty_accounts_profile_scope_fkey
    foreign key (profile_id, organization_id, stall_id)
    references public.crm_profiles(id, organization_id, stall_id) on delete restrict,
  constraint loyalty_accounts_id_scope_key
    unique (id, organization_id, stall_id),
  constraint loyalty_accounts_profile_unique
    unique (organization_id, stall_id, profile_id),
  constraint loyalty_accounts_lifecycle_check check (
    (status = 'ACTIVE' and closed_at is null)
    or (status = 'CLOSED' and closed_at is not null)
  )
);

create index loyalty_accounts_scope_status_idx
  on public.loyalty_accounts (organization_id, stall_id, status, opened_at desc);

create table public.loyalty_points_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  stall_id uuid not null,
  account_id uuid not null,
  entry_type public.loyalty_points_entry_type not null,
  points_delta integer not null,
  order_id uuid,
  source_event_type text not null,
  source_event_id text not null,
  reversal_of_ledger_id uuid,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint loyalty_points_ledger_account_scope_fkey
    foreign key (account_id, organization_id, stall_id)
    references public.loyalty_accounts(id, organization_id, stall_id) on delete restrict,
  constraint loyalty_points_ledger_reversal_fkey
    foreign key (reversal_of_ledger_id)
    references public.loyalty_points_ledger(id) on delete restrict,
  constraint loyalty_points_ledger_delta_check check (
    (entry_type = 'EARN' and points_delta > 0 and reversal_of_ledger_id is null)
    or (entry_type = 'ADJUST' and points_delta <> 0 and reversal_of_ledger_id is null)
    or (entry_type = 'EXPIRE' and points_delta < 0 and reversal_of_ledger_id is null)
    or (entry_type = 'REVERSE' and points_delta < 0 and reversal_of_ledger_id is not null)
  ),
  constraint loyalty_points_ledger_event_type_check check (
    source_event_type ~ '^[A-Z][A-Z0-9_]{1,79}$'
  ),
  constraint loyalty_points_ledger_event_id_check check (
    char_length(btrim(source_event_id)) between 1 and 160
  )
);

create unique index loyalty_points_ledger_event_idempotency
  on public.loyalty_points_ledger (
    organization_id, stall_id, source_event_type, source_event_id
  );

create unique index loyalty_points_ledger_one_reversal
  on public.loyalty_points_ledger (reversal_of_ledger_id)
  where reversal_of_ledger_id is not null;

create index loyalty_points_ledger_account_created_idx
  on public.loyalty_points_ledger (account_id, created_at, id);

create index loyalty_points_ledger_order_idx
  on public.loyalty_points_ledger (organization_id, stall_id, order_id)
  where order_id is not null;

create function app_private.loyalty_event_payload_matches(
  p_existing public.loyalty_points_ledger,
  p_account_id uuid,
  p_entry_type text,
  p_points_delta integer,
  p_order_id uuid,
  p_reversal_of_ledger_id uuid,
  p_actor_profile_id uuid
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_existing).account_id is not distinct from p_account_id
    and (p_existing).entry_type::text is not distinct from p_entry_type
    and (p_existing).points_delta is not distinct from p_points_delta
    and (p_existing).order_id is not distinct from p_order_id
    and (p_existing).reversal_of_ledger_id is not distinct from p_reversal_of_ledger_id
    and (p_existing).actor_profile_id is not distinct from p_actor_profile_id;
$$;

create table public.crm_erasure_tombstones (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  stall_id uuid not null,
  erased_profile_id uuid not null,
  subject_hash text not null,
  erasure_reason text not null,
  erased_at timestamptz not null default now(),
  audit_retention_expires_at timestamptz not null default (now() + interval '2190 days'),
  request_id text not null,
  constraint crm_erasure_tombstones_stall_scope_fkey
    foreign key (stall_id, organization_id)
    references public.stalls(id, organization_id) on delete cascade,
  constraint crm_erasure_tombstones_subject_hash_check check (
    subject_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint crm_erasure_tombstones_reason_check check (
    char_length(btrim(erasure_reason)) between 1 and 300
  ),
  constraint crm_erasure_tombstones_retention_check check (
    audit_retention_expires_at > erased_at
    and audit_retention_expires_at <= erased_at + interval '2191 days'
  ),
  constraint crm_erasure_tombstones_request_id_check check (
    char_length(btrim(request_id)) between 1 and 100
  )
);

create unique index crm_erasure_tombstones_subject_unique
  on public.crm_erasure_tombstones (organization_id, stall_id, subject_hash);

create index crm_erasure_tombstones_profile_idx
  on public.crm_erasure_tombstones (organization_id, stall_id, erased_profile_id);

create function app_private.crm_loyalty_foundation_enabled(
  p_organization_id uuid,
  p_stall_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_flag_id uuid;
  v_default boolean;
  v_override boolean;
begin
  select flag.id, flag.default_enabled
  into v_flag_id, v_default
  from public.resilience_feature_flags flag
  where flag.code = 'CRM_LOYALTY_CONSENT_FOUNDATION_ENABLED';

  if not found then
    return false;
  end if;

  select override.enabled
  into v_override
  from public.resilience_feature_flag_overrides override
  where override.flag_id = v_flag_id
    and (override.expires_at is null or override.expires_at > now())
    and (
      (
        override.scope_type = 'STALL'
        and override.organization_id = p_organization_id
        and override.stall_id = p_stall_id
      )
      or (
        override.scope_type = 'ORGANIZATION'
        and override.organization_id = p_organization_id
      )
      or override.scope_type = 'GLOBAL'
    )
  order by case override.scope_type
    when 'STALL' then 1
    when 'ORGANIZATION' then 2
    when 'GLOBAL' then 3
    else 4
  end
  limit 1;

  return coalesce(v_override, v_default, false);
end;
$$;

create function app_private.record_crm_loyalty_audit(
  p_organization_id uuid,
  p_stall_id uuid,
  p_actor_profile_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_outcome public.audit_outcome,
  p_request_id text,
  p_metadata jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (
    id, tenant_id, organization_id, stall_id, actor_profile_id,
    action, entity_type, entity_id, outcome, request_id, metadata, created_at
  ) values (
    gen_random_uuid(), p_organization_id, p_organization_id, p_stall_id,
    p_actor_profile_id, left(p_action, 80), left(p_entity_type, 80), p_entity_id,
    p_outcome, left(p_request_id, 100),
    coalesce(p_metadata, '{}'::jsonb)::text, now()
  );
$$;

create function app_private.touch_crm_loyalty_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create function app_private.reject_crm_consent_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'CRM_CONSENT_RECORD_IMMUTABLE' using errcode = '55000';
end;
$$;

create function app_private.reject_loyalty_ledger_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'LOYALTY_LEDGER_IMMUTABLE' using errcode = '55000';
end;
$$;

create function app_private.reject_crm_erasure_tombstone_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'CRM_ERASURE_TOMBSTONE_IMMUTABLE' using errcode = '55000';
end;
$$;

create trigger crm_profiles_touch_updated_at
before update on public.crm_profiles
for each row execute function app_private.touch_crm_loyalty_updated_at();

create trigger backend_writable_guard
before insert or update or delete on public.crm_profiles
for each statement execute function app_private.enforce_backend_writable();

create trigger loyalty_accounts_touch_updated_at
before update on public.loyalty_accounts
for each row execute function app_private.touch_crm_loyalty_updated_at();

create trigger backend_writable_guard
before insert or update or delete on public.loyalty_accounts
for each statement execute function app_private.enforce_backend_writable();

create trigger crm_consent_records_immutable_guard
before update or delete on public.crm_consent_records
for each row execute function app_private.reject_crm_consent_mutation();

create trigger backend_writable_guard
before insert or update or delete on public.crm_consent_records
for each statement execute function app_private.enforce_backend_writable();

create trigger loyalty_points_ledger_immutable_guard
before update or delete on public.loyalty_points_ledger
for each row execute function app_private.reject_loyalty_ledger_mutation();

create trigger backend_writable_guard
before insert or update or delete on public.loyalty_points_ledger
for each statement execute function app_private.enforce_backend_writable();

create trigger crm_erasure_tombstones_immutable_guard
before update or delete on public.crm_erasure_tombstones
for each row execute function app_private.reject_crm_erasure_tombstone_mutation();

create trigger backend_writable_guard
before insert or update or delete on public.crm_erasure_tombstones
for each statement execute function app_private.enforce_backend_writable();

create function public.opt_in_crm_loyalty_profile(
  p_organization_id uuid,
  p_stall_id uuid,
  p_contact_identifier_hash text,
  p_contact_reference text,
  p_contact_type text,
  p_contact_verified_at timestamptz,
  p_purpose_code text,
  p_notice_version text,
  p_consent_source text,
  p_lawful_basis text,
  p_decision text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_profile_id uuid;
  v_created boolean;
  v_account_id uuid;
begin
  if not app_private.crm_loyalty_foundation_enabled(
    p_organization_id,
    p_stall_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'CRM_LOYALTY_DISABLED');
  end if;

  if not exists (
    select 1
    from public.stalls stall
    where stall.id = p_stall_id
      and stall.organization_id = p_organization_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'CRM_STALL_SCOPE_INVALID');
  end if;

  if p_contact_verified_at is null
    or p_contact_verified_at > v_now + interval '5 minutes' then
    return jsonb_build_object('ok', false, 'code', 'CRM_CONTACT_NOT_VERIFIED');
  end if;

  if p_decision is distinct from 'EXPLICIT_OPT_IN' then
    perform app_private.record_crm_loyalty_audit(
      p_organization_id, p_stall_id, null,
      'CRM_OPT_IN_REJECTED', 'CRM_PROFILE', null,
      'DENIED'::public.audit_outcome, p_request_id,
      jsonb_build_object('reason', 'EXPLICIT_OPT_IN_REQUIRED', 'purpose', p_purpose_code)
    );
    return jsonb_build_object('ok', false, 'code', 'CRM_EXPLICIT_OPT_IN_REQUIRED');
  end if;

  if p_contact_identifier_hash is null
    or p_contact_identifier_hash !~ '^[a-f0-9]{64}$'
    or p_contact_reference is null
    or p_contact_reference !~ '^(vault|kms)://[A-Za-z0-9._:/-]+$'
    or char_length(p_contact_reference) not between 12 and 300
    or p_contact_type not in ('PHONE', 'EMAIL')
    or p_purpose_code !~ '^[A-Z][A-Z0-9_]{1,79}$'
    or char_length(btrim(coalesce(p_notice_version, ''))) not between 1 and 80
    or p_consent_source !~ '^[A-Z][A-Z0-9_]{1,79}$'
    or p_lawful_basis is distinct from 'CONSENT'
    or char_length(btrim(coalesce(p_request_id, ''))) not between 1 and 100 then
    return jsonb_build_object('ok', false, 'code', 'CRM_CONSENT_INPUT_INVALID');
  end if;

  insert into public.crm_profiles (
    organization_id, stall_id, contact_identifier_hash, contact_reference,
    contact_type, contact_verified_at, status, marketing_suppressed_at,
    retention_expires_at, created_at, updated_at
  ) values (
    p_organization_id, p_stall_id, p_contact_identifier_hash,
    p_contact_reference, p_contact_type, p_contact_verified_at,
    'ACTIVE'::public.crm_profile_status, null,
    v_now + interval '365 days', v_now, v_now
  )
  on conflict (organization_id, stall_id, contact_identifier_hash)
    where contact_identifier_hash is not null
  do update set
    contact_reference = excluded.contact_reference,
    contact_type = excluded.contact_type,
    contact_verified_at = excluded.contact_verified_at,
    status = case
      when p_purpose_code like 'MARKETING_%'
        then 'ACTIVE'::public.crm_profile_status
      else public.crm_profiles.status
    end,
    marketing_suppressed_at = case
      when p_purpose_code like 'MARKETING_%' then null
      else public.crm_profiles.marketing_suppressed_at
    end,
    retention_expires_at = greatest(
      public.crm_profiles.retention_expires_at,
      v_now + interval '365 days'
    ),
    updated_at = v_now
  returning id, (xmax = 0) into v_profile_id, v_created;

  insert into public.crm_consent_records (
    organization_id, stall_id, profile_id, purpose_code, notice_version,
    consent_source, lawful_basis, decision, captured_at,
    contact_verified_at, retention_expires_at, request_id, created_at
  ) values (
    p_organization_id, p_stall_id, v_profile_id, p_purpose_code,
    btrim(p_notice_version), p_consent_source, 'CONSENT',
    'GRANTED'::public.crm_consent_decision, v_now,
    p_contact_verified_at, v_now + interval '730 days',
    left(p_request_id, 100), v_now
  );

  if p_purpose_code = 'LOYALTY_MEMBERSHIP' then
    insert into public.loyalty_accounts (
      organization_id, stall_id, profile_id, status,
      opened_at, created_at, updated_at
    ) values (
      p_organization_id, p_stall_id, v_profile_id,
      'ACTIVE'::public.loyalty_account_status, v_now, v_now, v_now
    )
    on conflict (organization_id, stall_id, profile_id)
    do update set
      status = 'ACTIVE'::public.loyalty_account_status,
      closed_at = null,
      updated_at = v_now
    returning id into v_account_id;
  end if;

  perform app_private.record_crm_loyalty_audit(
    p_organization_id, p_stall_id, null,
    'CRM_CONSENT_GRANTED', 'CRM_PROFILE', v_profile_id,
    'SUCCESS'::public.audit_outcome, p_request_id,
    jsonb_build_object(
      'purpose', p_purpose_code,
      'notice_version', btrim(p_notice_version),
      'consent_source', p_consent_source,
      'lawful_basis', 'CONSENT',
      'profile_created', v_created
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', case when v_created then 'CRM_PROFILE_CREATED' else 'CRM_CONSENT_RECORDED' end,
    'profile_id', v_profile_id,
    'loyalty_account_id', v_account_id,
    'purpose', p_purpose_code,
    'consented_at', v_now
  );
exception
  when check_violation then
    return jsonb_build_object('ok', false, 'code', 'CRM_CONSENT_INPUT_INVALID');
end;
$$;

create function public.withdraw_crm_consent(
  p_organization_id uuid,
  p_stall_id uuid,
  p_profile_id uuid,
  p_purpose_code text,
  p_withdrawal_source text,
  p_withdrawal_reason text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_latest public.crm_consent_records%rowtype;
begin
  if not app_private.crm_loyalty_foundation_enabled(
    p_organization_id,
    p_stall_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'CRM_LOYALTY_DISABLED');
  end if;

  if p_purpose_code !~ '^[A-Z][A-Z0-9_]{1,79}$'
    or p_withdrawal_source !~ '^[A-Z][A-Z0-9_]{1,79}$'
    or char_length(btrim(coalesce(p_withdrawal_reason, ''))) not between 1 and 300
    or char_length(btrim(coalesce(p_request_id, ''))) not between 1 and 100 then
    return jsonb_build_object('ok', false, 'code', 'CRM_WITHDRAWAL_INPUT_INVALID');
  end if;

  if not exists (
    select 1
    from public.crm_profiles profile
    where profile.id = p_profile_id
      and profile.organization_id = p_organization_id
      and profile.stall_id = p_stall_id
      and profile.status <> 'ERASED'
  ) then
    return jsonb_build_object('ok', false, 'code', 'CRM_PROFILE_NOT_FOUND');
  end if;

  select consent_record.*
  into v_latest
  from public.crm_consent_records consent_record
  where consent_record.organization_id = p_organization_id
    and consent_record.stall_id = p_stall_id
    and consent_record.profile_id = p_profile_id
    and consent_record.purpose_code = p_purpose_code
  order by consent_record.captured_at desc, consent_record.id desc
  limit 1;

  if not found or v_latest.decision <> 'GRANTED' then
    return jsonb_build_object('ok', true, 'code', 'CRM_CONSENT_ALREADY_WITHDRAWN');
  end if;

  insert into public.crm_consent_records (
    organization_id, stall_id, profile_id, purpose_code, notice_version,
    consent_source, lawful_basis, decision, captured_at,
    contact_verified_at, withdrawn_at, withdrawal_source, withdrawal_reason,
    retention_expires_at, request_id, created_at
  ) values (
    p_organization_id, p_stall_id, p_profile_id, p_purpose_code,
    v_latest.notice_version, p_withdrawal_source, v_latest.lawful_basis,
    'WITHDRAWN'::public.crm_consent_decision, v_now,
    v_latest.contact_verified_at, v_now, p_withdrawal_source,
    btrim(p_withdrawal_reason), v_now + interval '730 days',
    left(p_request_id, 100), v_now
  );

  if p_purpose_code like 'MARKETING_%' then
    update public.crm_profiles
    set status = 'UNSUBSCRIBED'::public.crm_profile_status,
        marketing_suppressed_at = v_now,
        updated_at = v_now
    where id = p_profile_id
      and organization_id = p_organization_id
      and stall_id = p_stall_id;
  elsif p_purpose_code = 'LOYALTY_MEMBERSHIP' then
    update public.loyalty_accounts
    set status = 'CLOSED'::public.loyalty_account_status,
        closed_at = coalesce(closed_at, v_now),
        updated_at = v_now
    where profile_id = p_profile_id
      and organization_id = p_organization_id
      and stall_id = p_stall_id
      and status = 'ACTIVE';
  end if;

  perform app_private.record_crm_loyalty_audit(
    p_organization_id, p_stall_id, null,
    'CRM_CONSENT_WITHDRAWN', 'CRM_PROFILE', p_profile_id,
    'SUCCESS'::public.audit_outcome, p_request_id,
    jsonb_build_object(
      'purpose', p_purpose_code,
      'withdrawal_source', p_withdrawal_source
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'CRM_CONSENT_WITHDRAWN',
    'profile_id', p_profile_id,
    'purpose', p_purpose_code,
    'withdrawn_at', v_now
  );
end;
$$;

create function public.unsubscribe_crm_profile(
  p_organization_id uuid,
  p_stall_id uuid,
  p_profile_id uuid,
  p_unsubscribe_source text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_latest record;
  v_withdrawn_count integer := 0;
begin
  if not app_private.crm_loyalty_foundation_enabled(
    p_organization_id,
    p_stall_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'CRM_LOYALTY_DISABLED');
  end if;

  if p_unsubscribe_source !~ '^[A-Z][A-Z0-9_]{1,79}$'
    or char_length(btrim(coalesce(p_request_id, ''))) not between 1 and 100 then
    return jsonb_build_object('ok', false, 'code', 'CRM_UNSUBSCRIBE_INPUT_INVALID');
  end if;

  if not exists (
    select 1
    from public.crm_profiles profile
    where profile.id = p_profile_id
      and profile.organization_id = p_organization_id
      and profile.stall_id = p_stall_id
      and profile.status <> 'ERASED'
  ) then
    return jsonb_build_object('ok', false, 'code', 'CRM_PROFILE_NOT_FOUND');
  end if;

  for v_latest in
    select distinct on (consent_record.purpose_code)
      consent_record.*
    from public.crm_consent_records consent_record
    where consent_record.organization_id = p_organization_id
      and consent_record.stall_id = p_stall_id
      and consent_record.profile_id = p_profile_id
      and consent_record.purpose_code like 'MARKETING_%'
    order by consent_record.purpose_code,
      consent_record.captured_at desc, consent_record.id desc
  loop
    if v_latest.decision = 'GRANTED'::public.crm_consent_decision then
      insert into public.crm_consent_records (
        organization_id, stall_id, profile_id, purpose_code, notice_version,
        consent_source, lawful_basis, decision, captured_at,
        contact_verified_at, withdrawn_at, withdrawal_source, withdrawal_reason,
        retention_expires_at, request_id, created_at
      ) values (
        p_organization_id, p_stall_id, p_profile_id, v_latest.purpose_code,
        v_latest.notice_version, p_unsubscribe_source, v_latest.lawful_basis,
        'WITHDRAWN'::public.crm_consent_decision, v_now,
        v_latest.contact_verified_at, v_now, p_unsubscribe_source,
        'UNSUBSCRIBED', v_now + interval '730 days',
        left(p_request_id, 100), v_now
      );
      v_withdrawn_count := v_withdrawn_count + 1;
    end if;
  end loop;

  update public.crm_profiles
  set status = 'UNSUBSCRIBED'::public.crm_profile_status,
      marketing_suppressed_at = coalesce(marketing_suppressed_at, v_now),
      updated_at = v_now
  where id = p_profile_id
    and organization_id = p_organization_id
    and stall_id = p_stall_id;

  perform app_private.record_crm_loyalty_audit(
    p_organization_id, p_stall_id, null,
    'CRM_PROFILE_UNSUBSCRIBED', 'CRM_PROFILE', p_profile_id,
    'SUCCESS'::public.audit_outcome, p_request_id,
    jsonb_build_object(
      'unsubscribe_source', p_unsubscribe_source,
      'purposes_withdrawn', v_withdrawn_count
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'CRM_PROFILE_UNSUBSCRIBED',
    'profile_id', p_profile_id,
    'purposes_withdrawn', v_withdrawn_count,
    'unsubscribed_at', v_now
  );
end;
$$;

create function public.post_loyalty_points_event(
  p_organization_id uuid,
  p_stall_id uuid,
  p_account_id uuid,
  p_entry_type text,
  p_points_delta integer,
  p_order_id uuid,
  p_source_event_type text,
  p_source_event_id text,
  p_reversal_of_ledger_id uuid,
  p_actor_profile_id uuid,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_account public.loyalty_accounts%rowtype;
  v_original public.loyalty_points_ledger%rowtype;
  v_entry public.loyalty_points_ledger%rowtype;
  v_balance integer;
begin
  if not app_private.crm_loyalty_foundation_enabled(
    p_organization_id,
    p_stall_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'CRM_LOYALTY_DISABLED');
  end if;

  if p_entry_type not in ('EARN', 'ADJUST', 'EXPIRE', 'REVERSE')
    or p_points_delta is null
    or p_points_delta = 0
    or abs(p_points_delta::bigint) > 1000000
    or p_source_event_type !~ '^[A-Z][A-Z0-9_]{1,79}$'
    or char_length(btrim(coalesce(p_source_event_id, ''))) not between 1 and 160
    or char_length(btrim(coalesce(p_request_id, ''))) not between 1 and 100 then
    return jsonb_build_object('ok', false, 'code', 'LOYALTY_EVENT_INPUT_INVALID');
  end if;

  select ledger.*
  into v_entry
  from public.loyalty_points_ledger ledger
  where ledger.organization_id = p_organization_id
    and ledger.stall_id = p_stall_id
    and ledger.source_event_type = p_source_event_type
    and ledger.source_event_id = btrim(p_source_event_id);

  if found then
    if not app_private.loyalty_event_payload_matches(
      v_entry,
      p_account_id,
      p_entry_type,
      p_points_delta,
      p_order_id,
      p_reversal_of_ledger_id,
      p_actor_profile_id
    ) then
      return jsonb_build_object(
        'ok', false,
        'code', 'LOYALTY_EVENT_IDEMPOTENCY_CONFLICT'
      );
    end if;

    select coalesce(sum(ledger.points_delta), 0)::integer
    into v_balance
    from public.loyalty_points_ledger ledger
    where ledger.account_id = v_entry.account_id;

    return jsonb_build_object(
      'ok', true,
      'code', 'LOYALTY_EVENT_REPLAYED',
      'ledger_id', v_entry.id,
      'account_id', v_entry.account_id,
      'balance', v_balance,
      'points_delta', v_entry.points_delta
    );
  end if;

  select account.*
  into v_account
  from public.loyalty_accounts account
  where account.id = p_account_id
    and account.organization_id = p_organization_id
    and account.stall_id = p_stall_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'LOYALTY_ACCOUNT_NOT_FOUND');
  end if;

  if v_account.status <> 'ACTIVE'
    and p_entry_type <> 'REVERSE' then
    return jsonb_build_object('ok', false, 'code', 'LOYALTY_ACCOUNT_CLOSED');
  end if;

  if p_order_id is not null and not exists (
    select 1
    from public.orders order_record
    where order_record.id = p_order_id
      and order_record.organization_id = p_organization_id
      and order_record.stall_id = p_stall_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'LOYALTY_ORDER_SCOPE_INVALID');
  end if;

  if p_entry_type = 'EARN'
    and (p_points_delta <= 0 or p_order_id is null or p_reversal_of_ledger_id is not null) then
    return jsonb_build_object('ok', false, 'code', 'LOYALTY_EARN_INPUT_INVALID');
  elsif p_entry_type = 'ADJUST'
    and (p_reversal_of_ledger_id is not null or p_actor_profile_id is null) then
    return jsonb_build_object('ok', false, 'code', 'LOYALTY_ADJUST_INPUT_INVALID');
  elsif p_entry_type = 'EXPIRE'
    and (p_points_delta >= 0 or p_reversal_of_ledger_id is not null) then
    return jsonb_build_object('ok', false, 'code', 'LOYALTY_EXPIRY_INPUT_INVALID');
  elsif p_entry_type = 'REVERSE' then
    if p_points_delta >= 0 or p_reversal_of_ledger_id is null then
      return jsonb_build_object('ok', false, 'code', 'LOYALTY_REVERSAL_INPUT_INVALID');
    end if;

    select ledger.*
    into v_original
    from public.loyalty_points_ledger ledger
    where ledger.id = p_reversal_of_ledger_id
      and ledger.organization_id = p_organization_id
      and ledger.stall_id = p_stall_id
      and ledger.account_id = p_account_id
      and ledger.points_delta > 0;

    if not found
      or p_points_delta <> -v_original.points_delta
      or p_order_id is distinct from v_original.order_id then
      return jsonb_build_object('ok', false, 'code', 'LOYALTY_REVERSAL_INPUT_INVALID');
    end if;

    if exists (
      select 1
      from public.loyalty_points_ledger reversal
      where reversal.reversal_of_ledger_id = p_reversal_of_ledger_id
    ) then
      return jsonb_build_object('ok', false, 'code', 'LOYALTY_EVENT_ALREADY_REVERSED');
    end if;
  elsif p_reversal_of_ledger_id is not null then
    return jsonb_build_object('ok', false, 'code', 'LOYALTY_REVERSAL_INPUT_INVALID');
  end if;

  insert into public.loyalty_points_ledger (
    organization_id, stall_id, account_id, entry_type, points_delta,
    order_id, source_event_type, source_event_id, reversal_of_ledger_id,
    actor_profile_id, created_at
  ) values (
    p_organization_id, p_stall_id, p_account_id,
    p_entry_type::public.loyalty_points_entry_type, p_points_delta,
    p_order_id, p_source_event_type, btrim(p_source_event_id),
    p_reversal_of_ledger_id, p_actor_profile_id, v_now
  )
  returning * into v_entry;

  select coalesce(sum(ledger.points_delta), 0)::integer
  into v_balance
  from public.loyalty_points_ledger ledger
  where ledger.account_id = p_account_id;

  perform app_private.record_crm_loyalty_audit(
    p_organization_id, p_stall_id, p_actor_profile_id,
    'LOYALTY_POINTS_EVENT_RECORDED', 'LOYALTY_ACCOUNT', p_account_id,
    'SUCCESS'::public.audit_outcome, p_request_id,
    jsonb_build_object(
      'entry_type', p_entry_type,
      'points_delta', p_points_delta,
      'source_event_type', p_source_event_type,
      'order_id', p_order_id,
      'is_reversal', p_reversal_of_ledger_id is not null
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'LOYALTY_EVENT_RECORDED',
    'ledger_id', v_entry.id,
    'account_id', p_account_id,
    'balance', v_balance,
    'points_delta', p_points_delta,
    'created_at', v_now
  );
exception
  when unique_violation then
    select ledger.*
    into v_entry
    from public.loyalty_points_ledger ledger
    where ledger.organization_id = p_organization_id
      and ledger.stall_id = p_stall_id
      and ledger.source_event_type = p_source_event_type
      and ledger.source_event_id = btrim(p_source_event_id);

    if found then
      if not app_private.loyalty_event_payload_matches(
        v_entry,
        p_account_id,
        p_entry_type,
        p_points_delta,
        p_order_id,
        p_reversal_of_ledger_id,
        p_actor_profile_id
      ) then
        return jsonb_build_object(
          'ok', false,
          'code', 'LOYALTY_EVENT_IDEMPOTENCY_CONFLICT'
        );
      end if;

      select coalesce(sum(ledger.points_delta), 0)::integer
      into v_balance
      from public.loyalty_points_ledger ledger
      where ledger.account_id = v_entry.account_id;
      return jsonb_build_object(
        'ok', true,
        'code', 'LOYALTY_EVENT_REPLAYED',
        'ledger_id', v_entry.id,
        'account_id', v_entry.account_id,
        'balance', v_balance,
        'points_delta', v_entry.points_delta
      );
    end if;

    return jsonb_build_object('ok', false, 'code', 'LOYALTY_EVENT_ALREADY_REVERSED');
end;
$$;

create function public.export_crm_loyalty_profile(
  p_organization_id uuid,
  p_stall_id uuid,
  p_profile_id uuid,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.crm_profiles%rowtype;
  v_payload jsonb;
begin
  if not app_private.crm_loyalty_foundation_enabled(
    p_organization_id,
    p_stall_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'CRM_LOYALTY_DISABLED');
  end if;

  if char_length(btrim(coalesce(p_request_id, ''))) not between 1 and 100 then
    return jsonb_build_object('ok', false, 'code', 'CRM_EXPORT_INPUT_INVALID');
  end if;

  select profile.*
  into v_profile
  from public.crm_profiles profile
  where profile.id = p_profile_id
    and profile.organization_id = p_organization_id
    and profile.stall_id = p_stall_id
    and profile.status <> 'ERASED';

  if not found then
    return jsonb_build_object('ok', false, 'code', 'CRM_PROFILE_NOT_FOUND');
  end if;

  select jsonb_build_object(
    'profile', jsonb_build_object(
      'profile_id', v_profile.id,
      'organization_id', v_profile.organization_id,
      'stall_id', v_profile.stall_id,
      'contact_type', v_profile.contact_type,
      'contact_verified_at', v_profile.contact_verified_at,
      'status', v_profile.status,
      'marketing_suppressed_at', v_profile.marketing_suppressed_at,
      'created_at', v_profile.created_at
    ),
    'consents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'purpose', consent_record.purpose_code,
        'notice_version', consent_record.notice_version,
        'source', consent_record.consent_source,
        'lawful_basis', consent_record.lawful_basis,
        'decision', consent_record.decision,
        'captured_at', consent_record.captured_at,
        'withdrawn_at', consent_record.withdrawn_at,
        'withdrawal_source', consent_record.withdrawal_source,
        'withdrawal_reason', consent_record.withdrawal_reason
      ) order by consent_record.captured_at, consent_record.id)
      from public.crm_consent_records consent_record
      where consent_record.profile_id = p_profile_id
        and consent_record.organization_id = p_organization_id
        and consent_record.stall_id = p_stall_id
    ), '[]'::jsonb),
    'loyalty_accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'account_id', account.id,
        'status', account.status,
        'opened_at', account.opened_at,
        'closed_at', account.closed_at,
        'balance', coalesce((
          select sum(ledger.points_delta)
          from public.loyalty_points_ledger ledger
          where ledger.account_id = account.id
        ), 0),
        'ledger', coalesce((
          select jsonb_agg(jsonb_build_object(
            'ledger_id', ledger.id,
            'entry_type', ledger.entry_type,
            'points_delta', ledger.points_delta,
            'order_id', ledger.order_id,
            'source_event_type', ledger.source_event_type,
            'reversal_of_ledger_id', ledger.reversal_of_ledger_id,
            'expires_at', ledger.expires_at,
            'created_at', ledger.created_at
          ) order by ledger.created_at, ledger.id)
          from public.loyalty_points_ledger ledger
          where ledger.account_id = account.id
        ), '[]'::jsonb)
      ) order by account.opened_at, account.id)
      from public.loyalty_accounts account
      where account.profile_id = p_profile_id
        and account.organization_id = p_organization_id
        and account.stall_id = p_stall_id
    ), '[]'::jsonb)
  ) into v_payload;

  perform app_private.record_crm_loyalty_audit(
    p_organization_id, p_stall_id, null,
    'CRM_DATA_EXPORTED', 'CRM_PROFILE', p_profile_id,
    'SUCCESS'::public.audit_outcome, p_request_id,
    jsonb_build_object('format', 'JSON', 'minimum_disclosure', true)
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'CRM_EXPORT_READY',
    'data', v_payload
  );
end;
$$;

create function public.erase_crm_loyalty_profile(
  p_organization_id uuid,
  p_stall_id uuid,
  p_profile_id uuid,
  p_subject_hash text,
  p_reason text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_tombstone_id uuid;
begin
  if not app_private.crm_loyalty_foundation_enabled(
    p_organization_id,
    p_stall_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'CRM_LOYALTY_DISABLED');
  end if;

  if p_subject_hash is null
    or p_subject_hash !~ '^[a-f0-9]{64}$'
    or char_length(btrim(coalesce(p_reason, ''))) not between 1 and 300
    or char_length(btrim(coalesce(p_request_id, ''))) not between 1 and 100 then
    return jsonb_build_object('ok', false, 'code', 'CRM_ERASURE_INPUT_INVALID');
  end if;

  perform 1
  from public.crm_profiles profile
  where profile.id = p_profile_id
    and profile.organization_id = p_organization_id
    and profile.stall_id = p_stall_id
    and profile.status <> 'ERASED'
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'CRM_PROFILE_NOT_FOUND');
  end if;

  insert into public.crm_erasure_tombstones (
    organization_id, stall_id, erased_profile_id, subject_hash,
    erasure_reason, erased_at, audit_retention_expires_at,
    request_id
  ) values (
    p_organization_id, p_stall_id, p_profile_id, p_subject_hash,
    btrim(p_reason), v_now, v_now + interval '2190 days',
    left(p_request_id, 100)
  )
  returning id into v_tombstone_id;

  update public.loyalty_accounts
  set status = 'CLOSED'::public.loyalty_account_status,
      closed_at = coalesce(closed_at, v_now),
      updated_at = v_now
  where organization_id = p_organization_id
    and stall_id = p_stall_id
    and profile_id = p_profile_id
    and status = 'ACTIVE';

  update public.crm_profiles
  set contact_identifier_hash = null,
      contact_reference = null,
      contact_type = null,
      contact_verified_at = null,
      status = 'ERASED'::public.crm_profile_status,
      marketing_suppressed_at = coalesce(marketing_suppressed_at, v_now),
      erased_at = v_now,
      updated_at = v_now
  where id = p_profile_id
    and organization_id = p_organization_id
    and stall_id = p_stall_id;

  perform app_private.record_crm_loyalty_audit(
    p_organization_id, p_stall_id, null,
    'CRM_PROFILE_ERASED', 'CRM_PROFILE', p_profile_id,
    'SUCCESS'::public.audit_outcome, p_request_id,
    jsonb_build_object(
      'tombstone_id', v_tombstone_id,
      'contact_reference_removed', true,
      'ledger_retained', true
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'CRM_PROFILE_ERASED',
    'profile_id', p_profile_id,
    'tombstone_id', v_tombstone_id,
    'erased_at', v_now
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'CRM_ERASURE_ALREADY_RECORDED');
end;
$$;

alter table public.crm_profiles enable row level security;
alter table public.crm_profiles force row level security;
alter table public.crm_consent_records enable row level security;
alter table public.crm_consent_records force row level security;
alter table public.loyalty_accounts enable row level security;
alter table public.loyalty_accounts force row level security;
alter table public.loyalty_points_ledger enable row level security;
alter table public.loyalty_points_ledger force row level security;
alter table public.crm_erasure_tombstones enable row level security;
alter table public.crm_erasure_tombstones force row level security;

create policy crm_profiles_manager_select
on public.crm_profiles
for select to authenticated
using (app_private.has_stall_role(
  stall_id,
  array['MERCHANT_OWNER', 'MERCHANT_MANAGER']::public.user_role[]
));

create policy crm_consent_records_manager_select
on public.crm_consent_records
for select to authenticated
using (app_private.has_stall_role(
  stall_id,
  array['MERCHANT_OWNER', 'MERCHANT_MANAGER']::public.user_role[]
));

create policy loyalty_accounts_manager_select
on public.loyalty_accounts
for select to authenticated
using (app_private.has_stall_role(
  stall_id,
  array['MERCHANT_OWNER', 'MERCHANT_MANAGER']::public.user_role[]
));

create policy loyalty_points_ledger_manager_select
on public.loyalty_points_ledger
for select to authenticated
using (app_private.has_stall_role(
  stall_id,
  array['MERCHANT_OWNER', 'MERCHANT_MANAGER']::public.user_role[]
));

create policy crm_erasure_tombstones_manager_select
on public.crm_erasure_tombstones
for select to authenticated
using (app_private.has_stall_role(
  stall_id,
  array['MERCHANT_OWNER', 'MERCHANT_MANAGER']::public.user_role[]
));

revoke all on table public.crm_profiles
from public, anon, authenticated, service_role;
revoke all on table public.crm_consent_records
from public, anon, authenticated, service_role;
revoke all on table public.loyalty_accounts
from public, anon, authenticated, service_role;
revoke all on table public.loyalty_points_ledger
from public, anon, authenticated, service_role;
revoke all on table public.crm_erasure_tombstones
from public, anon, authenticated, service_role;

grant select (
  id, organization_id, stall_id, status, marketing_suppressed_at,
  erased_at, retention_expires_at, created_at, updated_at
) on table public.crm_profiles to authenticated;
grant select (
  id, organization_id, stall_id, profile_id, purpose_code, notice_version,
  consent_source, lawful_basis, decision, captured_at, withdrawn_at,
  withdrawal_source, withdrawal_reason, retention_expires_at, created_at
) on table public.crm_consent_records to authenticated;
grant select (
  id, organization_id, stall_id, profile_id, status,
  opened_at, closed_at, created_at, updated_at
) on table public.loyalty_accounts to authenticated;
grant select (
  id, organization_id, stall_id, account_id, entry_type, points_delta,
  order_id, source_event_type, reversal_of_ledger_id, expires_at, created_at
) on table public.loyalty_points_ledger to authenticated;

grant select on table public.crm_profiles to service_role;
grant select on table public.crm_consent_records to service_role;
grant select on table public.loyalty_accounts to service_role;
grant select on table public.loyalty_points_ledger to service_role;
grant select on table public.crm_erasure_tombstones to service_role;

revoke all on function app_private.crm_loyalty_foundation_enabled(uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function app_private.record_crm_loyalty_audit(
  uuid, uuid, uuid, text, text, uuid, public.audit_outcome, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function app_private.touch_crm_loyalty_updated_at()
from public, anon, authenticated, service_role;
revoke all on function app_private.reject_crm_consent_mutation()
from public, anon, authenticated, service_role;
revoke all on function app_private.reject_loyalty_ledger_mutation()
from public, anon, authenticated, service_role;
revoke all on function app_private.loyalty_event_payload_matches(
  public.loyalty_points_ledger, uuid, text, integer, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function app_private.reject_crm_erasure_tombstone_mutation()
from public, anon, authenticated, service_role;

revoke all on function public.opt_in_crm_loyalty_profile(
  uuid, uuid, text, text, text, timestamptz,
  text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.opt_in_crm_loyalty_profile(
  uuid, uuid, text, text, text, timestamptz,
  text, text, text, text, text, text
) to service_role;

revoke all on function public.withdraw_crm_consent(
  uuid, uuid, uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.withdraw_crm_consent(
  uuid, uuid, uuid, text, text, text, text
) to service_role;

revoke all on function public.unsubscribe_crm_profile(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.unsubscribe_crm_profile(
  uuid, uuid, uuid, text, text
) to service_role;

revoke all on function public.post_loyalty_points_event(
  uuid, uuid, uuid, text, integer, uuid, text, text, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.post_loyalty_points_event(
  uuid, uuid, uuid, text, integer, uuid, text, text, uuid, uuid, text
) to service_role;

revoke all on function public.export_crm_loyalty_profile(
  uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.export_crm_loyalty_profile(
  uuid, uuid, uuid, text
) to service_role;

revoke all on function public.erase_crm_loyalty_profile(
  uuid, uuid, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.erase_crm_loyalty_profile(
  uuid, uuid, uuid, text, text, text
) to service_role;

comment on table public.crm_profiles is
  'Consent-created CRM profiles only. Clear contact identifiers and order-contact imports are prohibited.';
comment on table public.crm_consent_records is
  'Append-only, granular consent and withdrawal evidence. Retention is provisional pending Legal approval.';
comment on table public.loyalty_accounts is
  'Consent-governed loyalty membership. Balance is never stored here and converges from the immutable ledger.';
comment on table public.loyalty_points_ledger is
  'Immutable EARN/ADJUST/EXPIRE/REVERSE entries with source-event idempotency; point deltas are not recomputed from orders.';
comment on table public.crm_erasure_tombstones is
  'Minimum immutable proof of erasure. Does not contain the contact identifier or encrypted contact reference.';
comment on function public.opt_in_crm_loyalty_profile(
  uuid, uuid, text, text, text, timestamptz,
  text, text, text, text, text, text
) is
  'The only runtime profile-creation contract; requires explicit opt-in and a verified opaque contact reference.';
