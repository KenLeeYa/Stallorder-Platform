-- Expansion only; no remote setup, policy approval or business-data rewrite.
alter table public.privacy_requests add column execution_evidence text;
create table public.privacy_exports (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, request_id uuid not null,
  content_ciphertext text not null, content_sha256 text not null check(content_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(), expires_at timestamptz not null,
  revoked_at timestamptz, downloaded_at timestamptz,
  foreign key(request_id, organization_id) references public.privacy_requests(id, organization_id) on delete restrict,
  check(expires_at > created_at and expires_at <= created_at + interval '15 minutes')
);
create index privacy_exports_request_idx on public.privacy_exports(organization_id, request_id, created_at desc);
alter table public.privacy_exports enable row level security;
alter table public.privacy_exports force row level security;
revoke all on public.privacy_exports from public, anon, authenticated, service_role;
grant select, insert, update on public.privacy_exports to service_role;
create policy governance_scope on public.privacy_exports for all to service_role
  using(organization_id = nullif(current_setting('app.compliance_organization_id', true), '')::uuid)
  with check(organization_id = nullif(current_setting('app.compliance_organization_id', true), '')::uuid);
create trigger governance_writer before insert or update on public.privacy_exports
  for each row execute function app_private.guard_governance_write();
alter table public.privacy_deletion_tasks add column result_evidence text;
alter table public.privacy_deletion_tasks add column plan_digest text;
alter table public.privacy_deletion_tasks drop constraint privacy_deletion_tasks_target_check;
alter table public.privacy_deletion_tasks add constraint privacy_deletion_tasks_target_check
  check(target in ('DATABASE_CONTACT','PRINT_PAYLOAD','STORAGE','CACHE','SEARCH','NOTIFICATIONS','EXPORTS','ANALYTICS','VENDOR'));
-- History is append-only. Delivery is a separate event, never an edit to old evidence.
create trigger privacy_event_immutable before update or delete on public.privacy_request_events
  for each row execute function app_private.reject_governance_evidence_mutation();
revoke update on public.privacy_request_events from service_role;
