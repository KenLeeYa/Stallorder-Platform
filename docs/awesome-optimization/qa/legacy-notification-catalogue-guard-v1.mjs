import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Literal candidate fingerprints from the immutable post-apply receipt; root approval required before use.
export const legacyCatalogueSha256='2d192dc60b300f604044ce480792d211ffc7b0d74868813dd6990f8bd675ce65';
export function assertLegacyCatalogueEvidence(evidence){
 assert.equal(hash(evidence.current),legacyCatalogueSha256,'LEGACY_CATALOGUE_DRIFT');
 assert.equal(hash(evidence.function),'36e03050965e28fb683c832a987feb4fa06898d89bf7e58584bff47969967197','LEGACY_FUNCTION_PRIVILEGE_DRIFT');
 assert.equal(hash(evidence.access),'335766c0ababed445fad1867481e0fc12a60f73d2408f7efe2579c39ac846353','LEGACY_TABLE_ACCESS_DRIFT');
 assert.equal(hash(evidence.constraintSources),'483de4aeb7f57d1fbb03f2a986a95305a200eb400d79aa2bd40b9ae649c8ae8f','LEGACY_CHECK_PREDICATE_DRIFT');
}
async function catalogue(tx){
 const constraints=await tx.$queryRaw`select c.relname,k.conname,pg_get_constraintdef(k.oid) as definition from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('customer_contact_links','notification_jobs','notification_integrations') order by c.relname,k.conname`;
 const columns=await tx.$queryRaw`select table_name,column_name,data_type,is_nullable,column_default from information_schema.columns where table_schema='public' and table_name in ('customer_contact_links','notification_jobs','notification_integrations') order by table_name,ordinal_position`;
 const triggers=await tx.$queryRaw`select c.relname,t.tgname,pg_get_triggerdef(t.oid) as definition,pg_get_functiondef(t.tgfoid) as function from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('customer_contact_links','notification_jobs','notification_integrations') and not t.tgisinternal order by c.relname,t.tgname`;
 return{constraints,columns,triggers};
}
export async function assertLegacyNotificationCatalogue(tx){
 const current=await catalogue(tx);
 const [fn]=await tx.$queryRaw`select p.prosecdef,p.proconfig,p.prosrc,p.proowner=current_user::regrole as owner_matches,
    not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee in (0,'anon'::regrole::oid,'authenticated'::regrole::oid) and a.privilege_type='EXECUTE') as caller_execute_denied
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.proname='capture_legacy_notification_intent'`;
 const access=await tx.$queryRaw`select c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text,c.relowner::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('customer_contact_links','notification_jobs','notification_integrations') order by c.relname`;
 const constraintSources=await tx.$queryRaw`select conname,pg_get_expr(conbin,conrelid) as predicate from pg_constraint where conrelid='public.notification_jobs'::regclass and conname in ('notification_jobs_legacy_execution_check','notification_jobs_simulated_legacy_check') order by conname`;
 const evidence={current,function:fn,access,constraintSources};assertLegacyCatalogueEvidence(evidence);return evidence;
}
