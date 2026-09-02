alter table public.operating_expenses
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by_profile_id uuid,
  add column if not exists void_reason varchar(300),
  add column if not exists corrects_expense_id uuid;

alter table public.operating_expenses
  add constraint operating_expenses_voided_by_profile_fkey
  foreign key (voided_by_profile_id)
  references public.profiles(id)
  on delete restrict;

alter table public.operating_expenses
  add constraint operating_expenses_corrects_expense_fkey
  foreign key (corrects_expense_id)
  references public.operating_expenses(id)
  on delete restrict;

alter table public.operating_expenses
  add constraint operating_expenses_void_audit_check
  check (
    (
      voided_at is null
      and voided_by_profile_id is null
      and void_reason is null
    )
    or (
      voided_at is not null
      and voided_by_profile_id is not null
      and char_length(btrim(void_reason)) between 2 and 300
    )
  );

alter table public.operating_expenses
  add constraint operating_expenses_correction_not_self_check
  check (corrects_expense_id is null or corrects_expense_id <> id);

create index if not exists operating_expenses_active_period_idx
  on public.operating_expenses (organization_id, expense_date desc, category)
  where voided_at is null;

create unique index if not exists operating_expenses_one_replacement_idx
  on public.operating_expenses (organization_id, corrects_expense_id)
  where corrects_expense_id is not null;
