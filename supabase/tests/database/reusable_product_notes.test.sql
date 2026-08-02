begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(27);

select ok(
  (
    select count(*) = 2 and bool_and(relrowsecurity and relforcerowsecurity)
    from pg_class
    where oid = any (array[
      'public.reusable_product_notes'::regclass,
      'public.reusable_product_note_translations'::regclass
    ])
  ),
  '共用單一註記與翻譯資料表均啟用並強制套用 RLS'
);
select ok(
  not has_table_privilege('anon', 'public.reusable_product_notes', 'INSERT'),
  '匿名角色不可直接新增共用單一註記'
);
select ok(
  not has_table_privilege('authenticated', 'public.reusable_product_notes', 'UPDATE'),
  '登入角色必須透過受信任後端更新共用單一註記'
);
select ok(
  has_table_privilege('service_role', 'public.reusable_product_notes', 'SELECT, INSERT, UPDATE, DELETE'),
  '服務角色具備受信任後端所需的最小資料操作權限'
);

insert into public.organizations (
  id, name, slug, business_name, status, email, phone,
  default_timezone, default_currency, created_at, updated_at
) values
  (
    '92111111-1111-4111-8111-111111111111', '共用註記測試一', 'reusable-note-test-one',
    '共用註記測試一', 'ACTIVE', 'reusable-note-one@stallorder.test', '0900-001-111',
    'Asia/Taipei', 'TWD', now(), now()
  ),
  (
    '92111111-1111-4111-8111-111111111112', '共用註記測試二', 'reusable-note-test-two',
    '共用註記測試二', 'ACTIVE', 'reusable-note-two@stallorder.test', '0900-001-112',
    'Asia/Taipei', 'TWD', now(), now()
  );

insert into public.product_note_groups (
  id, organization_id, name, selection_mode, is_required,
  min_selections, max_selections, sort_order, is_active
) values
  (
    '92222222-2222-4222-8222-222222222221',
    '92111111-1111-4111-8111-111111111111',
    '客製選項一', 'MULTIPLE', false, 0, null, 1, true
  ),
  (
    '92222222-2222-4222-8222-222222222222',
    '92111111-1111-4111-8111-111111111111',
    '客製選項二', 'MULTIPLE', false, 0, null, 2, true
  ),
  (
    '92222222-2222-4222-8222-222222222223',
    '92111111-1111-4111-8111-111111111112',
    '其他組織選項', 'MULTIPLE', false, 0, null, 1, true
  );

select lives_ok(
  $$
    insert into public.reusable_product_notes (
      id, organization_id, name, price_delta, sort_order, is_active
    ) values (
      '92333333-3333-4333-8333-333333333331',
      '92111111-1111-4111-8111-111111111111',
      '不要香菜', 0, 1, true
    );
    insert into public.reusable_product_note_translations (
      id, organization_id, reusable_note_id, locale, name
    ) values (
      '92333333-3333-4333-8333-333333333332',
      '92111111-1111-4111-8111-111111111111',
      '92333333-3333-4333-8333-333333333331',
      'en', 'No cilantro'
    );
  $$,
  '組織可建立具多語名稱的共用單一註記'
);

select lives_ok(
  $$
    insert into public.product_note_options (
      id, organization_id, note_group_id, reusable_note_id,
      name, price_delta, sort_order, is_active
    ) values
      (
        '92444444-4444-4444-8444-444444444441',
        '92111111-1111-4111-8111-111111111111',
        '92222222-2222-4222-8222-222222222221',
        '92333333-3333-4333-8333-333333333331',
        '不要香菜', 0, 3, true
      ),
      (
        '92444444-4444-4444-8444-444444444442',
        '92111111-1111-4111-8111-111111111111',
        '92222222-2222-4222-8222-222222222222',
        '92333333-3333-4333-8333-333333333331',
        '不要香菜', 0, 4, true
      );
  $$,
  '同一共用註記可加入多個註記群組'
);
select is(
  (select count(*)::integer from public.product_note_options where reusable_note_id = '92333333-3333-4333-8333-333333333331'),
  2,
  '兩個群組各保存一筆相容的連結選項'
);
select is(
  (
    select count(*)::integer
    from public.product_note_option_translations translation
    join public.product_note_options note_option on note_option.id = translation.note_option_id
    where note_option.reusable_note_id = '92333333-3333-4333-8333-333333333331'
      and translation.locale = 'en'
      and translation.name = 'No cilantro'
  ),
  2,
  '加入群組時自動複製共用註記翻譯'
);

select lives_ok(
  $$
    update public.reusable_product_notes
    set name = '香菜另外放', price_delta = 10, is_active = false
    where id = '92333333-3333-4333-8333-333333333331'
  $$,
  '更新共用定義可同步所有群組連結'
);
select is(
  (
    select count(*)::integer
    from public.product_note_options
    where reusable_note_id = '92333333-3333-4333-8333-333333333331'
      and name = '香菜另外放'
      and price_delta = 10
      and not is_active
  ),
  2,
  '所有連結選項的名稱、價差與啟用狀態保持一致'
);
select lives_ok(
  $$
    update public.reusable_product_note_translations
    set name = 'Cilantro on the side'
    where reusable_note_id = '92333333-3333-4333-8333-333333333331'
      and locale = 'en'
  $$,
  '更新共用翻譯可同步所有群組連結翻譯'
);
select is(
  (
    select count(*)::integer
    from public.product_note_option_translations translation
    join public.product_note_options note_option on note_option.id = translation.note_option_id
    where note_option.reusable_note_id = '92333333-3333-4333-8333-333333333331'
      and translation.locale = 'en'
      and translation.name = 'Cilantro on the side'
  ),
  2,
  '群組連結翻譯與共用定義同步'
);
select lives_ok(
  $$
    delete from public.reusable_product_note_translations
    where reusable_note_id = '92333333-3333-4333-8333-333333333331'
      and locale = 'en'
  $$,
  '刪除共用翻譯可同步移除所有群組連結翻譯'
);
select is(
  (
    select count(*)::integer
    from public.product_note_option_translations translation
    join public.product_note_options note_option on note_option.id = translation.note_option_id
    where note_option.reusable_note_id = '92333333-3333-4333-8333-333333333331'
      and translation.locale = 'en'
  ),
  0,
  '共用翻譯刪除後不殘留群組連結翻譯'
);
insert into public.reusable_product_note_translations (
  id, organization_id, reusable_note_id, locale, name
) values (
  '92333333-3333-4333-8333-333333333332',
  '92111111-1111-4111-8111-111111111111',
  '92333333-3333-4333-8333-333333333331',
  'en', 'Cilantro on the side'
);

select throws_ok(
  $$
    update public.product_note_options
    set name = '自行改名'
    where id = '92444444-4444-4444-8444-444444444441'
  $$,
  'P0001', 'REUSABLE_PRODUCT_NOTE_OPTION_CONTENT_MISMATCH',
  '連結選項不可脫離共用定義內容'
);
select throws_ok(
  $$
    insert into public.product_note_options (
      organization_id, note_group_id, reusable_note_id,
      name, price_delta, sort_order, is_active
    ) values (
      '92111111-1111-4111-8111-111111111112',
      '92222222-2222-4222-8222-222222222223',
      '92333333-3333-4333-8333-333333333331',
      '香菜另外放', 10, 1, false
    )
  $$,
  'P0001', 'REUSABLE_PRODUCT_NOTE_OPTION_SCOPE_MISMATCH',
  '不同組織不可連結共用註記'
);
select throws_ok(
  $$
    insert into public.product_note_options (
      organization_id, note_group_id, reusable_note_id,
      name, price_delta, sort_order, is_active
    ) values (
      '92111111-1111-4111-8111-111111111111',
      '92222222-2222-4222-8222-222222222221',
      '92333333-3333-4333-8333-333333333331',
      '香菜另外放', 10, 5, false
    )
  $$,
  '23505', null,
  '同一群組不可重複加入相同共用註記'
);
select throws_ok(
  $$delete from public.reusable_product_notes where id = '92333333-3333-4333-8333-333333333331'$$,
  '23503', null,
  '仍被群組使用的共用註記不可刪除'
);

select lives_ok(
  $$
    insert into public.product_note_options (
      id, organization_id, note_group_id, name, price_delta, sort_order, is_active
    ) values (
      '92444444-4444-4444-8444-444444444443',
      '92111111-1111-4111-8111-111111111111',
      '92222222-2222-4222-8222-222222222221',
      '群組專用註記', 0, 9, true
    )
  $$,
  '既有群組專用註記仍可建立'
);
select ok(
  (select reusable_note_id is null from public.product_note_options where id = '92444444-4444-4444-8444-444444444443'),
  '既有群組專用選項維持 nullable 相容契約'
);
insert into public.product_note_option_translations (
  organization_id, note_option_id, locale, name
) values (
  '92111111-1111-4111-8111-111111111111',
  '92444444-4444-4444-8444-444444444443',
  'en', 'Legacy translation'
);
delete from public.product_note_options
where id = '92444444-4444-4444-8444-444444444441';
select lives_ok(
  $$
    update public.product_note_options
    set reusable_note_id = '92333333-3333-4333-8333-333333333331',
        name = '香菜另外放',
        price_delta = 10,
        is_active = false
    where id = '92444444-4444-4444-8444-444444444443'
  $$,
  '既有群組專用選項可安全轉為共用註記連結'
);
select is(
  (
    select count(*)::integer
    from public.product_note_option_translations
    where note_option_id = '92444444-4444-4444-8444-444444444443'
      and locale = 'en'
      and name = 'Cilantro on the side'
  ),
  1,
  '轉為共用連結時會移除舊翻譯並複製目前共用翻譯'
);

insert into public.reusable_product_notes (
  id, organization_id, name, price_delta, sort_order, is_active
) values (
  '92333333-3333-4333-8333-333333333339',
  '92111111-1111-4111-8111-111111111112',
  '其他組織共用註記', 0, 1, true
);
insert into public.reusable_product_note_translations (
  organization_id, reusable_note_id, locale, name
) values (
  '92111111-1111-4111-8111-111111111112',
  '92333333-3333-4333-8333-333333333339',
  'en', 'Other organization note'
);
insert into auth.users (id, email) values (
  '92a00000-0000-4000-8000-000000000001',
  'reusable-note-owner-rls@stallorder.test'
);
update public.profiles
set auth_user_id = '92a00000-0000-4000-8000-000000000001'
where id = '55555555-5555-4555-8555-555555555551';
insert into public.subscriptions (
  id, organization_id, plan_id, status,
  billing_period_start, billing_period_end
)
select
  '92b00000-0000-4000-8000-000000000001',
  '92111111-1111-4111-8111-111111111111',
  plan.id,
  'ACTIVE',
  date_trunc('month', now())::date,
  (date_trunc('month', now()) + interval '1 month')::date
from public.plans plan
where plan.code = 'STANDARD';
insert into public.organization_memberships (
  organization_id, profile_id, role, all_stalls, is_active
) values (
  '92111111-1111-4111-8111-111111111111',
  '55555555-5555-4555-8555-555555555551',
  'ORGANIZATION_OWNER', true, true
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '92a00000-0000-4000-8000-000000000001', true);
select is(
  (select count(*)::integer from public.reusable_product_notes where organization_id = '92111111-1111-4111-8111-111111111111'),
  1,
  '組織層管理者可讀取自己組織的共用註記'
);
select is(
  (select count(*)::integer from public.reusable_product_note_translations where organization_id = '92111111-1111-4111-8111-111111111111'),
  1,
  '組織層管理者可讀取自己組織的共用註記翻譯'
);
select is(
  (select count(*)::integer from public.reusable_product_notes where organization_id = '92111111-1111-4111-8111-111111111112'),
  0,
  'RLS 隔離其他組織的共用註記'
);
reset role;

select lives_ok(
  $$
    delete from public.product_note_options
    where reusable_note_id = '92333333-3333-4333-8333-333333333331';
    delete from public.reusable_product_notes
    where id = '92333333-3333-4333-8333-333333333331';
  $$,
  '所有群組解除連結後可刪除共用註記'
);
select is(
  (select count(*)::integer from public.reusable_product_notes where id = '92333333-3333-4333-8333-333333333331'),
  0,
  '刪除後不殘留共用定義'
);

select * from finish();
rollback;
