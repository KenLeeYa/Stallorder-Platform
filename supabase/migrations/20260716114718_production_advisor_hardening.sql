drop policy if exists product_images_public_read on storage.objects;

revoke all on function public.refresh_order_daily_summary() from public, anon, authenticated;
revoke all on function public.refresh_payment_daily_summary() from public, anon, authenticated;

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;

create index if not exists additional_stall_approvals_approved_by_idx
  on public.additional_stall_approvals (approved_by);
create index if not exists additional_stall_approvals_subscription_idx
  on public.additional_stall_approvals (subscription_id);
create index if not exists cash_movements_recorded_by_idx
  on public.cash_movements (recorded_by);
create index if not exists cash_movements_stall_idx
  on public.cash_movements (stall_id);
create index if not exists cash_shifts_closed_by_idx
  on public.cash_shifts (closed_by);
create index if not exists cash_shifts_opened_by_idx
  on public.cash_shifts (opened_by);
create index if not exists checkout_groups_discount_option_idx
  on public.checkout_groups (discount_option_id);
create index if not exists checkout_groups_payment_option_idx
  on public.checkout_groups (payment_option_id);
create index if not exists checkout_groups_recorded_by_idx
  on public.checkout_groups (recorded_by);
create index if not exists checkout_groups_stall_idx
  on public.checkout_groups (stall_id);
create index if not exists daily_stall_summaries_stall_org_idx
  on public.daily_stall_summaries (stall_id, organization_id);
create index if not exists discount_options_stall_idx
  on public.discount_options (stall_id);
create index if not exists invoices_subscription_idx
  on public.invoices (subscription_id);
create index if not exists order_item_batch_actions_actor_idx
  on public.order_item_batch_actions (actor_profile_id);
create index if not exists order_item_batch_actions_org_idx
  on public.order_item_batch_actions (organization_id);
create index if not exists order_item_note_options_group_idx
  on public.order_item_note_options (note_group_id);
create index if not exists order_item_note_options_stall_idx
  on public.order_item_note_options (stall_id);
create index if not exists order_items_product_idx
  on public.order_items (product_id);
create index if not exists order_sessions_tenant_idx
  on public.order_sessions (tenant_id);
create index if not exists orders_cancelled_by_idx
  on public.orders (cancelled_by);
create index if not exists orders_dining_table_idx
  on public.orders (dining_table_id);
create index if not exists orders_discount_applied_by_idx
  on public.orders (discount_applied_by);
create index if not exists orders_discount_approved_by_idx
  on public.orders (discount_approved_by);
create index if not exists orders_discount_option_idx
  on public.orders (discount_option_id);
create index if not exists organization_invitations_invited_by_idx
  on public.organization_invitations (invited_by);
create index if not exists organization_invitations_stall_idx
  on public.organization_invitations (stall_id);
create index if not exists payments_stall_idx
  on public.payments (stall_id);
create index if not exists print_jobs_reprint_of_idx
  on public.print_jobs (reprint_of_id);
create index if not exists print_jobs_requested_by_idx
  on public.print_jobs (requested_by);
create index if not exists print_jobs_stall_idx
  on public.print_jobs (stall_id);
create index if not exists product_groups_category_org_idx
  on public.product_groups (category_id, organization_id);
create index if not exists product_note_group_assignments_group_fk_idx
  on public.product_note_group_assignments (note_group_id);
create index if not exists products_category_org_fk_idx
  on public.products (category_id, organization_id);
create index if not exists products_group_org_fk_idx
  on public.products (group_id, organization_id);
create index if not exists public_order_attempts_qr_code_idx
  on public.public_order_attempts (qr_code_id);
create index if not exists report_schedules_created_by_idx
  on public.report_schedules (created_by);
create index if not exists report_schedules_updated_by_idx
  on public.report_schedules (updated_by);
create index if not exists stall_memberships_profile_idx
  on public.stall_memberships (profile_id);
create index if not exists stall_memberships_stall_org_fk_idx
  on public.stall_memberships (stall_id, organization_id);
create index if not exists stall_memberships_user_idx
  on public.stall_memberships (user_id);
create index if not exists stall_products_product_org_fk_idx
  on public.stall_products (product_id, organization_id);
create index if not exists stall_products_stall_org_fk_idx
  on public.stall_products (stall_id, organization_id);
