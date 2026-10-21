-- Expand only. No business backfill/seed, provider writes or DR promotion.
-- New runtime routes are OFF until reviewed policy, keys, role and QA gates pass.
create table public.privacy_policy_versions (
  version text primary key check (char_length(version) between 1 and 80),
  document_sha256 text not null check (document_sha256 ~ '^[a-f0-9]{64}$'),
  notice_text text not null check (char_length(notice_text) between 1 and 50000),
  lawful_basis text not null,
  approved_by uuid references public.profiles(id) on delete restrict,
  effective_at timestamptz,
  created_at timestamptz not null default now(),
  check ((approved_by is null) = (effective_at is null))
);

create table public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  stall_id uuid,
  order_id uuid,
  subject_profile_id uuid references public.profiles(id) on delete restrict,
  receipt_hash text not null unique check (receipt_hash ~ '^[a-f0-9]{64}$'),
  operation_id uuid not null,
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  request_type text not null check (request_type in ('ACCESS','COPY','CORRECT','STOP','DELETE','MARKETING_STOP','COMPLAINT')),
  status text not null default 'RECEIVED' check (status in ('RECEIVED','VERIFYING','REVIEWING','APPROVED','REJECTED','EXECUTING','COMPLETED')),
  policy_version text not null references public.privacy_policy_versions(version) on delete restrict,
  details_ciphertext text not null,
  received_at timestamptz not null default now(),
  due_at timestamptz not null,
  verified_at timestamptz,
  decision_ciphertext text,
  decision_at timestamptz,
  extension_days integer not null default 0,
  extension_reason_ciphertext text,
  extension_notified_at timestamptz,
  extension_delivery_evidence text,
  version integer not null default 1,
  unique (id, organization_id),
  unique (organization_id, operation_id),
  foreign key (stall_id, organization_id) references public.stalls(id, organization_id) on delete restrict,
  foreign key (order_id, organization_id, stall_id) references public.orders(id, organization_id, stall_id) on delete restrict,
  check ((order_id is not null and stall_id is not null) or subject_profile_id is not null),
  check (due_at > received_at),
  check (extension_days >= 0 and extension_days <= case when request_type in ('ACCESS','COPY') then 15 when request_type = 'COMPLAINT' then 0 else 30 end),
  check (extension_days = 0 or (extension_reason_ciphertext is not null and extension_notified_at is not null and extension_delivery_evidence is not null))
);
create index privacy_requests_workbench_idx on public.privacy_requests(organization_id, status, due_at, id);
create index privacy_requests_subject_idx on public.privacy_requests(subject_profile_id, received_at desc);

create table public.privacy_request_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  request_id uuid not null,
  event_type text not null,
  actor_profile_id uuid references public.profiles(id) on delete restrict,
  message_ciphertext text,
  occurred_at timestamptz not null default now(),
  delivered_at timestamptz,
  foreign key(request_id, organization_id) references public.privacy_requests(id, organization_id) on delete restrict
);
create index privacy_request_events_order_idx on public.privacy_request_events(request_id, occurred_at, id);

create table public.retention_policy_versions (
  id uuid primary key default gen_random_uuid(),
  data_class text not null check (data_class in ('CUSTOMER_CONTACT','SECURITY_EVIDENCE','ACCOUNTING_VOUCHER','ACCOUNTING_BOOK','EXPORT','PRINT_PAYLOAD','DEBUG_LOG')),
  version text not null,
  start_event text not null check (start_event in ('PURPOSE_ENDED','ANNUAL_CLOSE','CREATED')),
  retain_days integer not null check (retain_days between 1 and 36525),
  legal_basis text not null,
  approved_by uuid references public.profiles(id) on delete restrict,
  approved_at timestamptz,
  effective_at timestamptz,
  unique(data_class, version),
  check ((approved_by is null) = (approved_at is null))
);
create table public.privacy_legal_holds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  order_id uuid,
  stall_id uuid,
  data_classes text[] not null check (cardinality(data_classes) > 0),
  reason_ciphertext text not null,
  approved_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  review_at timestamptz not null,
  expires_at timestamptz not null,
  released_at timestamptz,
  released_by uuid references public.profiles(id) on delete restrict,
  release_reason_ciphertext text,
  foreign key(order_id, organization_id, stall_id) references public.orders(id, organization_id, stall_id) on delete restrict,
  check (expires_at > created_at and review_at <= expires_at),
  check (order_id is null or stall_id is not null),
  check (released_at is null or (released_by is not null and release_reason_ciphertext is not null))
);
create index privacy_legal_holds_scope_idx on public.privacy_legal_holds(organization_id, order_id, expires_at);

create table public.privacy_deletion_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  request_id uuid not null,
  target text not null check (target in ('DATABASE_CONTACT','STORAGE','CACHE','SEARCH','NOTIFICATIONS','EXPORTS','ANALYTICS','VENDOR')),
  status text not null default 'DRY_RUN' check (status in ('DRY_RUN','PENDING','RUNNING','COMPLETED','BLOCKED','RETRY')),
  attempt integer not null default 0 check (attempt >= 0),
  next_attempt_at timestamptz,
  error_code text,
  completed_at timestamptz,
  foreign key(request_id, organization_id) references public.privacy_requests(id, organization_id) on delete restrict,
  unique(request_id, target),
  check ((status = 'COMPLETED') = (completed_at is not null))
);
create table public.privacy_deletion_tombstones (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  request_id uuid not null,
  subject_hash text not null check (subject_hash ~ '^[a-f0-9]{64}$'),
  target text not null,
  policy_version text not null,
  deleted_at timestamptz not null default now(),
  foreign key(request_id, organization_id) references public.privacy_requests(id, organization_id) on delete restrict,
  unique(request_id, target)
);

create table public.security_step_up_grants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.auth_sessions(id) on delete cascade,
  action text not null,
  content_digest text not null check (content_digest ~ '^[a-f0-9]{64}$'),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  assurance text not null check (assurance = 'aal2'),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (expires_at > issued_at and expires_at <= issued_at + interval '5 minutes')
);
create table public.security_support_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  approved_by uuid not null references public.profiles(id) on delete restrict,
  purpose text not null check (char_length(purpose) between 3 and 300),
  scope text not null default 'PRIVACY_STATUS_READ' check (scope = 'PRIVACY_STATUS_READ'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (actor_profile_id <> approved_by),
  check (expires_at > created_at and expires_at <= created_at + interval '1 hour')
);
create index security_support_grants_active_idx on public.security_support_grants(organization_id, actor_profile_id, expires_at);

create table public.security_incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  state text not null default 'DETECTED' check(state in ('DETECTED','TRIAGED','CONTAINING','INVESTIGATING','RECOVERING','CLOSED')),
  awareness_at timestamptz not null,
  facts_ciphertext text not null,
  owner_profile_id uuid references public.profiles(id) on delete restrict,
  digital_industry_applicable boolean,
  normal_operations_at_risk boolean,
  large_subject_impact boolean,
  notification_due_at timestamptz,
  notification_status text not null default 'ASSESSING' check(notification_status in ('ASSESSING','DRAFT','SUBMITTED','NOT_REQUIRED')),
  submission_evidence text,
  affected_count integer check(affected_count >= 0),
  count_confidence text not null default 'UNKNOWN' check(count_confidence in ('UNKNOWN','ESTIMATE','VERIFIED')),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  check (notification_status <> 'SUBMITTED' or submission_evidence is not null)
);
create index security_incidents_due_idx on public.security_incidents(organization_id, state, notification_due_at);

-- Preserve the existing audit domain. New writes use this outbox in the SAME transaction.
create table public.audit_archive_outbox (
  sequence bigint generated always as identity primary key,
  audit_id uuid not null unique references public.audit_logs(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  event_digest text not null check(event_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  archive_receipt text
);
create index audit_archive_outbox_pending_idx on public.audit_archive_outbox(sequence) where archived_at is null;

create function app_private.reject_governance_evidence_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'GOVERNANCE_EVIDENCE_IMMUTABLE' using errcode = '42501';
end $$;
revoke all on function app_private.reject_governance_evidence_mutation() from public, anon, authenticated, service_role;
create trigger privacy_policy_immutable before update or delete on public.privacy_policy_versions
for each row execute function app_private.reject_governance_evidence_mutation();
create trigger retention_policy_immutable before update or delete on public.retention_policy_versions
for each row execute function app_private.reject_governance_evidence_mutation();
create trigger privacy_tombstone_immutable before update or delete on public.privacy_deletion_tombstones
for each row execute function app_private.reject_governance_evidence_mutation();

create function app_private.guard_governance_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform app_private.assert_backend_writable();
  return new;
end $$;
revoke all on function app_private.guard_governance_write() from public, anon, authenticated, service_role;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'privacy_requests','privacy_request_events','privacy_legal_holds','privacy_deletion_tasks',
    'privacy_deletion_tombstones','security_support_grants','security_incidents','audit_archive_outbox'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', table_name);
    execute format('grant select, insert, update on public.%I to service_role', table_name);
    execute format('create policy governance_scope on public.%I for all to service_role using (organization_id = nullif(current_setting(''app.compliance_organization_id'', true), '''')::uuid) with check (organization_id = nullif(current_setting(''app.compliance_organization_id'', true), '''')::uuid)', table_name);
    execute format('create trigger governance_writer before insert or update on public.%I for each row execute function app_private.guard_governance_write()', table_name);
  end loop;
  foreach table_name in array array['privacy_policy_versions','retention_policy_versions','security_step_up_grants'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', table_name);
    execute format('create trigger governance_writer before insert or update on public.%I for each row execute function app_private.guard_governance_write()', table_name);
  end loop;
end $$;
grant select on public.privacy_policy_versions, public.retention_policy_versions to service_role;
grant select, insert, update on public.security_step_up_grants to service_role;
revoke update on public.privacy_deletion_tombstones from service_role;
grant usage, select on sequence public.audit_archive_outbox_sequence_seq to service_role;
-- service_role has BYPASSRLS on Supabase. Runtime-role readback and a non-BYPASSRLS
-- connection remain a release gate; this policy alone does NOT prove tenant isolation.
