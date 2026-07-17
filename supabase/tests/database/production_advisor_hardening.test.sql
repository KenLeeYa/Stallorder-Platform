begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(8);

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

select * from finish();
rollback;
