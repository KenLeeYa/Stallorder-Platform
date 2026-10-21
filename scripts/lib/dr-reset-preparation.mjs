// Supabase CLI 2.109.1's remote drop.sql checks relkind='s', but PostgreSQL
// sequences use 'S'. Standalone invoice_number_seq therefore survives reset.
// Only invoke after backup/isolation gates, on the retired DR or its offline copy.
export const retiredDrSequenceCleanupSql = `do $$ declare item record; begin
  for item in
    select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'S'
      and not exists(select 1 from pg_depend d where d.classid = 'pg_class'::regclass
        and d.objid = c.oid and d.deptype = 'e')
  loop
    execute format('drop sequence %I.%I cascade', item.nspname, item.relname);
  end loop;
end $$;`;
