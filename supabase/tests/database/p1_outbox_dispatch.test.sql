begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(39);

select has_column(
  'public', 'notification_outbox', 'max_attempts',
  'notification outbox has a bounded attempt budget'
);
select has_column(
  'public', 'notification_outbox', 'claimed_by_worker',
  'notification outbox records the lease owner'
);
select has_column(
  'public', 'notification_outbox', 'lease_expires_at',
  'notification outbox records the lease expiry'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.notification_outbox'::regclass
      and conname = 'notification_outbox_status_check'
      and pg_get_constraintdef(oid) like '%PENDING%'
      and pg_get_constraintdef(oid) like '%DELIVERED%'
      and pg_get_constraintdef(oid) like '%FAILED%'
      and pg_get_constraintdef(oid) like '%CANCELLED%'
      and pg_get_constraintdef(oid) not like '%PROCESSING%'
      and pg_get_constraintdef(oid) not like '%RETRY_PENDING%'
      and pg_get_constraintdef(oid) not like '%DEAD_LETTER%'
  ),
  'notification outbox preserves its existing status contract without worker-only states'
);
select ok(
  not has_function_privilege(
    'anon',
    'app_private.claim_notification_outbox(text,integer,timestamptz,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'app_private.claim_notification_outbox(text,integer,timestamptz,integer)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'app_private.claim_notification_outbox(text,integer,timestamptz,integer)',
    'EXECUTE'
  ),
  'only the trusted service role can claim notification outbox work'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.notification_outbox'::regclass
      and conname = 'notification_outbox_max_attempts_check'
  ),
  'notification outbox attempt budget is database constrained'
);
select throws_ok(
  $$select * from app_private.claim_notification_outbox('bad worker!', 1, timestamptz '2000-01-01 00:00:00+00', 600)$$,
  '22023',
  'NOTIFICATION_OUTBOX_WORKER_INVALID',
  'invalid worker identifiers fail closed'
);

delete from public.notification_outbox;
delete from public.billing_notifications;
delete from public.domain_outbox;

insert into public.billing_notifications (
  id, organization_id, notification_type, title, message, dedupe_key
) values
  (
    'f1060000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'INVOICE_CREATED', 'Outbox claim test', 'Local persisted notification',
    'p1-outbox-claim'
  ),
  (
    'f1060000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    'INVOICE_CREATED', 'Outbox retry test', 'Local persisted notification',
    'p1-outbox-retry'
  ),
  (
    'f1060000-0000-4000-8000-000000000003',
    '11111111-1111-4111-8111-111111111111',
    'INVOICE_CREATED', 'Outbox lease test', 'Local persisted notification',
    'p1-outbox-lease'
  ),
  (
    'f1060000-0000-4000-8000-000000000004',
    '11111111-1111-4111-8111-111111111111',
    'INVOICE_CREATED', 'Legacy outbox test', 'Local persisted notification',
    'p1-outbox-legacy-failed'
  );

insert into public.notification_outbox (
  id, organization_id, billing_notification_id, channel, available_at, created_at
) values (
  'f1061000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'f1060000-0000-4000-8000-000000000001',
  'IN_APP',
  timestamptz '2000-01-01 00:00:00+00',
  timestamptz '1999-12-31 23:59:00+00'
);

select is(
  (
    select id::text
    from app_private.claim_notification_outbox(
      'worker-a', 1, timestamptz '2000-01-01 00:00:00+00', 600
    )
  ),
  'f1061000-0000-4000-8000-000000000001',
  'claim returns the oldest eligible notification'
);
select is(
  (select status from public.notification_outbox where id = 'f1061000-0000-4000-8000-000000000001'),
  'PENDING',
  'claim keeps the persisted status pending while lease fields mark processing'
);
select is(
  (select attempt_count from public.notification_outbox where id = 'f1061000-0000-4000-8000-000000000001'),
  1,
  'claim consumes one attempt'
);
select is(
  (select claimed_by_worker from public.notification_outbox where id = 'f1061000-0000-4000-8000-000000000001'),
  'worker-a',
  'claim records its worker owner'
);
select is(
  (select lease_expires_at from public.notification_outbox where id = 'f1061000-0000-4000-8000-000000000001'),
  timestamptz '2000-01-01 00:10:00+00',
  'claim creates a bounded lease'
);
select is(
  (
    select count(*)::integer
    from app_private.claim_notification_outbox(
      'worker-b', 1, timestamptz '2000-01-01 00:00:01+00', 600
    )
  ),
  0,
  'an active lease prevents a duplicate claim'
);
select is(
  app_private.complete_notification_outbox(
    'f1061000-0000-4000-8000-000000000001',
    'worker-b',
    timestamptz '2000-01-01 00:00:02+00'
  ),
  false,
  'a different worker cannot complete the claim'
);
select is(
  app_private.complete_notification_outbox(
    'f1061000-0000-4000-8000-000000000001',
    'worker-a',
    timestamptz '2000-01-01 00:00:03+00'
  ),
  true,
  'the lease owner completes the claim'
);
select is(
  app_private.complete_notification_outbox(
    'f1061000-0000-4000-8000-000000000001',
    'worker-replay',
    timestamptz '2000-01-01 00:00:04+00'
  ),
  true,
  'completion is reentrant after delivery'
);
select ok(
  exists (
    select 1
    from public.notification_outbox
    where id = 'f1061000-0000-4000-8000-000000000001'
      and status = 'DELIVERED'
      and delivered_at = timestamptz '2000-01-01 00:00:03+00'
      and claimed_by_worker is null
      and lease_expires_at is null
  ),
  'delivery clears lease state and preserves the first completion time'
);

insert into public.notification_outbox (
  id, organization_id, billing_notification_id, channel,
  available_at, created_at, max_attempts
) values (
  'f1061000-0000-4000-8000-000000000002',
  '11111111-1111-4111-8111-111111111111',
  'f1060000-0000-4000-8000-000000000002',
  'EMAIL',
  timestamptz '2000-01-02 00:00:00+00',
  timestamptz '2000-01-01 23:59:00+00',
  2
);
select is(
  (
    select id::text
    from app_private.claim_notification_outbox(
      'worker-retry', 1, timestamptz '2000-01-02 00:00:00+00', 600
    )
  ),
  'f1061000-0000-4000-8000-000000000002',
  'retry fixture can be claimed'
);
select is(
  app_private.fail_notification_outbox(
    'f1061000-0000-4000-8000-000000000002',
    'worker-retry',
    'OUTBOX_PROVIDER_TIMEOUT',
    timestamptz '2000-01-02 00:01:00+00',
    timestamptz '2000-01-02 00:00:01+00'
  ),
  'RETRY_PENDING',
  'retryable failure schedules another attempt'
);
select is(
  (select status from public.notification_outbox where id = 'f1061000-0000-4000-8000-000000000002'),
  'PENDING',
  'retryable failure remains pending in the persisted status contract'
);
select is(
  (select available_at from public.notification_outbox where id = 'f1061000-0000-4000-8000-000000000002'),
  timestamptz '2000-01-02 00:01:00+00',
  'retryable failure stores its retry time'
);
select is(
  (select last_error_code from public.notification_outbox where id = 'f1061000-0000-4000-8000-000000000002'),
  'OUTBOX_PROVIDER_TIMEOUT',
  'retry stores only a sanitized error code'
);
select is(
  (
    select count(*)::integer
    from app_private.claim_notification_outbox(
      'worker-too-early', 1, timestamptz '2000-01-02 00:00:59+00', 600
    )
  ),
  0,
  'retry cannot be claimed before its available time'
);
select is(
  (
    select id::text
    from app_private.claim_notification_outbox(
      'worker-retry-2', 1, timestamptz '2000-01-02 00:01:00+00', 600
    )
  ),
  'f1061000-0000-4000-8000-000000000002',
  'retry becomes claimable at its available time'
);
select is(
  (select attempt_count from public.notification_outbox where id = 'f1061000-0000-4000-8000-000000000002'),
  2,
  'retry consumes the final attempt'
);
select is(
  app_private.fail_notification_outbox(
    'f1061000-0000-4000-8000-000000000002',
    'worker-retry-2',
    'EMAIL_PROVIDER_NOT_ENABLED',
    null,
    timestamptz '2000-01-02 00:01:01+00'
  ),
  'DEAD_LETTER',
  'non-retryable or exhausted delivery moves to dead letter'
);
select ok(
  exists (
    select 1
    from public.notification_outbox
    where id = 'f1061000-0000-4000-8000-000000000002'
      and status = 'FAILED'
      and last_error_code = 'EMAIL_PROVIDER_NOT_ENABLED'
      and claimed_by_worker is null
      and lease_expires_at is null
  ),
  'failed status represents terminal dead letter and releases the lease'
);

insert into public.notification_outbox (
  id, organization_id, billing_notification_id, channel,
  available_at, created_at, max_attempts
) values (
  'f1061000-0000-4000-8000-000000000003',
  '11111111-1111-4111-8111-111111111111',
  'f1060000-0000-4000-8000-000000000003',
  'IN_APP',
  timestamptz '2000-01-03 00:00:00+00',
  timestamptz '2000-01-02 23:59:00+00',
  3
);
select is(
  (
    select id::text
    from app_private.claim_notification_outbox(
      'worker-crash', 1, timestamptz '2000-01-03 00:00:00+00', 600
    )
  ),
  'f1061000-0000-4000-8000-000000000003',
  'lease recovery fixture can be claimed'
);
select is(
  (
    select id::text
    from app_private.claim_notification_outbox(
      'worker-recovery', 1, timestamptz '2000-01-03 00:10:01+00', 600
    )
  ),
  'f1061000-0000-4000-8000-000000000003',
  'an expired lease is recovered and reclaimed'
);
select ok(
  exists (
    select 1
    from public.notification_outbox
    where id = 'f1061000-0000-4000-8000-000000000003'
      and status = 'PENDING'
      and attempt_count = 2
      and last_error_code = 'OUTBOX_LEASE_EXPIRED'
      and claimed_by_worker = 'worker-recovery'
  ),
  'lease recovery keeps bounded retry evidence'
);
select is(
  app_private.complete_notification_outbox(
    'f1061000-0000-4000-8000-000000000003',
    'worker-recovery',
    timestamptz '2000-01-03 00:10:02+00'
  ),
  true,
  'the recovery worker can complete the event'
);
select is(
  (select pending_depth from app_private.notification_outbox_health(timestamptz '2000-01-03 00:10:03+00')),
  0,
  'health reports no pending work after completion'
);
select is(
  (select oldest_pending_age_seconds from app_private.notification_outbox_health(timestamptz '2000-01-03 00:10:03+00')),
  null,
  'health reports null age when no notification is pending'
);
select is(
  (select dead_letter_depth from app_private.notification_outbox_health(timestamptz '2000-01-03 00:10:03+00')),
  1,
  'health reports dead-letter depth'
);

insert into public.notification_outbox (
  id, organization_id, billing_notification_id, channel, status,
  available_at, created_at, max_attempts
) values (
  'f1061000-0000-4000-8000-000000000004',
  '11111111-1111-4111-8111-111111111111',
  'f1060000-0000-4000-8000-000000000004',
  'IN_APP',
  'FAILED',
  timestamptz '2000-01-04 00:00:00+00',
  timestamptz '2000-01-03 23:59:00+00',
  3
);
select is(
  (
    select count(*)::integer
    from app_private.claim_notification_outbox(
      'worker-legacy', 1, timestamptz '2000-01-04 00:00:00+00', 600
    )
  ),
  0,
  'an existing failed notification remains terminal without a migration-time data rewrite'
);
select is(
  (select status from public.notification_outbox where id = 'f1061000-0000-4000-8000-000000000004'),
  'FAILED',
  'claim does not reinterpret an existing failed notification as active work'
);

insert into public.domain_outbox (
  event_id, organization_id, stall_id, aggregate_type, aggregate_id,
  event_type, dedupe_key, payload, status
) values (
  'f1062000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'ORDER', 'f1063000-0000-4000-8000-000000000001',
  'OFFLINE_ORDER_IMPORTED', 'p1-domain-order', '{}'::jsonb, 'PENDING'
);
select is(
  (select status from public.domain_outbox
   where event_id = 'f1062000-0000-4000-8000-000000000001'),
  'PENDING',
  'legacy nonterminal domain events remain available to the quarantine worker'
);
update public.domain_outbox
set status = 'PENDING', processed_at = null, last_error_code = null
where event_id = 'f1062000-0000-4000-8000-000000000001';
select is(
  app_private.quarantine_dormant_domain_outbox(timestamptz '2000-01-04 00:00:00+00'),
  1,
  'worker quarantine drains legacy nonterminal domain events'
);
select ok(
  exists (
    select 1
    from public.domain_outbox
    where event_id = 'f1062000-0000-4000-8000-000000000001'
      and status = 'CANCELLED'
      and processed_at = timestamptz '2000-01-04 00:00:00+00'
      and last_error_code = 'DOMAIN_OUTBOX_DORMANT_NO_CONSUMER'
  ),
  'legacy quarantine preserves an explicit fail-closed terminal reason'
);

select * from finish();
rollback;
