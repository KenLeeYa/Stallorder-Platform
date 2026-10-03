-- Legacy execution remains disabled outside guarded local Mock; historical intent is never backfilled.
alter table public.notification_jobs add column legacy_intent_json jsonb;
alter table public.notification_jobs drop constraint notification_jobs_outcome_check;
alter table public.notification_jobs add constraint notification_jobs_outcome_check check (
  outcome in ('QUEUED','IN_FLIGHT','RETRY_SCHEDULED','PROVIDER_ACCEPTED','SUPPRESSED','FAILED','MANUAL_REVIEW','QUOTA_BLOCKED','SIMULATED'));
alter table public.notification_jobs add constraint notification_jobs_simulated_legacy_check check (
  outcome <> 'SIMULATED' or delivery_mode = 'LEGACY');
alter table public.notification_jobs add constraint notification_jobs_legacy_execution_check check (
  legacy_intent_json is null or coalesce((
    delivery_mode='LEGACY' and jsonb_typeof(legacy_intent_json)='object'
    and legacy_intent_json->>'version'='1'
    and legacy_intent_json->>'purpose' in ('COMMERCE','LOCAL_MOCK_TEST')
    and attempt_count between 0 and 5
    and retry_key is not null and recipient_identity_hash is not null
    and ((snapshot_ciphertext is null and payload_hash is null and first_request_at is null)
      or (snapshot_ciphertext is not null and payload_hash ~ '^[0-9a-f]{64}$'))
    and ((lease_token is null and lease_expires_at is null)
      or (lease_token is not null and lease_expires_at is not null and status='PROCESSING'))
    and (outcome<>'IN_FLIGHT' or (status='PROCESSING' and lease_token is not null and first_request_at is not null))
    and (outcome not in ('PROVIDER_ACCEPTED','SIMULATED') or status='SENT')
    and (outcome<>'MANUAL_REVIEW' or (status='FAILED' and next_attempt_at is null))
  ),false));

create function app_private.capture_legacy_notification_intent() returns trigger
language plpgsql security invoker set search_path='' as $$
declare
  i public.notification_integrations%rowtype;
  l public.customer_contact_links%rowtype;
  o public.orders%rowtype;
  purpose text;
begin
  if tg_op='UPDATE' then
    if old.delivery_mode<>'LEGACY' then return new; end if;
    if (old.id,old.organization_id,old.stall_id,old.order_id,old.integration_id,old.contact_link_id,
        old.provider,old.recipient_reference,old.template_code,old.event_version,old.delivery_mode,
        old.environment,old.recipient_identity_hash,old.retry_key,old.template_version,old.legacy_intent_json)
      is distinct from
       (new.id,new.organization_id,new.stall_id,new.order_id,new.integration_id,new.contact_link_id,
        new.provider,new.recipient_reference,new.template_code,new.event_version,new.delivery_mode,
        new.environment,new.recipient_identity_hash,new.retry_key,new.template_version,new.legacy_intent_json)
    then raise exception 'LEGACY_NOTIFICATION_INTENT_IMMUTABLE'; end if;
    if old.snapshot_ciphertext is not null and
      (old.snapshot_ciphertext,old.payload_hash) is distinct from (new.snapshot_ciphertext,new.payload_hash)
    then raise exception 'LEGACY_NOTIFICATION_SNAPSHOT_IMMUTABLE'; end if;
    if old.first_request_at is not null and old.first_request_at is distinct from new.first_request_at
    then raise exception 'LEGACY_NOTIFICATION_FIRST_REQUEST_IMMUTABLE'; end if;
    if new.attempt_count < old.attempt_count then raise exception 'LEGACY_NOTIFICATION_ATTEMPT_REWIND'; end if;
    return new;
  end if;
  if new.delivery_mode<>'LEGACY' then return new; end if;
  if exists(select 1 from public.line_platform_order_owners where order_id=new.order_id) then return null; end if;
  select * into i from public.notification_integrations where id=new.integration_id;
  select * into l from public.customer_contact_links where id=new.contact_link_id;
  select * into o from public.orders where id=new.order_id;
  if i.id is null or l.id is null or o.id is null or i.sender_scope<>'LEGACY'
    or i.organization_id is distinct from new.organization_id or i.stall_id is distinct from new.stall_id
    or l.integration_id is distinct from i.id or l.customer_reference_id is distinct from o.id
    or l.organization_id is distinct from new.organization_id
    or l.stall_id is distinct from new.stall_id
    or l.provider_user_secret_reference is distinct from new.recipient_reference
    or o.organization_id is distinct from new.organization_id or o.stall_id is distinct from new.stall_id
    or new.provider<>'LINE' or i.provider<>new.provider or l.provider<>new.provider
  then raise exception 'LEGACY_NOTIFICATION_SCOPE_MISMATCH'; end if;
  purpose:=coalesce(new.legacy_intent_json->>'purpose','COMMERCE');
  if purpose not in ('COMMERCE','LOCAL_MOCK_TEST') then raise exception 'LEGACY_NOTIFICATION_PURPOSE_INVALID'; end if;
  if purpose='LOCAL_MOCK_TEST' and (
    i.environment='local' and i.settings_json->'webhookManagement'->>'localMock'='true' and o.is_test) is distinct from true
  then raise exception 'LEGACY_NOTIFICATION_MOCK_PURPOSE_DENIED'; end if;
  if purpose='COMMERCE' and (o.is_test or o.origin in ('TEST','SYSTEM_CANARY')) then return null; end if;
  new.retry_key:=new.id;
  new.environment:=i.environment;
  new.recipient_identity_hash:=l.provider_user_id_hash;
  new.legacy_intent_json:=jsonb_build_object(
    'version',1,'purpose',purpose,'organizationId',new.organization_id,'stallId',new.stall_id,
    'orderId',new.order_id,'integrationId',new.integration_id,'contactLinkId',new.contact_link_id,
    'recipientReference',new.recipient_reference,'recipientHash',l.provider_user_id_hash,
    'providerId',i.provider_id,'environment',i.environment,'destination',i.oa_destination,
    'secretRevision',i.secret_reference,'loginChannelId',i.public_identifier,
    'messagingChannelId',i.settings_json->'webhookManagement'->>'messagingChannelId',
    'policy',coalesce(i.settings_json->'webhookManagement'->>'senderPolicy','MERCHANT_OA'),
    'notifyConfirmed',coalesce(i.settings_json->'notifyConfirmed','true'::jsonb),
    'notifyReady',coalesce(i.settings_json->'notifyReady','true'::jsonb),
    'notifyCancelled',coalesce(i.settings_json->'notifyCancelled','true'::jsonb),
    'templateVersion',new.template_version);
  return new;
end $$;
revoke all on function app_private.capture_legacy_notification_intent() from public,anon,authenticated;
create trigger notification_jobs_legacy_intent_before_write before insert or update on public.notification_jobs
for each row execute function app_private.capture_legacy_notification_intent();
