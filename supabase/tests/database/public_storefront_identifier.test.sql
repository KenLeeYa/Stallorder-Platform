begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(7);

select ok(
  exists (
    select 1
    from pg_index index_record
    join pg_class index_class on index_class.oid = index_record.indexrelid
    join pg_namespace index_schema on index_schema.oid = index_class.relnamespace
    where index_schema.nspname = 'public'
      and index_class.relname = 'stalls_code_lower_lookup_idx'
      and not index_record.indisunique
      and index_record.indisvalid
      and index_record.indpred is null
      and pg_get_indexdef(index_record.indexrelid) like '%lower(code)%'
  ),
  'stall code has a valid non-unique lower-case lookup index'
);

select ok(
  exists (
    select 1
    from pg_trigger trigger_record
    join pg_class table_record on table_record.oid = trigger_record.tgrelid
    join pg_namespace table_schema on table_schema.oid = table_record.relnamespace
    where table_schema.nspname = 'public'
      and table_record.relname = 'stalls'
      and trigger_record.tgname = 'stalls_validate_global_code_before_write'
      and trigger_record.tgenabled = 'O'
      and not trigger_record.tgisinternal
  ),
  'stall code guard is an origin trigger so logical replication apply skips it'
);

select ok(
  exists (
    select 1
    from pg_proc function_record
    join pg_namespace function_schema on function_schema.oid = function_record.pronamespace
    where function_schema.nspname = 'public'
      and function_record.proname = 'enforce_global_stall_code_guard'
      and function_record.prosecdef
  ),
  'stall code guard function is security definer'
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

select throws_ok(
  $$insert into public.stalls (
      id, organization_id, name, slug, code, address, currency, timezone,
      is_active, business_status, ordering_enabled, updated_at
    ) values (
      'a3200000-0000-4000-8000-000000000003',
      'a3100000-0000-4000-8000-000000000002',
      '公開代碼回填測試攤位',
      'pgtap-public-code',
      '',
      '台北市測試路 312 號',
      'TWD',
      'Asia/Taipei',
      true,
      'OPEN',
      true,
      now()
    )$$,
  '23505',
  null,
  'slug-derived duplicate stall codes are rejected after foundation normalization'
);

insert into public.stalls (
  id, organization_id, name, slug, code, address, currency, timezone,
  is_active, business_status, ordering_enabled, updated_at
) values (
  'a3200000-0000-4000-8000-000000000002',
  'a3100000-0000-4000-8000-000000000002',
  '公開代碼測試攤位二',
  'public-code-test-stall-two',
  'PGTAP-PUBLIC-CODE-TWO',
  '台北市測試路 311 號',
  'TWD',
  'Asia/Taipei',
  true,
  'OPEN',
  true,
  now()
);

select throws_ok(
  $$update public.stalls
    set code = 'pgtap-public-code'
    where id = 'a3200000-0000-4000-8000-000000000002'$$,
  '23505',
  null,
  'case-insensitive duplicate stall code updates are rejected'
);
alter table public.stalls enable trigger stalls_billing_limit_before_write;

select * from finish();
rollback;
