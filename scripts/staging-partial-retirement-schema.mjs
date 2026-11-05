// Catalog/sequence slice, not a complete environment or continuation proof.
// Expected values must be derived from authenticated original restore + replay.
import { isDeepStrictEqual } from "node:util";
import { conversionQuery } from "./dr-staging-conversion-plan.mjs";

const schemas = ["public", "auth", "storage", "vault"];
const kinds = ["schema", "relation", "column", "type", "routine", "constraint", "index", "trigger", "internalTrigger", "rule", "policy", "defaultAcl"];
const literal = value => `'${value.replaceAll("'", "''")}'`;
const identifier = value => `"${value.replaceAll('"', '""')}"`;
const validName = value => typeof value === "string" && value.length > 0 && !value.includes("\0") && Buffer.byteLength(value) <= 63;
const ordered = rows => [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
function requireSchema(condition) { if (!condition) throw new Error("STAGING_PARTIAL_SCHEMA_INVALID"); }
function sequenceNames(sequences) {
  requireSchema(Array.isArray(sequences) && sequences.length <= 1000 && sequences.every(s => s
    && isDeepStrictEqual(Object.keys(s).sort(), ["name", "schema"]) && schemas.includes(s.schema) && validName(s.name))
    && new Set(sequences.map(s => JSON.stringify([s.schema, s.name]))).size === sequences.length);
  return sequences;
}

// Deparsers are evaluated under a compared search_path/major version. Nothing
// silently rewrites SQL definitions, ACLs or owners to make a mismatch pass.
// Internal RI trigger identities bind their constraint/type/function rather
// than unstable OID-based names. Their enabled/argument/deferral state is compared.
export function remainingSchemaQuery(sequences) {
  sequenceNames(sequences);
  const states = sequences.length ? sequences.map(s => `select ${literal(s.schema)} as schema,${literal(s.name)} as name,
    last_value::pg_catalog.text as value,is_called as called from ${identifier(s.schema)}.${identifier(s.name)}`).join(" union all ")
    : "select null::pg_catalog.text as schema,null::pg_catalog.text as name,null::pg_catalog.text as value,false as called where false";
  const object = (kind, catalog, id, definition, from) => `select ${literal(kind)} as kind,
    'pg_catalog.${catalog}'::pg_catalog.regclass::pg_catalog.oid as classid,${id} as objid,0 as objsubid,${definition} as definition from ${from}`;
  const objects = [
    object("schema", "pg_namespace", "n.oid", "pg_catalog.jsonb_build_object('owner',pg_catalog.pg_get_userbyid(n.nspowner),'acl',n.nspacl)", "ns n"),
    object("relation", "pg_class", "c.oid", `pg_catalog.jsonb_build_object('kind',c.relkind,'owner',pg_catalog.pg_get_userbyid(c.relowner),
      'acl',c.relacl,'persistence',c.relpersistence,'options',c.reloptions,'rowSecurity',c.relrowsecurity,
      'forceRowSecurity',c.relforcerowsecurity,'replicaIdentity',c.relreplident,'accessMethod',am.amname,
      'toastOptions',(select x.reloptions from pg_catalog.pg_class x where x.oid=c.reltoastrelid),
      'view',case when c.relkind in ('v','m') then pg_catalog.pg_get_viewdef(c.oid,false) end,
      'partition',c.relispartition,'partitionBound',pg_catalog.pg_get_expr(c.relpartbound,c.oid,false),
      'partitionKey',case when c.relkind='p' then pg_catalog.pg_get_partkeydef(c.oid) end,
      'parents',(select coalesce(pg_catalog.jsonb_agg(i.inhparent::pg_catalog.regclass::pg_catalog.text order by i.inhseqno),'[]') from pg_catalog.pg_inherits i where i.inhrelid=c.oid),
      'sequence',(select pg_catalog.jsonb_build_object('type',pg_catalog.format_type(s.seqtypid,null),'start',s.seqstart::pg_catalog.text,
        'increment',s.seqincrement::pg_catalog.text,'min',s.seqmin::pg_catalog.text,'max',s.seqmax::pg_catalog.text,'cache',s.seqcache::pg_catalog.text,'cycle',s.seqcycle)
        from pg_catalog.pg_sequence s where s.seqrelid=c.oid))`, "rels c left join pg_catalog.pg_am am on am.oid=c.relam"),
    `select 'column','pg_catalog.pg_class'::pg_catalog.regclass::pg_catalog.oid,a.attrelid,a.attnum::pg_catalog.int4,
      pg_catalog.jsonb_build_object('type',pg_catalog.format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
        'ordinal',pg_catalog.row_number() over(partition by a.attrelid order by a.attnum),
        'collation',case when a.attcollation<>0 then a.attcollation::pg_catalog.regcollation::pg_catalog.text end,
        'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid,false),'identity',a.attidentity,'generated',a.attgenerated,
        'storage',a.attstorage,'compression',a.attcompression,'statistics',a.attstattarget,
        'options',a.attoptions,'fdwOptions',a.attfdwoptions,'acl',a.attacl)
      from pg_catalog.pg_attribute a join rels c on c.oid=a.attrelid left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attnum>0 and not a.attisdropped`,
    object("type", "pg_type", "t.oid", `pg_catalog.jsonb_build_object('kind',t.typtype,'owner',pg_catalog.pg_get_userbyid(t.typowner),'acl',t.typacl,
      'defined',t.typisdefined,'length',t.typlen,'byValue',t.typbyval,'category',t.typcategory,'preferred',t.typispreferred,
      'delimiter',t.typdelim,'alignment',t.typalign,'storage',t.typstorage,'notNull',t.typnotnull,
      'base',pg_catalog.format_type(t.typbasetype,t.typtypmod),'element',pg_catalog.format_type(t.typelem,null),
      'array',pg_catalog.format_type(t.typarray,null),'relation',case when t.typrelid<>0 then t.typrelid::pg_catalog.regclass::pg_catalog.text end,
      'collation',case when t.typcollation<>0 then t.typcollation::pg_catalog.regcollation::pg_catalog.text end,
      'default',t.typdefault,'defaultExpression',pg_catalog.pg_get_expr(t.typdefaultbin,0,false),
      'input',t.typinput::pg_catalog.regprocedure::pg_catalog.text,'output',t.typoutput::pg_catalog.regprocedure::pg_catalog.text,
      'receive',t.typreceive::pg_catalog.regprocedure::pg_catalog.text,'send',t.typsend::pg_catalog.regprocedure::pg_catalog.text,
      'typmodIn',t.typmodin::pg_catalog.regprocedure::pg_catalog.text,'typmodOut',t.typmodout::pg_catalog.regprocedure::pg_catalog.text,'analyze',t.typanalyze::pg_catalog.regprocedure::pg_catalog.text,
      'enum',(select coalesce(pg_catalog.jsonb_agg(e.enumlabel order by e.enumsortorder),'[]') from pg_catalog.pg_enum e where e.enumtypid=t.oid),
      'range',(select pg_catalog.jsonb_build_object('subtype',pg_catalog.format_type(r.rngsubtype,null),'multirange',pg_catalog.format_type(r.rngmultitypid,null),
        'collation',case when r.rngcollation<>0 then r.rngcollation::pg_catalog.regcollation::pg_catalog.text end,
        'opclass',(select i.identity from pg_catalog.pg_identify_object('pg_catalog.pg_opclass'::pg_catalog.regclass,r.rngsubopc,0) i),
        'canonical',r.rngcanonical::pg_catalog.regprocedure::pg_catalog.text,'difference',r.rngsubdiff::pg_catalog.regprocedure::pg_catalog.text)
        from pg_catalog.pg_range r where r.rngtypid=t.oid))`, "pg_type t join ns n on n.oid=t.typnamespace"),
    object("routine", "pg_proc", "p.oid", `pg_catalog.jsonb_build_object('definition',pg_catalog.pg_get_functiondef(p.oid),
      'owner',pg_catalog.pg_get_userbyid(p.proowner),'acl',p.proacl,'kind',p.prokind,'leakproof',p.proleakproof)`,
    "pg_proc p join ns n on n.oid=p.pronamespace where p.prokind<>'a'"),
    object("constraint", "pg_constraint", "c.oid", `pg_catalog.jsonb_build_object('definition',pg_catalog.pg_get_constraintdef(c.oid,false),
      'type',c.contype,'validated',c.convalidated,'local',c.conislocal,'inheritance',c.coninhcount,'noInherit',c.connoinherit)`,
    "pg_constraint c join ns n on n.oid=c.connamespace"),
    object("index", "pg_class", "i.indexrelid", `pg_catalog.jsonb_build_object('definition',pg_catalog.pg_get_indexdef(i.indexrelid,0,false),
      'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive,'replicaIdentity',i.indisreplident,
      'clustered',i.indisclustered,'immediate',i.indimmediate,'nullsNotDistinct',i.indnullsnotdistinct)`,
    "pg_index i join rels c on c.oid=i.indexrelid"),
    object("trigger", "pg_trigger", "t.oid", `pg_catalog.jsonb_build_object('definition',pg_catalog.pg_get_triggerdef(t.oid,false),'enabled',t.tgenabled)`,
    "pg_trigger t join rels c on c.oid=t.tgrelid where not t.tgisinternal"),
    object("internalTrigger", "pg_trigger", "t.oid", `pg_catalog.jsonb_build_object('type',t.tgtype,'enabled',t.tgenabled,
      'function',t.tgfoid::pg_catalog.regprocedure::pg_catalog.text,'arguments',pg_catalog.encode(t.tgargs,'base64'),
      'relation',t.tgrelid::pg_catalog.regclass::pg_catalog.text,'referencedRelation',case when t.tgconstrrelid<>0 then t.tgconstrrelid::pg_catalog.regclass::pg_catalog.text end,
      'deferrable',t.tgdeferrable,'deferred',t.tginitdeferred,
      'columns',(select coalesce(pg_catalog.jsonb_agg(a.attname order by x.ordinality),'[]') from pg_catalog.unnest(t.tgattr::pg_catalog.int2[]) with ordinality x(num,ordinality)
        join pg_catalog.pg_attribute a on a.attrelid=t.tgrelid and a.attnum=x.num))`,
    "pg_trigger t join rels c on c.oid=t.tgrelid where t.tgisinternal"),
    object("rule", "pg_rewrite", "r.oid", `pg_catalog.jsonb_build_object('definition',pg_catalog.pg_get_ruledef(r.oid,false),'enabled',r.ev_enabled)`,
    "pg_rewrite r join rels c on c.oid=r.ev_class"),
    object("policy", "pg_policy", "p.oid", `pg_catalog.jsonb_build_object('command',p.polcmd,'permissive',p.polpermissive,
      'roles',(select pg_catalog.jsonb_agg(case when roleid=0 then 'public' else pg_catalog.pg_get_userbyid(roleid)::pg_catalog.text end order by roleid=0,pg_catalog.pg_get_userbyid(roleid))
        from pg_catalog.unnest(p.polroles) roleid),'using',pg_catalog.pg_get_expr(p.polqual,p.polrelid,false),
      'check',pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid,false))`, "pg_policy p join rels c on c.oid=p.polrelid"),
    object("defaultAcl", "pg_default_acl", "d.oid", `pg_catalog.jsonb_build_object('owner',pg_catalog.pg_get_userbyid(d.defaclrole),'type',d.defaclobjtype,'acl',d.defaclacl)`,
    "pg_default_acl d join ns n on n.oid=d.defaclnamespace"),
  ].join("\nunion all\n");
  // Specialty DDL not represented above is a rejection, never silently ignored.
  const unsupported = [
    "select p.oid from pg_catalog.pg_proc p join ns n on n.oid=p.pronamespace where p.prokind='a'",
    ...[["pg_collation", "collnamespace"], ["pg_conversion", "connamespace"], ["pg_operator", "oprnamespace"],
      ["pg_opclass", "opcnamespace"], ["pg_opfamily", "opfnamespace"], ["pg_ts_config", "cfgnamespace"],
      ["pg_ts_dict", "dictnamespace"], ["pg_ts_parser", "prsnamespace"], ["pg_ts_template", "tmplnamespace"],
      ["pg_statistic_ext", "stxnamespace"]].map(([table, field]) => `select x.oid from pg_catalog.${table} x join ns n on n.oid=x.${field}`),
    "select c.oid from rels c where c.relkind not in ('r','v','m','S','i','I','c')",
    "select t.oid from pg_catalog.pg_trigger t join rels c on c.oid=t.tgrelid where t.tgisinternal and (t.tgconstraint=0 or t.tgqual is not null or t.tgparentid<>0)",
  ].join(" union all ");
  return `with ns as (select * from pg_catalog.pg_namespace where nspname in (${schemas.map(literal).join(",")})),
    rels as (select c.* from pg_catalog.pg_class c join ns n on n.oid=c.relnamespace),
    objects as (${objects}),
    addresses as (select distinct classid,objid,objsubid from objects),
    named as (select o.*,case when o.kind='internalTrigger' then
      (select c.identity||'/'||t.tgtype||'/'||t.tgfoid::pg_catalog.regprocedure::pg_catalog.text from pg_catalog.pg_trigger t
        cross join lateral pg_catalog.pg_identify_object('pg_catalog.pg_constraint'::pg_catalog.regclass,t.tgconstraint,0) c where t.oid=o.objid)
      else i.identity end as identity from objects o cross join lateral pg_catalog.pg_identify_object(o.classid,o.objid,o.objsubid) i),
    dependencies as (select distinct d.* from pg_catalog.pg_depend d where
      exists(select 1 from addresses a where a.classid=d.classid and a.objid=d.objid and a.objsubid=d.objsubid)
      or exists(select 1 from addresses a where a.classid=d.refclassid and a.objid=d.refobjid and a.objsubid=d.refobjsubid))
    select pg_catalog.jsonb_build_object('version',1,'serverMajor',pg_catalog.current_setting('server_version_num')::pg_catalog.int4/10000,
      'searchPath',pg_catalog.current_setting('search_path'),'retiredSchemas',(select pg_catalog.count(*) from pg_catalog.pg_namespace where nspname in ('app_private','internal')),
      'unsupported',(select pg_catalog.count(*) from (${unsupported}) x),
      'objects',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('kind',kind,'identity',identity,
        'definition',definition || pg_catalog.jsonb_build_object('comment',case when kind='column' then pg_catalog.col_description(objid,objsubid)
          else pg_catalog.obj_description(objid,classid::pg_catalog.regclass::pg_catalog.text) end))
        order by kind collate "C",identity collate "C"),'[]') from named),
      'dependencies',(select coalesce(pg_catalog.jsonb_agg(distinct pg_catalog.jsonb_build_object('type',d.deptype,
        'fromType',f.type,'from',case when f.type='toast table' and d.deptype='i'
          and d.classid='pg_catalog.pg_class'::pg_catalog.regclass and d.refclassid='pg_catalog.pg_class'::pg_catalog.regclass
          and exists(select 1 from rels owner where owner.reltoastrelid=d.objid and owner.oid=d.refobjid)
          then 'TOAST FOR '||t.identity else f.identity end,'toType',t.type,'to',t.identity)),'[]') from dependencies d
        cross join lateral pg_catalog.pg_identify_object(d.classid,d.objid,d.objsubid) f
        cross join lateral pg_catalog.pg_identify_object(d.refclassid,d.refobjid,d.refobjsubid) t
        where not (d.classid='pg_catalog.pg_trigger'::pg_catalog.regclass and exists(select 1 from pg_catalog.pg_trigger g where g.oid=d.objid and g.tgisinternal))),
      'sharedDependencies',(select coalesce(pg_catalog.jsonb_agg(distinct pg_catalog.jsonb_build_object('type',d.deptype,
        'objectType',i.type,'object',i.identity,'role',r.rolname)),'[]') from pg_catalog.pg_shdepend d
        join addresses a on a.classid=d.classid and a.objid=d.objid and a.objsubid=d.objsubid
        join pg_catalog.pg_roles r on d.refclassid='pg_catalog.pg_authid'::pg_catalog.regclass and r.oid=d.refobjid
        cross join lateral pg_catalog.pg_identify_object(d.classid,d.objid,d.objsubid) i
        where d.dbid=(select oid from pg_catalog.pg_database where datname=pg_catalog.current_database())),
      'sequences',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('schema',n.nspname,'name',c.relname)),'[]')
        from rels c join ns n on n.oid=c.relnamespace where c.relkind='S'),
      'sequenceStates',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(s)),'[]') from (${states}) s)) as remaining_schema;`;
}

// Private in-memory catalog. Never log/upload definitions, hashes or sequences.
export function validateRemainingSchema(snapshot, withStates = true) {
  requireSchema(snapshot && isDeepStrictEqual(Object.keys(snapshot).sort(), ["dependencies", "objects", "retiredSchemas", "searchPath",
    "sequenceStates", "sequences", "serverMajor", "sharedDependencies", "unsupported", "version"])
    && snapshot.version === 1 && snapshot.serverMajor === 17 && typeof snapshot.searchPath === "string"
    && snapshot.retiredSchemas === 0 && snapshot.unsupported === 0
    && Array.isArray(snapshot.objects) && snapshot.objects.length > 0 && snapshot.objects.length <= 100_000
    && snapshot.objects.every(o => o && kinds.includes(o.kind) && typeof o.identity === "string" && o.identity.length > 0
      && o.definition && typeof o.definition === "object" && !Array.isArray(o.definition)
      && isDeepStrictEqual(Object.keys(o).sort(), ["definition", "identity", "kind"]))
    && new Set(snapshot.objects.map(o => JSON.stringify([o.kind,o.identity]))).size === snapshot.objects.length);
  for (const [name, keys] of [["dependencies", ["from", "fromType", "to", "toType", "type"]],
    ["sharedDependencies", ["object", "objectType", "role", "type"]]]) {
    requireSchema(Array.isArray(snapshot[name]) && snapshot[name].length <= 300_000 && snapshot[name].every(d => d
      && isDeepStrictEqual(Object.keys(d).sort(), keys) && Object.values(d).every(v => typeof v === "string" && v.length > 0)));
  }
  sequenceNames(snapshot.sequences);
  requireSchema(Array.isArray(snapshot.sequenceStates) && snapshot.sequenceStates.every(s => s
    && isDeepStrictEqual(Object.keys(s).sort(), ["called", "name", "schema", "value"])
    && /^-?\d+$/.test(s.value) && typeof s.value === "string" && typeof s.called === "boolean"));
  if (withStates) requireSchema(isDeepStrictEqual(ordered(snapshot.sequenceStates.map(({schema,name}) => ({schema,name}))), ordered(snapshot.sequences)));
  return snapshot;
}

// Only the isolated restore adapter supplies this executor. There are no target
// parameters or hosted writes; a second SELECT adds exact last_value/is_called.
export function captureRemainingSchema(sql) {
  try {
    const catalog = validateRemainingSchema(JSON.parse(sql(remainingSchemaQuery([]))), false);
    return validateRemainingSchema(JSON.parse(sql(remainingSchemaQuery(catalog.sequences))));
  } catch { throw new Error("STAGING_PARTIAL_SCHEMA_CAPTURE_FAILED"); }
}

export async function compareRemainingSchemaReadOnly(expected) {
  validateRemainingSchema(expected);
  let rows;
  try { rows = await conversionQuery(remainingSchemaQuery(expected.sequences), true); }
  catch { throw new Error("STAGING_PARTIAL_SCHEMA_READ_FAILED"); }
  requireSchema(Array.isArray(rows) && rows.length === 1);
  return matchRemainingSchema(expected, rows[0]?.remaining_schema);
}

export function matchRemainingSchema(expected, value) {
  validateRemainingSchema(expected);
  const actual = validateRemainingSchema(value);
  const normalize = snapshot => ({ ...snapshot, ...Object.fromEntries(["objects", "dependencies", "sharedDependencies", "sequences", "sequenceStates"]
    .map(key => [key, ordered(snapshot[key])])) });
  if (!isDeepStrictEqual(normalize(actual), normalize(expected))) throw new Error("STAGING_PARTIAL_SCHEMA_MISMATCH");
  return { diagnosticOnly: true, planQualified: false, remainingDataProven: false, remainingSchemaProven: false,
    remainingCatalogMatched: true, sequenceStateMatched: true, objectCount: actual.objects.length, sequenceCount: actual.sequences.length };
}
