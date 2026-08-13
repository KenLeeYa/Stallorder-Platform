begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(4);

select ok(
  exists (
    select 1
    from pg_index index_record
    join pg_class index_class on index_class.oid = index_record.indexrelid
    join pg_namespace index_schema on index_schema.oid = index_class.relnamespace
    where index_schema.nspname = 'public'
      and index_class.relname = 'stalls_code_lower_unique_idx'
      and index_record.indisunique
      and index_record.indisvalid
      and index_record.indpred is null
      and pg_get_indexdef(index_record.indexrelid) like '%lower(code)%'
  ),
  'stall code has a valid global unique lower-case expression index'
);

select is(
  (
    select count(*)
    from (
      select lower(code)
      from public.stalls
      group by lower(code)
      having count(*) > 1
    ) collisions
  ),
  0::bigint,
  'existing stall codes have no case-insensitive collisions'
);

select lives_ok(
  $$create unique index if not exists stalls_code_lower_unique_idx
    on public.stalls ((lower(code)))$$,
  'the unique-index migration statement is idempotent'
);

insert into public.organizations (
  id, name, slug, business_name, status, email, phone, updated_at
) values
  (
    'a3100000-0000-4000-8000-000000000001',
    '公開代碼測試組織一',
    'public-code-test-organization-one',
    '公開代碼測試組織一',
    'ACTIVE',
    'public-code-one@stallorder.test',
    '0900-310-001',
    now()
  ),
  (
    'a3100000-0000-4000-8000-000000000002',
    '公開代碼測試組織二',
    'public-code-test-organization-two',
    '公開代碼測試組織二',
    'ACTIVE',
    'public-code-two@stallorder.test',
    '0900-310-002',
    now()
  );

alter table public.stalls disable trigger stalls_billing_limit_before_write;
insert into public.stalls (
  id, organization_id, name, slug, code, address, currency, timezone,
  is_active, business_status, ordering_enabled, updated_at
) values (
  'a3200000-0000-4000-8000-000000000001',
  'a3100000-0000-4000-8000-000000000001',
  '公開代碼測試攤位一',
  'public-code-test-stall-one',
  'PGTAP-PUBLIC-CODE',
  '台北市測試路 310 號',
  'TWD',
  'Asia/Taipei',
  true,
  'OPEN',
  true,
  now()
);

select throws_ok(
  $$insert into public.stalls (
      id, organization_id, name, slug, code, address, currency, timezone,
      is_active, business_status, ordering_enabled, updated_at
    ) values (
      'a3200000-0000-4000-8000-000000000002',
      'a3100000-0000-4000-8000-000000000002',
      '公開代碼測試攤位二',
      'public-code-test-stall-two',
      'pgtap-public-code',
      '台北市測試路 311 號',
      'TWD',
      'Asia/Taipei',
      true,
      'OPEN',
      true,
      now()
    )$$,
  '23505',
  null,
  'case-insensitive duplicate stall codes are rejected across organizations'
);
alter table public.stalls enable trigger stalls_billing_limit_before_write;

select * from finish();
rollback;
