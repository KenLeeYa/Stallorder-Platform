begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(1);

select matches(
  (
    select pg_get_expr(attribute.adbin, attribute.adrelid)
    from pg_attrdef attribute
    join pg_attribute column_definition
      on column_definition.attrelid = attribute.adrelid
     and column_definition.attnum = attribute.adnum
    where attribute.adrelid = 'public.stall_ordering_settings'::regclass
      and column_definition.attname = 'print_module_enabled'
  ),
  '^false(::boolean)?$',
  'printer module remains opt-in for each stall'
);

select * from finish();
rollback;
