-- Completed payment corrections are service-owned accounting operations.
-- Direct writes remain immutable; the authorized API transaction must opt in,
-- and cash/non-cash transitions are balanced by immutable cash movements.

create or replace function public.enforce_payment_cash_shift()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_shift public.cash_shifts%rowtype;
  v_validate_paid boolean := false;
  v_authorized_correction boolean := false;
begin
  if tg_op = 'UPDATE' then
    v_authorized_correction := coalesce(
      current_setting('app.payment_method_correction', true),
      ''
    ) = 'authorized'
      and old.status = 'PAID'::public.payment_status
      and new.status = 'PAID'::public.payment_status
      and new.payment_option_id is distinct from old.payment_option_id
      and new.reconciliation_status is not distinct from old.reconciliation_status
      and new.offline_payment_method is not distinct from old.offline_payment_method;

    if v_authorized_correction and new.amount is distinct from old.amount then
      raise exception 'PAYMENT_CASH_SHIFT_IMMUTABLE';
    end if;

    if (
      new.cash_shift_id is distinct from old.cash_shift_id
      or new.method is distinct from old.method
      or (
        new.method = 'CASH'::public.payment_method
        and new.amount is distinct from old.amount
      )
    ) and not v_authorized_correction then
      raise exception 'PAYMENT_CASH_SHIFT_IMMUTABLE';
    end if;
  end if;

  if new.method <> 'CASH'::public.payment_method then
    if new.cash_shift_id is not null then
      raise exception 'NON_CASH_PAYMENT_CANNOT_HAVE_CASH_SHIFT';
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_validate_paid := new.status = 'PAID'::public.payment_status;
  else
    v_validate_paid := new.status = 'PAID'::public.payment_status
      and (
        old.status is distinct from new.status
        or old.method is distinct from new.method
        or old.cash_shift_id is distinct from new.cash_shift_id
      );
  end if;

  if v_validate_paid then
    if new.cash_shift_id is null then
      raise exception 'ACTIVE_CASH_SHIFT_REQUIRED';
    end if;
    select * into v_shift
    from public.cash_shifts shift
    where shift.id = new.cash_shift_id
    for update;
    if not found
       or v_shift.organization_id <> new.organization_id
       or v_shift.stall_id <> new.stall_id
       or v_shift.status <> 'OPEN'::public.cash_shift_status then
      raise exception 'ACTIVE_CASH_SHIFT_REQUIRED';
    end if;
  end if;

  return new;
end;
$$;
