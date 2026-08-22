drop index if exists public.print_jobs_order_rule_unique;

create unique index print_jobs_order_rule_unique
  on public.print_jobs (order_id, print_rule_id)
  where print_rule_id is not null
    and (reprint_of_id is null or is_routing_copy);

create or replace function public.route_integrated_order_print_jobs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_confirmation_event boolean := false;
  v_payment_event boolean := false;
  v_has_rules boolean := false;
  v_root_job_id uuid;
  v_root_rule_id uuid;
  v_first_rule_id uuid;
  v_first_printer_id uuid;
  v_first_document_type public.print_document_type;
  v_first_copies integer;
begin
  if tg_op = 'INSERT' then
    v_confirmation_event := new.status = 'CONFIRMED'::public.order_status;
    v_payment_event := new.payment_status = 'PAID'::public.payment_status;
  else
    v_confirmation_event := new.status = 'CONFIRMED'::public.order_status
      and old.status <> 'CONFIRMED'::public.order_status;
    v_payment_event := new.payment_status = 'PAID'::public.payment_status
      and old.payment_status <> 'PAID'::public.payment_status;
  end if;

  if not v_confirmation_event and not v_payment_event then
    return null;
  end if;

  -- The offline device owns its local print job. Cancel the compatibility job
  -- created by the older confirmation trigger to prevent a second paper copy.
  if new.origin = 'OFFLINE_POS'::public.order_origin then
    update public.print_jobs
    set status = 'CANCELLED'::public.print_job_status,
        updated_at = now()
    where order_id = new.id
      and reprint_of_id is null
      and print_rule_id is null
      and status = 'PENDING'::public.print_job_status;
    return null;
  end if;

  if not exists (
    select 1
    from public.stall_ordering_settings settings
    where settings.stall_id = new.stall_id
      and settings.organization_id = new.organization_id
      and settings.print_module_enabled
  ) then
    return null;
  end if;

  select exists (
    select 1
    from public.print_rules configured_rule
    where configured_rule.stall_id = new.stall_id
      and configured_rule.organization_id = new.organization_id
      and configured_rule.deleted_at is null
  ) into v_has_rules;

  -- No rules keeps the original one-printer confirmation behavior intact.
  if not v_has_rules then
    return null;
  end if;

  select job.id, job.print_rule_id
  into v_root_job_id, v_root_rule_id
  from public.print_jobs job
  where job.order_id = new.id
    and job.reprint_of_id is null
  order by job.created_at asc
  limit 1;

  select rule.id, rule.printer_id, rule.document_type, rule.copies
  into v_first_rule_id, v_first_printer_id, v_first_document_type, v_first_copies
  from public.print_rules rule
  join public.printers printer
    on printer.id = rule.printer_id
   and printer.organization_id = rule.organization_id
   and printer.stall_id = rule.stall_id
   and printer.is_enabled
  where rule.stall_id = new.stall_id
    and rule.organization_id = new.organization_id
    and rule.deleted_at is null
    and rule.is_enabled
    and (
      (v_confirmation_event and rule.trigger = 'ORDER_CONFIRMED'::public.print_trigger)
      or (v_payment_event and rule.trigger = 'PAYMENT_COMPLETED'::public.print_trigger)
    )
    and (cardinality(rule.order_sources) = 0 or new.source = any(rule.order_sources))
    and (cardinality(rule.order_origins) = 0 or new.origin = any(rule.order_origins))
    and (cardinality(rule.fulfillment_types) = 0 or new.fulfillment_type = any(rule.fulfillment_types))
    and (
      (cardinality(rule.product_category_ids) = 0 and cardinality(rule.product_group_ids) = 0)
      or exists (
        select 1
        from public.order_items item
        left join public.products product on product.id = item.product_id
        where item.order_id = new.id
          and (
            (cardinality(rule.product_category_ids) > 0 and product.category_id = any(rule.product_category_ids))
            or (cardinality(rule.product_group_ids) > 0 and product.group_id = any(rule.product_group_ids))
          )
      )
    )
  order by rule.sort_order asc, rule.created_at asc, rule.id asc
  limit 1;

  if v_root_job_id is null and v_first_rule_id is not null then
    insert into public.print_jobs (
      organization_id, stall_id, order_id, printer_id, print_rule_id,
      document_type, status, copies, queued_at, created_at, updated_at
    ) values (
      new.organization_id, new.stall_id, new.id, v_first_printer_id,
      v_first_rule_id, v_first_document_type, 'PENDING'::public.print_job_status,
      v_first_copies, now(), now(), now()
    )
    on conflict do nothing
    returning id into v_root_job_id;
    if v_root_job_id is not null then
      v_root_rule_id := v_first_rule_id;
    end if;
  elsif v_root_job_id is not null and v_root_rule_id is null and v_first_rule_id is not null then
    update public.print_jobs
    set printer_id = v_first_printer_id,
        print_rule_id = v_first_rule_id,
        document_type = v_first_document_type,
        copies = v_first_copies,
        is_routing_copy = false,
        updated_at = now()
    where id = v_root_job_id
      and print_rule_id is null
      and status = 'PENDING'::public.print_job_status
    returning print_rule_id into v_root_rule_id;
  elsif v_confirmation_event and v_root_job_id is not null
        and v_root_rule_id is null and v_first_rule_id is null then
    update public.print_jobs
    set status = 'CANCELLED'::public.print_job_status,
        updated_at = now()
    where id = v_root_job_id
      and print_rule_id is null
      and status = 'PENDING'::public.print_job_status;
  end if;

  if v_root_job_id is null then
    select job.id, job.print_rule_id
    into v_root_job_id, v_root_rule_id
    from public.print_jobs job
    where job.order_id = new.id
      and job.reprint_of_id is null
    order by job.created_at asc
    limit 1;
  end if;

  if v_root_job_id is null then
    return null;
  end if;

  -- Bound each routing event to one compatibility root plus 49 copies.
  insert into public.print_jobs (
    organization_id, stall_id, order_id, printer_id, print_rule_id,
    reprint_of_id, is_routing_copy, document_type, status, copies,
    queued_at, created_at, updated_at
  )
  select
    new.organization_id, new.stall_id, new.id, rule.printer_id, rule.id,
    v_root_job_id, true, rule.document_type, 'PENDING'::public.print_job_status,
    rule.copies, now(), now(), now()
  from public.print_rules rule
  join public.printers printer
    on printer.id = rule.printer_id
   and printer.organization_id = rule.organization_id
   and printer.stall_id = rule.stall_id
   and printer.is_enabled
  where rule.stall_id = new.stall_id
    and rule.organization_id = new.organization_id
    and rule.deleted_at is null
    and rule.is_enabled
    and (v_root_rule_id is null or rule.id <> v_root_rule_id)
    and (
      (v_confirmation_event and rule.trigger = 'ORDER_CONFIRMED'::public.print_trigger)
      or (v_payment_event and rule.trigger = 'PAYMENT_COMPLETED'::public.print_trigger)
    )
    and (cardinality(rule.order_sources) = 0 or new.source = any(rule.order_sources))
    and (cardinality(rule.order_origins) = 0 or new.origin = any(rule.order_origins))
    and (cardinality(rule.fulfillment_types) = 0 or new.fulfillment_type = any(rule.fulfillment_types))
    and (
      (cardinality(rule.product_category_ids) = 0 and cardinality(rule.product_group_ids) = 0)
      or exists (
        select 1
        from public.order_items item
        left join public.products product on product.id = item.product_id
        where item.order_id = new.id
          and (
            (cardinality(rule.product_category_ids) > 0 and product.category_id = any(rule.product_category_ids))
            or (cardinality(rule.product_group_ids) > 0 and product.group_id = any(rule.product_group_ids))
          )
      )
    )
  order by rule.sort_order asc, rule.created_at asc, rule.id asc
  limit 49
  on conflict (order_id, print_rule_id)
    where print_rule_id is not null
      and (reprint_of_id is null or is_routing_copy)
    do nothing;

  return null;
end;
$$;

revoke all on function public.route_integrated_order_print_jobs() from public, anon, authenticated;
grant execute on function public.route_integrated_order_print_jobs() to service_role;
