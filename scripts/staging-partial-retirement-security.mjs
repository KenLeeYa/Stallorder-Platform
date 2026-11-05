// CURRENT global facts only. The six-schema backup did not capture global roles
// or settings. Never label these facts historical equivalence, safety or authority.
import { isDeepStrictEqual } from "node:util";
import { conversionQuery } from "./dr-staging-conversion-plan.mjs";

export function currentPartialSecurityQuery() {
  return `select pg_catalog.jsonb_build_object('version',1,
    'serverMajor',pg_catalog.current_setting('server_version_num')::pg_catalog.int4/10000,
    'database',(select pg_catalog.jsonb_build_object('owner',pg_catalog.pg_get_userbyid(d.datdba),'acl',d.datacl,
      'encoding',d.encoding,'collate',d.datcollate,'ctype',d.datctype,'localeProvider',d.datlocprovider,
      'locale',d.datlocale,'collationVersion',d.datcollversion) from pg_catalog.pg_database d
      where d.datname=pg_catalog.current_database()),
    'roles',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',r.rolname,
      'superuser',r.rolsuper,'inherit',r.rolinherit,'createRole',r.rolcreaterole,'createDatabase',r.rolcreatedb,
      'login',r.rolcanlogin,'replication',r.rolreplication,'bypassRls',r.rolbypassrls,
      'connectionLimit',r.rolconnlimit,'validUntil',r.rolvaliduntil::pg_catalog.text,
      'settings',coalesce(r.rolconfig,'{}'::pg_catalog.text[])) order by r.rolname) from pg_catalog.pg_roles r),
    'memberships',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'role',pg_catalog.pg_get_userbyid(m.roleid),'member',pg_catalog.pg_get_userbyid(m.member),
      'grantor',pg_catalog.pg_get_userbyid(m.grantor),'admin',m.admin_option,
      'inherit',m.inherit_option,'set',m.set_option)),'[]') from pg_catalog.pg_auth_members m),
    'roleSettings',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'scope',case when s.setdatabase=0 then 'all-databases' else 'current-database' end,
      'role',case when s.setrole=0 then null else pg_catalog.pg_get_userbyid(s.setrole)::pg_catalog.text end,
      'settings',s.setconfig)),'[]') from pg_catalog.pg_db_role_setting s
      where s.setdatabase=0 or s.setdatabase=(select oid from pg_catalog.pg_database where datname=pg_catalog.current_database())),
    'extensions',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',e.extname,
      'owner',pg_catalog.pg_get_userbyid(e.extowner),'schema',n.nspname,'version',e.extversion,
      'relocatable',e.extrelocatable,'tables',(select coalesce(pg_catalog.jsonb_agg(x.rel::pg_catalog.regclass::pg_catalog.text order by x.ordinality),'[]')
        from pg_catalog.unnest(e.extconfig) with ordinality x(rel,ordinality)),
      'conditions',coalesce(e.extcondition,'{}'::pg_catalog.text[]))),'[]')
      from pg_catalog.pg_extension e join pg_catalog.pg_namespace n on n.oid=e.extnamespace),
    'eventTriggers',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',e.evtname,
      'owner',pg_catalog.pg_get_userbyid(e.evtowner),'event',e.evtevent,'enabled',e.evtenabled,
      'tags',coalesce(e.evttags,'{}'::pg_catalog.text[]),'function',e.evtfoid::pg_catalog.regprocedure::pg_catalog.text,
      'definition',pg_catalog.pg_get_functiondef(e.evtfoid))),'[]') from pg_catalog.pg_event_trigger e),
    'securityLabels',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('type',i.type,
      'object',i.identity,'provider',s.provider,'label',s.label)),'[]') from pg_catalog.pg_seclabel s
      cross join lateral pg_catalog.pg_identify_object(s.classoid,s.objoid,s.objsubid) i),
    'sharedSecurityLabels',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('type',i.type,
      'object',i.identity,'provider',s.provider,'label',s.label)),'[]') from pg_catalog.pg_shseclabel s
      cross join lateral pg_catalog.pg_identify_object(s.classoid,s.objoid,0) i),
    'globalDefaultAcls',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'owner',pg_catalog.pg_get_userbyid(d.defaclrole),'type',d.defaclobjtype,'acl',d.defaclacl)),'[]')
      from pg_catalog.pg_default_acl d where d.defaclnamespace=0)) as current_global_security;`;
}

const text = value => typeof value === "string" && !value.includes("\0");
const name = value => text(value) && value.length > 0 && Buffer.byteLength(value) <= 63;
const strings = value => Array.isArray(value) && value.length <= 10_000 && value.every(text);
const keys = (value, fields) => value && typeof value === "object" && !Array.isArray(value)
  && isDeepStrictEqual(Object.keys(value).sort(), [...fields].sort());
function requireSecurity(condition) { if (!condition) throw new Error("STAGING_PARTIAL_SECURITY_INVALID"); }
function rows(values, fields, valid) {
  requireSecurity(Array.isArray(values) && values.length <= 10_000 && values.every(row => keys(row, fields) && valid(row)));
}

// Private because settings, security labels and event-trigger definitions can
// contain credentials. No rolpassword/pg_authid/password verifier is selected.
export function validateCurrentPartialSecurity(value) {
  requireSecurity(keys(value, ["version","serverMajor","database","roles","memberships","roleSettings",
    "extensions","eventTriggers","securityLabels","sharedSecurityLabels","globalDefaultAcls"])
    && value.version === 1 && value.serverMajor === 17
    && keys(value.database, ["owner","acl","encoding","collate","ctype","localeProvider","locale","collationVersion"]));
  const d = value.database;
  requireSecurity(name(d.owner) && (d.acl === null || strings(d.acl)) && Number.isSafeInteger(d.encoding)
    && text(d.collate) && text(d.ctype) && ["c","i","b"].includes(d.localeProvider)
    && (d.locale === null || text(d.locale)) && (d.collationVersion === null || text(d.collationVersion)));
  const flags = ["superuser","inherit","createRole","createDatabase","login","replication","bypassRls"];
  rows(value.roles, ["name",...flags,"connectionLimit","validUntil","settings"], r => name(r.name)
    && flags.every(flag => typeof r[flag] === "boolean") && Number.isSafeInteger(r.connectionLimit)
    && r.connectionLimit >= -1 && (r.validUntil === null || text(r.validUntil)) && strings(r.settings));
  requireSecurity(value.roles.length > 0 && new Set(value.roles.map(r => r.name)).size === value.roles.length);
  const roleNames = new Set(value.roles.map(r => r.name));
  rows(value.memberships, ["role","member","grantor","admin","inherit","set"], r =>
    [r.role,r.member,r.grantor].every(n => roleNames.has(n)) && [r.admin,r.inherit,r.set].every(v => typeof v === "boolean"));
  rows(value.roleSettings, ["scope","role","settings"], r => ["all-databases","current-database"].includes(r.scope)
    && (r.role === null || roleNames.has(r.role)) && strings(r.settings));
  rows(value.extensions, ["name","owner","schema","version","relocatable","tables","conditions"], e =>
    name(e.name) && roleNames.has(e.owner) && name(e.schema) && text(e.version)
    && typeof e.relocatable === "boolean" && strings(e.tables) && strings(e.conditions) && e.tables.length === e.conditions.length);
  rows(value.eventTriggers, ["name","owner","event","enabled","tags","function","definition"], e =>
    name(e.name) && roleNames.has(e.owner) && text(e.event) && ["O","D","R","A"].includes(e.enabled)
    && strings(e.tags) && text(e.function) && text(e.definition));
  for (const field of ["securityLabels","sharedSecurityLabels"]) {
    rows(value[field], ["type","object","provider","label"], e => Object.values(e).every(text));
  }
  rows(value.globalDefaultAcls, ["owner","type","acl"], e => roleNames.has(e.owner) && text(e.type) && strings(e.acl));
  return value;
}

export async function readCurrentPartialSecurity() {
  let result;
  try { result = await conversionQuery(currentPartialSecurityQuery(), true); }
  catch { throw new Error("STAGING_PARTIAL_SECURITY_READ_FAILED"); }
  requireSecurity(Array.isArray(result) && result.length === 1 && keys(result[0], ["current_global_security"]));
  const value = validateCurrentPartialSecurity(result[0].current_global_security);
  return { diagnosticOnly: true, planQualified: false, currentGlobalSecurityCaptured: true,
    historicalGlobalStateProven: false, currentGlobalSafetyProven: false,
    roleCount: value.roles.length, membershipCount: value.memberships.length, extensionCount: value.extensions.length,
    eventTriggerCount: value.eventTriggers.length, securityLabelCount: value.securityLabels.length + value.sharedSecurityLabels.length,
    privateGlobalSecurity: value };
}
