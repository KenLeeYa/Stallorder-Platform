begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(17);

select ok(
  not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'product_images_public_read'
  ),
  'public product image bucket does not expose object listing'
);

select ok(
  not has_function_privilege('anon', 'public.refresh_order_daily_summary()', 'EXECUTE'),
  'anon cannot execute the order summary trigger function'
);
select ok(
  not has_function_privilege('authenticated', 'public.refresh_order_daily_summary()', 'EXECUTE'),
  'authenticated users cannot execute the order summary trigger function'
);
select ok(
  not has_function_privilege('anon', 'public.refresh_payment_daily_summary()', 'EXECUTE'),
  'anon cannot execute the payment summary trigger function'
);
select ok(
  not has_function_privilege('authenticated', 'public.refresh_payment_daily_summary()', 'EXECUTE'),
  'authenticated users cannot execute the payment summary trigger function'
);
select ok(
  case
    when to_regprocedure('public.rls_auto_enable()') is null then true
    else not has_function_privilege('anon', to_regprocedure('public.rls_auto_enable()'), 'EXECUTE')
  end,
  'anon cannot execute the RLS event trigger function'
);
select ok(
  case
    when to_regprocedure('public.rls_auto_enable()') is null then true
    else not has_function_privilege('authenticated', to_regprocedure('public.rls_auto_enable()'), 'EXECUTE')
  end,
  'authenticated users cannot execute the RLS event trigger function'
);

select is(
  (
    select count(*)
    from unnest(array[
      'additional_stall_approvals_approved_by_idx',
      'additional_stall_approvals_subscription_idx',
      'cash_movements_recorded_by_idx',
      'cash_movements_stall_idx',
      'cash_shifts_closed_by_idx',
      'cash_shifts_opened_by_idx',
      'checkout_groups_discount_option_idx',
      'checkout_groups_payment_option_idx',
      'checkout_groups_recorded_by_idx',
      'checkout_groups_stall_idx',
      'daily_stall_summaries_stall_org_idx',
      'discount_options_stall_idx',
      'invoices_subscription_idx',
      'order_item_batch_actions_actor_idx',
      'order_item_batch_actions_org_idx',
      'order_item_note_options_group_idx',
      'order_item_note_options_stall_idx',
      'order_items_product_idx',
      'order_sessions_tenant_idx',
      'orders_cancelled_by_idx',
      'orders_dining_table_idx',
      'orders_discount_applied_by_idx',
      'orders_discount_approved_by_idx',
      'orders_discount_option_idx',
      'organization_invitations_invited_by_idx',
      'organization_invitations_stall_idx',
      'payments_stall_idx',
      'print_jobs_reprint_of_idx',
      'print_jobs_requested_by_idx',
      'print_jobs_stall_idx',
      'product_groups_category_org_idx',
      'product_note_group_assignments_group_fk_idx',
      'products_category_org_fk_idx',
      'products_group_org_fk_idx',
      'public_order_attempts_qr_code_idx',
      'report_schedules_created_by_idx',
      'report_schedules_updated_by_idx',
      'stall_memberships_profile_idx',
      'stall_memberships_stall_org_fk_idx',
      'stall_memberships_user_idx',
      'stall_products_product_org_fk_idx',
      'stall_products_stall_org_fk_idx'
    ]) as expected(index_name)
    where to_regclass('public.' || expected.index_name) is not null
  ),
  42::bigint,
  'all foreign key support indexes exist'
);

select is(
  (
    select count(*)
    from pg_proc function_record
    join pg_namespace function_schema
      on function_schema.oid = function_record.pronamespace
    where function_schema.nspname = 'app_private'
      and function_record.proname = any (array[
        'can_access_organization_catalog',
        'can_access_stall',
        'can_manage_stall',
        'can_view_cash_shift',
        'can_view_kds',
        'can_view_orders',
        'can_view_stall_financials',
        'current_profile_id',
        'effective_stall_product_price',
        'has_organization_role',
        'has_organization_wide_staff_access',
        'has_stall_role',
        'is_current_profile',
        'is_organization_member',
        'is_platform_admin',
        'stall_business_date'
      ])
      and function_record.prosecdef
  ),
  16::bigint,
  'authorization helpers remain SECURITY DEFINER outside exposed schemas'
);

select is(
  (
    select count(*)
    from pg_proc function_record
    join pg_namespace function_schema
      on function_schema.oid = function_record.pronamespace
    where function_schema.nspname = 'public'
      and function_record.proname = any (array[
        'can_access_organization_catalog',
        'can_access_stall',
        'can_manage_stall',
        'can_view_cash_shift',
        'can_view_kds',
        'can_view_orders',
        'can_view_stall_financials',
        'current_profile_id',
        'effective_stall_product_price',
        'has_organization_role',
        'has_organization_wide_staff_access',
        'has_stall_role',
        'is_current_profile',
        'is_organization_member',
        'is_platform_admin',
        'stall_business_date'
      ])
      and function_record.prosecdef
  ),
  0::bigint,
  'no authorization SECURITY DEFINER helper remains in public'
);

select is(
  (
    select count(*)
    from pg_proc function_record
    join pg_namespace function_schema
      on function_schema.oid = function_record.pronamespace
    where function_schema.nspname = 'public'
      and function_record.proname in (
        'effective_stall_product_price',
        'stall_business_date'
      )
      and not function_record.prosecdef
  ),
  2::bigint,
  'public compatibility helpers use caller privileges'
);

select ok(
  has_schema_privilege('authenticated', 'app_private', 'USAGE'),
  'authenticated RLS evaluation can resolve private helpers'
);

select ok(
  not has_schema_privilege('anon', 'app_private', 'USAGE'),
  'anonymous callers cannot resolve private helpers'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'app_private.invoke_due_notification_jobs()',
    'EXECUTE'
  ),
  'granting private schema usage does not expose internal job processors'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'merchant_applications'
      and cmd = 'SELECT'
      and 'authenticated' = any (roles)
  ),
  1::bigint,
  'merchant applications have one authenticated permissive SELECT policy'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'merchant_application_notifications'
      and cmd = 'SELECT'
      and 'authenticated' = any (roles)
  ),
  1::bigint,
  'merchant notifications have one authenticated permissive SELECT policy'
);

select ok(
  not exists (
    select 1
    from pg_proc function_record
    join pg_namespace function_schema
      on function_schema.oid = function_record.pronamespace
    where function_schema.nspname in ('public', 'graphql_public')
      and function_record.prosecdef
      and has_function_privilege('authenticated', function_record.oid, 'EXECUTE')
      and function_record.proname = any (array[
        'can_access_organization_catalog',
        'can_access_stall',
        'can_manage_stall',
        'can_view_cash_shift',
        'can_view_kds',
        'can_view_orders',
        'can_view_stall_financials',
        'current_profile_id',
        'effective_stall_product_price',
        'has_organization_role',
        'has_organization_wide_staff_access',
        'has_stall_role',
        'is_current_profile',
        'is_organization_member',
        'is_platform_admin',
        'stall_business_date'
      ])
  ),
  'authenticated users have no executable authorization definer in exposed schemas'
);

select * from finish();
rollback;
