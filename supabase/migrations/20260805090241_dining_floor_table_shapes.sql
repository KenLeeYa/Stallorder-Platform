do $$
begin
  create type public.dining_table_shape as enum (
    'CIRCLE',
    'ELLIPSE',
    'SQUARE',
    'RECTANGLE',
    'DIAMOND',
    'TRIANGLE'
  );
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.dining_floors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dining_floors_stall_name_key unique (stall_id, name),
  constraint dining_floors_name_check check (char_length(name) between 1 and 40),
  constraint dining_floors_sort_order_check check (sort_order between 0 and 10000)
);

create index if not exists dining_floors_organization_stall_sort_idx
  on public.dining_floors (organization_id, stall_id, sort_order, name);

alter table public.dining_tables
  add column if not exists floor_id uuid,
  add column if not exists shape public.dining_table_shape not null default 'SQUARE',
  add column if not exists rotation_degrees smallint not null default 0;

alter table public.dining_tables
  drop constraint if exists dining_tables_floor_id_fkey,
  add constraint dining_tables_floor_id_fkey
    foreign key (floor_id) references public.dining_floors(id) on delete restrict,
  drop constraint if exists dining_tables_rotation_degrees_check,
  add constraint dining_tables_rotation_degrees_check check (
    rotation_degrees between 0 and 345
    and mod(rotation_degrees, 15) = 0
  );

create index if not exists dining_tables_stall_floor_sort_idx
  on public.dining_tables (stall_id, floor_id, sort_order, label);

create or replace function public.enforce_dining_floor_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_organization_id uuid;
begin
  select organization_id
  into v_organization_id
  from public.stalls
  where id = new.stall_id;

  if v_organization_id is null or v_organization_id <> new.organization_id then
    raise exception 'DINING_FLOOR_STALL_SCOPE_MISMATCH';
  end if;

  return new;
end;
$$;

create or replace function public.enforce_dining_table_floor_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_stall_id uuid;
begin
  if new.floor_id is null then
    return new;
  end if;

  select organization_id, stall_id
  into v_organization_id, v_stall_id
  from public.dining_floors
  where id = new.floor_id;

  if v_organization_id is null
     or v_organization_id <> new.organization_id
     or v_stall_id <> new.stall_id then
    raise exception 'DINING_TABLE_FLOOR_SCOPE_MISMATCH';
  end if;

  return new;
end;
$$;

drop trigger if exists dining_floors_scope_before_write on public.dining_floors;
create trigger dining_floors_scope_before_write
before insert or update of organization_id, stall_id
on public.dining_floors
for each row execute function public.enforce_dining_floor_scope();

drop trigger if exists dining_tables_floor_scope_before_write on public.dining_tables;
create trigger dining_tables_floor_scope_before_write
before insert or update of organization_id, stall_id, floor_id
on public.dining_tables
for each row execute function public.enforce_dining_table_floor_scope();

alter table public.dining_floors enable row level security;
alter table public.dining_floors force row level security;

revoke all on table public.dining_floors from public, anon, authenticated;
grant select on table public.dining_floors to authenticated;
grant select, insert, update, delete on table public.dining_floors to service_role;

drop policy if exists dining_floors_authorized_select on public.dining_floors;
create policy dining_floors_authorized_select on public.dining_floors
for select to authenticated using (app_private.can_access_stall(stall_id));

revoke all on function public.enforce_dining_floor_scope() from public, anon, authenticated;
grant execute on function public.enforce_dining_floor_scope() to service_role;
revoke all on function public.enforce_dining_table_floor_scope() from public, anon, authenticated;
grant execute on function public.enforce_dining_table_floor_scope() to service_role;
