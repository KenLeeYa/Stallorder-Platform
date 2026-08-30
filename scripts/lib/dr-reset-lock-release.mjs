export class DrResetLockReleaseError extends Error {
  constructor(code) {
    super(code);
    this.name = "DrResetLockReleaseError";
    this.code = code;
  }
}

export const DR_RESET_LOCK_RELEASE_PHASES = Object.freeze([
  phase("application_schemas", "drop schema if exists ", `
    select format('drop schema if exists %I cascade', pn.nspname) as statement
    from pg_namespace pn
    where pn.nspname in ('app_private', 'internal')
    order by pn.nspname
  `),
  phase("extensions", "drop extension if exists ", `
    select format('drop extension if exists %I cascade', p.extname) as statement
    from pg_extension p
    where p.extname not in (
      'pg_graphql',
      'pg_net',
      'pg_stat_statements',
      'pgcrypto',
      'pgjwt',
      'pgsodium',
      'plpgsql',
      'supabase_vault',
      'uuid-ossp'
    )
    order by p.extname
  `),
  phase("routines", "drop routine if exists ", `
    select format(
      'drop routine if exists %I.%I(%s) cascade',
      n.nspname,
      p.proname,
      pg_catalog.pg_get_function_identity_arguments(p.oid)
    ) as statement
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
    order by p.oid
  `),
  phase("views", "drop view if exists ", `
    select format('drop view if exists %I.%I cascade', n.nspname, c.relname) as statement
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'v'
    order by c.oid
  `),
  phase("materialized_views", "drop materialized view if exists ", `
    select format(
      'drop materialized view if exists %I.%I cascade',
      n.nspname,
      c.relname
    ) as statement
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'm'
    order by c.oid
  `),
  phase("relations", "drop table if exists ", `
    select format('drop table if exists %I.%I cascade', n.nspname, c.relname) as statement
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind not in ('c', 'S', 'v', 'm')
    order by c.relkind desc, c.oid
  `),
  phase("sequences", "drop sequence if exists ", `
    select format('drop sequence if exists %I.%I cascade', n.nspname, c.relname) as statement
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'S'
    order by c.oid
  `),
  phase("types", "drop type if exists ", `
    select format('drop type if exists %I.%I cascade', n.nspname, t.typname) as statement
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typtype != 'b'
    order by t.oid
  `),
]);

export async function releaseDrResetLocks(database) {
  let statements = 0;
  for (const currentPhase of DR_RESET_LOCK_RELEASE_PHASES) {
    const rows = await database.$queryRawUnsafe(currentPhase.query);
    if (!Array.isArray(rows)) {
      throw new DrResetLockReleaseError("DR_RESET_DROP_DISCOVERY_INVALID");
    }
    for (const row of rows) {
      const statement = row?.statement;
      if (
        typeof statement !== "string"
        || !statement.startsWith(currentPhase.prefix)
        || statement.length > 16_384
      ) {
        throw new DrResetLockReleaseError("DR_RESET_DROP_STATEMENT_INVALID");
      }
      await database.$executeRawUnsafe(statement);
      statements += 1;
    }
  }
  return {
    phases: DR_RESET_LOCK_RELEASE_PHASES.length,
    statements,
  };
}

function phase(name, prefix, query) {
  return Object.freeze({ name, prefix, query: query.trim() });
}
