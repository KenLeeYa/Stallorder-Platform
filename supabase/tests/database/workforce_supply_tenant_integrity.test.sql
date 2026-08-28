begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(3);

select is((
  select count(*)::integer
  from pg_constraint
  where conname in (
    'attendance_policies_stall_scope_fkey',
    'attendance_events_stall_scope_fkey',
    'workforce_payroll_lines_period_scope_fkey',
    'supply_ingredients_preferred_supplier_scope_fkey',
    'supply_purchase_orders_supplier_scope_fkey',
    'supply_purchase_orders_stall_scope_fkey',
    'supply_purchase_order_lines_order_scope_fkey',
    'supply_inventory_lots_purchase_line_scope_fkey',
    'operating_expenses_stall_scope_fkey'
  )
), 9, 'workforce, supply and attendance references have tenant composite foreign keys');

insert into public.supply_suppliers (
  id, organization_id, code, name, created_by_profile_id
) values (
  'f1000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'TENANT_QA',
  'Tenant QA',
  '55555555-5555-4555-8555-555555555551'
);

select throws_ok(
  $$insert into public.supply_purchase_orders (
      organization_id, supplier_id, document_number, ordered_on, created_by_profile_id
    ) values (
      '11111111-1111-4111-8111-111111111112',
      'f1000000-0000-4000-8000-000000000001',
      'TENANT-QA-PO',
      current_date,
      '55555555-5555-4555-8555-555555555551'
    )$$,
  '23503',
  'insert or update on table "supply_purchase_orders" violates foreign key constraint "supply_purchase_orders_supplier_scope_fkey"',
  'purchase orders cannot reference a supplier from another organization'
);

select throws_ok(
  $$insert into public.attendance_policies (organization_id, stall_id) values (
      '11111111-1111-4111-8111-111111111112',
      '22222222-2222-4222-8222-222222222222'
    )$$,
  '23503',
  'insert or update on table "attendance_policies" violates foreign key constraint "attendance_policies_stall_scope_fkey"',
  'attendance policy cannot reference a stall from another organization'
);

select * from finish();
rollback;
