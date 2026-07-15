create or replace function public.enforce_extended_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_stall_id uuid;
begin
  if tg_table_name = 'product_translations' then
    select organization_id into v_organization_id from public.products where id = new.product_id;
    if v_organization_id is null or v_organization_id <> new.organization_id then raise exception 'PRODUCT_TRANSLATION_SCOPE_MISMATCH'; end if;
    return new;
  end if;

  if tg_table_name in ('dining_tables', 'payment_options', 'discount_options') then
    select organization_id into v_organization_id from public.stalls where id = new.stall_id;
    if v_organization_id is null or v_organization_id <> new.organization_id then raise exception 'STALL_CONFIGURATION_SCOPE_MISMATCH'; end if;
    return new;
  end if;

  if tg_table_name = 'qr_codes' then
    if new.dining_table_id is not null then
      select organization_id, stall_id into v_organization_id, v_stall_id from public.dining_tables where id = new.dining_table_id;
      if v_organization_id is null or v_organization_id <> new.organization_id or v_stall_id <> new.stall_id then raise exception 'QR_TABLE_SCOPE_MISMATCH'; end if;
    end if;
    return new;
  end if;

  if tg_table_name = 'orders' then
    if new.dining_table_id is not null then
      select organization_id, stall_id into v_organization_id, v_stall_id from public.dining_tables where id = new.dining_table_id;
      if v_organization_id is null or v_organization_id <> new.organization_id or v_stall_id <> new.stall_id then raise exception 'ORDER_TABLE_SCOPE_MISMATCH'; end if;
    end if;
    if new.discount_option_id is not null and not exists (
      select 1 from public.discount_options discount
      where discount.id = new.discount_option_id and discount.organization_id = new.organization_id and discount.stall_id = new.stall_id
    ) then raise exception 'ORDER_DISCOUNT_SCOPE_MISMATCH'; end if;
    return new;
  end if;

  if tg_table_name = 'payments' then
    if new.payment_option_id is not null and not exists (
      select 1 from public.payment_options option_record
      where option_record.id = new.payment_option_id and option_record.organization_id = new.organization_id and option_record.stall_id = new.stall_id
    ) then raise exception 'PAYMENT_OPTION_SCOPE_MISMATCH'; end if;
    return new;
  end if;
  return new;
end;
$$;
