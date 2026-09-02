-- Explicit single-stall versus multi-stall presentation mode.
-- Existing organizations with multiple active stalls keep the multi-stall UI.

alter table public.organizations
  add column operating_mode varchar(20) not null default 'SINGLE_STALL';

update public.organizations organization
set operating_mode = 'MULTI_STALL'
where (
  select count(*)
  from public.stalls stall
  where stall.organization_id = organization.id
    and stall.is_active = true
) > 1;

alter table public.organizations
  add constraint organizations_operating_mode_check
  check (operating_mode in ('SINGLE_STALL', 'MULTI_STALL'));
