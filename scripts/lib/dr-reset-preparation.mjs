// Supabase CLI 2.109.1's remote drop.sql checks relkind='s', but PostgreSQL
// sequences use 'S'. Standalone invoice_number_seq therefore survives reset.
// Owned/identity sequences are removed with their tables by the CLI; dropping an
// identity sequence directly is rejected by PostgreSQL even with CASCADE.
// Only invoke after backup/isolation gates, on the retired DR or its offline copy.
export const retiredDrSequenceCleanupSql = `do $$ declare item record; begin
  for item in
    select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'S'
      and not exists(select 1 from pg_depend d where d.classid = 'pg_class'::regclass
        and d.objid = c.oid and d.deptype in ('e', 'a', 'i'))
  loop
    execute format('drop sequence %I.%I cascade', item.nspname, item.relname);
  end loop;
end $$;`;

// Hosted postgres owns the jobs, but cannot UPDATE the provider-owned cron table.
export const disableStagingCronsSql = "select cron.alter_job(jobid, active := false) from cron.job where active;";

// Applied only after a qualified empty reset and the unchanged development seed.
// The development bestseller fixtures deliberately use is_test=false; persistent
// Staging must never treat them as live sales or offer an active hardware queue.
export const syntheticStagingSafetySql = `do $$ begin
  if (select count(*) from public.organizations) <> 2
    or exists(select 1 from public.organizations where id not in (
      '11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111112'))
    or exists(select 1 from public.orders where source is distinct from 'DEMO_BESTSELLER_SEED') then
    raise exception 'STAGING_SEED_SCOPE_INVALID';
  end if;
  update public.orders set is_test = true;
  update public.printers set is_enabled = false;
  update public.payment_options set is_enabled = false where kind <> 'CASH';
end $$;`;
