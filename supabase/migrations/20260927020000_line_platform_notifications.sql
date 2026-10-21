-- Platform OA reuses notification_jobs. Legacy delivery evidence is never reassigned.
alter table public.notification_integrations
  alter column organization_id drop not null,
  add column sender_scope text not null default 'LEGACY',
  add column environment text,
  add column provider_id text,
  add column oa_destination text,
  add column quota_limit integer,
  add column quota_usage integer,
  add column quota_checked_at timestamptz,
  add column paused_until timestamptz,
  add column last_dispatch_at timestamptz,
  drop constraint notification_integrations_active_check,
  add constraint notification_integrations_scope_check check (
    (sender_scope='LEGACY' and organization_id is not null)
    or (sender_scope='PLATFORM_OA' and provider='LINE' and organization_id is null and stall_id is null
      and environment in ('local','preview','production') and provider_id is not null and oa_destination is not null)),
  add constraint notification_integrations_active_check check (
    status<>'ACTIVE' or (public_identifier is not null and secret_reference is not null
      and (stall_id is not null or sender_scope='PLATFORM_OA')));
create unique index line_platform_one_sender on public.notification_integrations(environment) where sender_scope='PLATFORM_OA';

alter table public.notification_jobs
  add column delivery_mode text not null default 'LEGACY' check(delivery_mode in ('LEGACY','PLATFORM_OA')),
  add column environment text,
  add column recipient_identity_hash text,
  add column template_version integer not null default 1,
  add column snapshot_ciphertext text,
  add column payload_hash text,
  add column retry_key uuid,
  add column first_request_at timestamptz,
  add column lease_token uuid,
  add column lease_expires_at timestamptz,
  add column outcome text not null default 'QUEUED' check(outcome in ('QUEUED','IN_FLIGHT','RETRY_SCHEDULED','PROVIDER_ACCEPTED','SUPPRESSED','FAILED','MANUAL_REVIEW','QUOTA_BLOCKED')),
  add column provider_accepted_request_id text,
  add column manual_retry_count integer not null default 0 check(manual_retry_count between 0 and 3),
  add column last_manual_retry_at timestamptz,
  drop constraint notification_jobs_template_check,
  add constraint notification_jobs_template_check check(template_code in ('ORDER_CONFIRMED','ORDER_READY','ORDER_CANCELLED','FULFILLMENT_TIME_PROPOSED','ORDER_RECEIPT_AVAILABLE','ORDER_PICKED_UP')),
  add constraint platform_notification_snapshot_check check (
    delivery_mode='LEGACY' or (environment is not null and recipient_identity_hash is not null and retry_key is not null
      and ((snapshot_ciphertext is null and payload_hash is null and first_request_at is null)
        or (snapshot_ciphertext is not null and payload_hash ~ '^[0-9a-f]{64}$' and first_request_at is not null))));
create unique index notification_jobs_platform_unique on public.notification_jobs(environment,integration_id,order_id,template_code,event_version,recipient_identity_hash) where delivery_mode='PLATFORM_OA';
create index notification_jobs_platform_due on public.notification_jobs(environment,outcome,next_attempt_at,stall_id) where delivery_mode='PLATFORM_OA';

alter table public.line_webhook_events alter column organization_id drop not null, alter column stall_id drop not null,
  add column provider_event_id text,
  add column event_timestamp timestamptz,
  add column subject_hash text,
  add column environment text,
  add column processing_error text;
create table public.line_platform_friendships (
  environment text not null,
  integration_id uuid not null references public.notification_integrations(id),
  provider_id text not null,
  subject_hash text not null check(subject_hash ~ '^[0-9a-f]{64}$'),
  status text not null check(status in ('UNKNOWN','FRIEND','NOT_FRIEND_OR_BLOCKED')),
  observed_at timestamptz not null,
  event_id text not null,
  source text not null check(source in ('SIGNED_WEBHOOK','VERIFIED_API')),
  primary key(environment,integration_id,subject_hash)
);
alter table public.line_platform_friendships enable row level security;
alter table public.line_platform_friendships force row level security;
revoke all on public.line_platform_friendships from public,anon,authenticated;
grant select,insert,update on public.line_platform_friendships to service_role;

create or replace function public.enforce_notification_scope() returns trigger language plpgsql security definer set search_path='' as $$
declare v_integration public.notification_integrations%rowtype; v_link public.customer_contact_links%rowtype; v_order_id uuid;
begin
  if new.stall_id is not null and not exists(select 1 from public.stalls where id=new.stall_id and organization_id=new.organization_id) then
    raise exception 'NOTIFICATION_STALL_SCOPE_MISMATCH';
  end if;
  if tg_table_name='notification_integrations' then
    if tg_op='UPDATE' and (old.sender_scope,old.environment,old.provider_id,old.oa_destination,old.public_identifier)
      is distinct from (new.sender_scope,new.environment,new.provider_id,new.oa_destination,new.public_identifier)
      and old.sender_scope='PLATFORM_OA' then raise exception 'PLATFORM_SENDER_IMMUTABLE'; end if;
    return new;
  end if;
  select * into v_integration from public.notification_integrations where id=new.integration_id;
  if not found or v_integration.provider<>new.provider then raise exception 'NOTIFICATION_INTEGRATION_SCOPE_MISMATCH'; end if;
  if v_integration.sender_scope='LEGACY' and (v_integration.organization_id is distinct from new.organization_id or v_integration.stall_id is distinct from new.stall_id) then
    raise exception 'NOTIFICATION_INTEGRATION_SCOPE_MISMATCH';
  end if;
  if tg_table_name='customer_contact_links' then
    v_order_id:=new.customer_reference_id;
    if v_integration.sender_scope='LEGACY' and exists(select 1 from public.line_platform_order_owners where order_id=v_order_id) then raise exception 'PLATFORM_LEGACY_LINK_FORBIDDEN'; end if;
    if tg_op='UPDATE' and exists(select 1 from public.line_platform_order_owners where order_id=old.customer_reference_id)
      and (old.integration_id,old.provider_user_id_hash,old.provider_user_secret_reference,old.customer_reference_id)
      is distinct from (new.integration_id,new.provider_user_id_hash,new.provider_user_secret_reference,new.customer_reference_id) then
      raise exception 'PLATFORM_RECIPIENT_IMMUTABLE';
    end if;
  elsif tg_table_name='notification_jobs' then
    v_order_id:=new.order_id;
    if tg_op='INSERT' and new.delivery_mode='LEGACY' and exists(select 1 from public.line_platform_order_owners where order_id=new.order_id) then return null; end if;
    select * into v_link from public.customer_contact_links where id=new.contact_link_id;
    if not found or v_link.integration_id<>new.integration_id or v_link.customer_reference_id is distinct from new.order_id
      or v_link.organization_id<>new.organization_id or v_link.stall_id<>new.stall_id then raise exception 'NOTIFICATION_CONTACT_SCOPE_MISMATCH'; end if;
    if (tg_op='INSERT' or new.delivery_mode='PLATFORM_OA') and v_link.provider_user_secret_reference is distinct from new.recipient_reference then raise exception 'NOTIFICATION_CONTACT_SCOPE_MISMATCH'; end if;
    if new.delivery_mode='PLATFORM_OA' and (v_integration.sender_scope<>'PLATFORM_OA' or new.environment<>v_integration.environment or new.recipient_identity_hash<>v_link.provider_user_id_hash) then raise exception 'PLATFORM_SENDER_SCOPE_MISMATCH'; end if;
    if tg_op='UPDATE' and old.delivery_mode='PLATFORM_OA' then
      if (old.order_id,old.integration_id,old.contact_link_id,old.recipient_reference,old.environment,old.recipient_identity_hash,old.template_code,old.event_version,old.retry_key,old.template_version,old.delivery_mode)
        is distinct from (new.order_id,new.integration_id,new.contact_link_id,new.recipient_reference,new.environment,new.recipient_identity_hash,new.template_code,new.event_version,new.retry_key,new.template_version,new.delivery_mode)
        then raise exception 'PLATFORM_NOTIFICATION_IDENTITY_IMMUTABLE'; end if;
      if old.first_request_at is not null and (old.snapshot_ciphertext,old.payload_hash,old.first_request_at) is distinct from (new.snapshot_ciphertext,new.payload_hash,new.first_request_at)
        then raise exception 'PLATFORM_NOTIFICATION_SNAPSHOT_IMMUTABLE'; end if;
    end if;
  end if;
  if v_order_id is not null and not exists(select 1 from public.orders where id=v_order_id and organization_id=new.organization_id and stall_id=new.stall_id) then raise exception 'NOTIFICATION_ORDER_SCOPE_MISMATCH'; end if;
  if v_integration.sender_scope='PLATFORM_OA' and not exists(select 1 from public.line_platform_order_owners owner
    where owner.order_id=v_order_id and owner.environment=v_integration.environment and owner.provider_id=v_integration.provider_id) then raise exception 'PLATFORM_OWNER_SCOPE_MISMATCH'; end if;
  return new;
end $$;

create or replace function public.enforce_line_notification_scope() returns trigger language plpgsql security definer set search_path='' as $$
declare v_integration public.notification_integrations%rowtype;
begin
  select * into v_integration from public.notification_integrations where id=new.integration_id;
  if not found or v_integration.provider<>'LINE' then raise exception 'LINE_INTEGRATION_SCOPE_MISMATCH'; end if;
  if v_integration.sender_scope='PLATFORM_OA' then
    if tg_table_name<>'line_webhook_events' then raise exception 'PLATFORM_LEGACY_LINK_FORBIDDEN'; end if;
    if new.organization_id is not null or new.stall_id is not null or new.environment<>v_integration.environment then raise exception 'LINE_INTEGRATION_SCOPE_MISMATCH'; end if;
  elsif v_integration.organization_id is distinct from new.organization_id or v_integration.stall_id is distinct from new.stall_id then raise exception 'LINE_INTEGRATION_SCOPE_MISMATCH'; end if;
  if tg_table_name='line_link_sessions' then
    if not exists(select 1 from public.orders where id=new.order_id and organization_id=new.organization_id and stall_id=new.stall_id)
      or exists(select 1 from public.line_platform_order_owners where order_id=new.order_id) then raise exception 'LINE_ORDER_SCOPE_MISMATCH'; end if;
  end if;
  return new;
end $$;

create or replace function public.enqueue_line_platform_notification(p_order_id uuid,p_event text,p_version integer default 0)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_event not in ('ORDER_RECEIPT_AVAILABLE','ORDER_READY','ORDER_PICKED_UP','ORDER_CANCELLED') then raise exception 'PLATFORM_EVENT_INVALID'; end if;
  insert into public.notification_jobs(organization_id,stall_id,integration_id,contact_link_id,order_id,provider,template_code,event_version,recipient_reference,
    delivery_mode,environment,recipient_identity_hash,retry_key,status,outcome,next_attempt_at,last_error_code)
  select o.organization_id,o.stall_id,i.id,l.id,o.id,'LINE',p_event,p_version,l.provider_user_secret_reference,'PLATFORM_OA',owner.environment,owner.subject_hash,gen_random_uuid(),
    case when m.notification_consent and m.revoked_at is null and f.status='FRIEND' then 'PENDING' else 'CANCELLED' end::public.notification_job_status,
    case when m.notification_consent and m.revoked_at is null and f.status='FRIEND' then 'QUEUED' else 'SUPPRESSED' end,now(),
    case when not m.notification_consent or m.revoked_at is not null then 'MEMBER_NOT_ELIGIBLE' when f.status is distinct from 'FRIEND' then 'FRIEND_NOT_CONFIRMED' else null end
  from public.orders o join public.line_platform_order_owners owner on owner.order_id=o.id
  join public.line_platform_members m on m.profile_id=owner.profile_id and m.environment=owner.environment and m.provider_id=owner.provider_id and m.subject_hash=owner.subject_hash
  join public.line_platform_stalls s on s.stall_id=o.stall_id and s.environment=owner.environment and s.enabled and o.created_at>=s.cutover_at
  join public.customer_contact_links l on l.customer_reference_id=o.id and l.provider='LINE' and l.provider_user_id_hash=owner.subject_hash
  join public.notification_integrations i on i.id=l.integration_id and i.sender_scope='PLATFORM_OA' and i.environment=owner.environment and i.status='ACTIVE'
  left join public.line_platform_friendships f on f.environment=owner.environment and f.integration_id=i.id and f.subject_hash=owner.subject_hash
  where o.id=p_order_id and (p_event<>'ORDER_READY' or o.status='READY')
    and (p_event<>'ORDER_RECEIPT_AVAILABLE' or o.status in ('CONFIRMED','PREPARING','PACKING','READY','COMPLETED'))
    and (p_event<>'ORDER_RECEIPT_AVAILABLE' or o.payment_status in ('UNPAID','PAID'))
    and (p_event<>'ORDER_RECEIPT_AVAILABLE' or o.payment_status='PAID' or not exists(select 1 from public.payment_provider_transactions t
      where t.order_id=o.id and t.provider='LINE_PAY' and t.status not in ('FAILED','CANCELLED','EXPIRED')))
    and (p_event<>'ORDER_CANCELLED' or o.status='CANCELLED')
    and (p_event<>'ORDER_PICKED_UP' or exists(select 1 from public.order_events e where e.order_id=o.id and e.event_type='LINE_PLATFORM_PICKED_UP'))
  on conflict do nothing;
  if p_event='ORDER_RECEIPT_AVAILABLE' then
    update public.notification_jobs j set status='PENDING',outcome='QUEUED',next_attempt_at=now(),last_error_code=null
    from public.orders o where j.order_id=p_order_id and o.id=j.order_id and o.payment_status='PAID'
      and j.delivery_mode='PLATFORM_OA' and j.template_code=p_event and j.first_request_at is null
      and j.outcome='SUPPRESSED' and j.last_error_code='PAYMENT_NOT_SETTLED';
  end if;
end $$;
revoke all on function public.enqueue_line_platform_notification(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.enqueue_line_platform_notification(uuid,text,integer) to service_role;

create function public.enqueue_line_platform_order_transition() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.status is distinct from new.status or old.payment_status is distinct from new.payment_status then
    perform public.enqueue_line_platform_notification(new.id,'ORDER_RECEIPT_AVAILABLE',0);
    if new.status='READY' then perform public.enqueue_line_platform_notification(new.id,'ORDER_READY',0); end if;
    if new.status='CANCELLED' then perform public.enqueue_line_platform_notification(new.id,'ORDER_CANCELLED',0); end if;
  end if;
  return null;
end $$;
create trigger orders_platform_notifications after update of status,payment_status on public.orders for each row execute function public.enqueue_line_platform_order_transition();
create function public.enqueue_line_platform_pickup_event() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.event_type='LINE_PLATFORM_PICKED_UP' then perform public.enqueue_line_platform_notification(new.order_id,'ORDER_PICKED_UP',0); end if;
  return null;
end $$;
create trigger order_events_platform_pickup after insert on public.order_events for each row execute function public.enqueue_line_platform_pickup_event();

-- pg_net dispatch runs after commit. A missing wakeup configuration cannot fail an order.
create or replace function app_private.invoke_platform_notification_jobs(p_integration_id uuid) returns bigint language plpgsql security definer set search_path='' as $$
declare v_integration public.notification_integrations%rowtype; v_url text;
begin
  select * into v_integration from public.notification_integrations where id=p_integration_id and sender_scope='PLATFORM_OA' and status='ACTIVE';
  if not found or v_integration.environment='local' then return null; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name='stallorder_report_delivery_url' order by updated_at desc limit 1;
  if v_url is distinct from ((v_integration.settings_json->>'workerOrigin')||'/api/cron/report-deliveries') then return null; end if;
  return app_private.invoke_due_notification_jobs();
end $$;
revoke all on function app_private.invoke_platform_notification_jobs(uuid) from public,anon,authenticated;
grant execute on function app_private.invoke_platform_notification_jobs(uuid) to service_role;
create or replace function app_private.wake_platform_notification_worker() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.delivery_mode='PLATFORM_OA' and new.outcome='QUEUED' and new.environment<>'local' then
    begin perform app_private.invoke_platform_notification_jobs(new.integration_id); exception when others then null; end;
  end if;
  return null;
end $$;
create trigger notification_jobs_platform_wakeup after insert on public.notification_jobs for each row execute function app_private.wake_platform_notification_worker();
revoke all on function public.enqueue_line_platform_order_transition(),public.enqueue_line_platform_pickup_event(),app_private.wake_platform_notification_worker() from public,anon,authenticated;

-- Recover a missed/coalesced wakeup without depending on a customer's open MINI App.
create or replace function app_private.recover_platform_notification_jobs() returns void language plpgsql security definer set search_path='' as $$
declare sender record;
begin
  for sender in select i.id from public.notification_integrations i where i.sender_scope='PLATFORM_OA' and i.status='ACTIVE'
    and i.environment<>'local' and i.settings_json->>'notificationsEnabled'='true' and (i.paused_until is null or i.paused_until<=now())
    and (exists(select 1 from public.notification_jobs j where j.integration_id=i.id and j.delivery_mode='PLATFORM_OA'
      and ((j.outcome in ('QUEUED','RETRY_SCHEDULED') and j.next_attempt_at<=now()) or (j.outcome='IN_FLIGHT' and j.lease_expires_at<=now())))
      or exists(select 1 from public.line_webhook_events e where e.integration_id=i.id and e.processed_at is null))
  loop
    begin perform app_private.invoke_platform_notification_jobs(sender.id); exception when others then null; end;
  end loop;
end $$;
revoke all on function app_private.recover_platform_notification_jobs() from public,anon,authenticated;
do $$ begin
  if exists(select 1 from pg_extension where extname='pg_cron')
    and current_database()=current_setting('cron.database_name',true) then
    perform cron.schedule('stallorder-platform-notification-recovery','5 seconds','select app_private.recover_platform_notification_jobs()');
  end if;
end $$;

-- End users never read snapshots, sender credentials or cross-store friendship through RLS.
revoke select on public.notification_jobs from authenticated;
grant select(id,organization_id,stall_id,order_id,template_code,event_version,status,attempt_count,next_attempt_at,last_error_code,provider_message_id,sent_at,created_at,updated_at,outcome) on public.notification_jobs to authenticated;
