-- Integrated print center: connection profiles, routing rules, 57/58 mm and
-- 80 mm layouts, direct device tests, and confirmation/payment event routing.

do $$
begin
  create type public.printer_connection_type as enum (
    'WEBPRNT_BLUETOOTH', 'CLOUDPRNT', 'SYSTEM_PRINT'
  );
exception when duplicate_object then null;
end
$$;

do $$
begin
  create type public.print_document_type as enum (
    'KITCHEN_TICKET', 'CUSTOMER_RECEIPT'
  );
exception when duplicate_object then null;
end
$$;

do $$
begin
  create type public.print_trigger as enum (
    'ORDER_CONFIRMED', 'PAYMENT_COMPLETED'
  );
exception when duplicate_object then null;
end
$$;

do $$
begin
  create type public.print_split_mode as enum (
    'NONE', 'CATEGORY', 'PRODUCT', 'ITEM'
  );
exception when duplicate_object then null;
end
$$;

alter table public.printers
  add column if not exists connection_type public.printer_connection_type not null default 'SYSTEM_PRINT',
  add column if not exists model text not null default 'MCP31LB',
  add column if not exists paper_width_mm integer not null default 58;

alter table public.printers
  add constraint printers_model_length_check check (char_length(model) between 1 and 40),
  add constraint printers_paper_width_check check (paper_width_mm in (58, 80));

create unique index printers_tenant_identity_unique
  on public.printers (id, organization_id, stall_id);

create table public.print_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  printer_id uuid not null,
  name text not null,
  is_enabled boolean not null default true,
  document_type public.print_document_type not null default 'KITCHEN_TICKET',
  trigger public.print_trigger not null default 'ORDER_CONFIRMED',
  order_sources text[] not null default '{}',
  order_origins public.order_origin[] not null default '{}',
  fulfillment_types public.fulfillment_type[] not null default '{}',
  product_category_ids uuid[] not null default '{}',
  product_group_ids uuid[] not null default '{}',
  copies integer not null default 1,
  font_scale integer not null default 1,
  split_mode public.print_split_mode not null default 'NONE',
  aggregate_items boolean not null default false,
  auto_print boolean not null default true,
  sort_order integer not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint print_rules_printer_tenant_fk
    foreign key (printer_id, organization_id, stall_id)
    references public.printers(id, organization_id, stall_id) on delete cascade,
  constraint print_rules_name_length_check check (char_length(name) between 1 and 80),
  constraint print_rules_copies_check check (copies between 1 and 5),
  constraint print_rules_font_scale_check check (font_scale between 1 and 3),
  constraint print_rules_sort_order_check check (sort_order between 0 and 1000),
  constraint print_rules_source_count_check check (cardinality(order_sources) <= 12),
  constraint print_rules_origin_count_check check (cardinality(order_origins) <= 6),
  constraint print_rules_fulfillment_count_check check (cardinality(fulfillment_types) <= 3),
  constraint print_rules_category_count_check check (cardinality(product_category_ids) <= 100),
  constraint print_rules_group_count_check check (cardinality(product_group_ids) <= 200),
  constraint print_rules_receipt_split_check check (
    document_type = 'KITCHEN_TICKET'::public.print_document_type
    or split_mode = 'NONE'::public.print_split_mode
  ),
  constraint print_rules_receipt_scope_check check (
    document_type = 'KITCHEN_TICKET'::public.print_document_type
    or (cardinality(product_category_ids) = 0 and cardinality(product_group_ids) = 0)
  )
);

create unique index print_rules_stall_name_active_unique
  on public.print_rules (stall_id, name)
  where deleted_at is null;
create index print_rules_tenant_enabled_idx
  on public.print_rules (organization_id, stall_id, deleted_at, is_enabled, sort_order);
create index print_rules_printer_idx
  on public.print_rules (printer_id, deleted_at, is_enabled);

alter table public.print_rules enable row level security;
alter table public.print_rules force row level security;
revoke all on table public.print_rules from public, anon, authenticated;
create policy print_rules_authorized_select on public.print_rules
for select to authenticated using (
  app_private.has_stall_role(stall_id, null::public.user_role[])
);

alter table public.print_jobs
  add column if not exists print_rule_id uuid references public.print_rules(id) on delete set null,
  add column if not exists is_routing_copy boolean not null default false,
  add column if not exists document_type public.print_document_type not null default 'KITCHEN_TICKET';

create unique index print_jobs_order_rule_unique
  on public.print_jobs (order_id, print_rule_id)
  where print_rule_id is not null;
create index print_jobs_rule_idx
  on public.print_jobs (print_rule_id, status, queued_at);

comment on table public.print_rules is
  'Per-stall automatic print routing by event, source, fulfillment type, and product catalog scope.';
comment on column public.printers.paper_width_mm is
  'Configured roll width. A 57 mm roll uses the 58 mm profile.';
comment on column public.print_jobs.print_rule_id is
  'Routing rule that generated the immutable printer-ready payload.';

create function public.route_integrated_order_print_jobs()
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
    do nothing;

  return null;
end;
$$;

revoke all on function public.route_integrated_order_print_jobs() from public, anon, authenticated;
grant execute on function public.route_integrated_order_print_jobs() to service_role;

-- This name sorts after the legacy orders_queue_print_job trigger, so the
-- compatibility root job exists before routing fans out to additional printers.
create trigger orders_zz_route_integrated_print_jobs
after insert or update of status, payment_status on public.orders
for each row execute function public.route_integrated_order_print_jobs();
