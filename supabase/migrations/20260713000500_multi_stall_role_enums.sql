alter type public.tenant_status add value if not exists 'PAST_DUE';
alter type public.tenant_status add value if not exists 'GRACE_PERIOD';

alter type public.user_role add value if not exists 'ORGANIZATION_OWNER';
alter type public.user_role add value if not exists 'ORGANIZATION_ADMIN';
alter type public.user_role add value if not exists 'FINANCE_VIEWER';
alter type public.user_role add value if not exists 'STALL_MANAGER';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'stall_business_status') then
    create type public.stall_business_status as enum ('OPEN', 'PAUSED', 'CLOSED', 'SOLD_OUT');
  end if;
end;
$$;
