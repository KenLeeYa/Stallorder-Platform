import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {assertResponsiveQaTarget} from '../../responsive-qa-target.mjs';
import {captureFrozenResponsiveSource} from '../../responsive-build-provenance.mjs';
import {assertLegacyNotificationCatalogue} from '../../../docs/awesome-optimization/qa/legacy-notification-catalogue-guard-v2.mjs';
export const evidence='.superpowers/sdd/2026-10-01-awesome-optimization/batch-5';
export const sha=b=>createHash('sha256').update(b).digest('hex');
export const plain=v=>JSON.parse(JSON.stringify(v));
export function assertPreClient(env,source,pins,read=readFileSync){
 assertResponsiveQaTarget(env);assert.ok(!env.VERCEL&&!env.VERCEL_ENV&&!env.CI,'NATIVE_HOSTED_TARGET_DENIED');
 for(const key of ['DATABASE_URL','DIRECT_URL','DR_DATABASE_URL','DR_DIRECT_URL']){if(!env[key]){assert.ok(!['DATABASE_URL','DIRECT_URL'].includes(key),'NATIVE_DATABASE_REQUIRED');continue;}const u=new URL(env[key]);assert.ok(['postgres:','postgresql:'].includes(u.protocol)&&['127.0.0.1','localhost'].includes(u.hostname)&&u.port==='56822'&&u.pathname==='/postgres','NATIVE_DATABASE_TARGET_DENIED');}
 assert.match(env.B5_ROOT_SOURCE??'',/^[a-f0-9]{64}$/);assert.equal(source,env.B5_ROOT_SOURCE,'NATIVE_SOURCE_DRIFT');
 for(const [file,expected]of Object.entries(pins))assert.equal(sha(read(file)),expected,'NATIVE_INPUT_DRIFT '+file);
 assert.equal(sha(read('prisma/schema.prisma')),'0b566b681454042f6c658b246a1c543d89e24a0b6a878495e02909a03dd7ed42','NATIVE_SCHEMA_DRIFT');
}
export async function openNativeDatabase(){
 const pins=JSON.parse(readFileSync(evidence+'/database-helper-pins-v1.json','utf8'));assert.equal(sha(readFileSync(evidence+'/database-helper-pins-v1.json')),'d6b685c86b374dc46b409dde7d5784d18f272bcdf21137453fbcabfd89c46cfc');
 assertPreClient(process.env,captureFrozenResponsiveSource().sourceIdentity.sourceSha256,pins);
 const running=execFileSync('docker',['ps','--format','{{.ID}}'],{encoding:'utf8'}).trim().split(/\s+/).sort();assert.deepEqual(running,['8c65cd60bd23','018e329a66c1','ff08863f5f62','e43bd044746f','f3f4c381b5ce','834e5c2e2fdb','d11af555754b'].sort());
 for(const [id,port,key]of [['d11af555754b','56822','5432/tcp'],['834e5c2e2fdb','56821','8000/tcp']]){const [v]=JSON.parse(execFileSync('docker',['inspect',id],{encoding:'utf8'}));assert.ok(v.Id.startsWith(id)&&v.State.Running);assert.equal(v.Config.Labels['com.supabase.cli.project'],'stallorder-responsive-20260930');assert.equal(v.NetworkSettings.Ports[key][0].HostPort,port);}
 const {PrismaClient}=await import('@prisma/client');const db=new PrismaClient();try{await assertLegacyNotificationCatalogue(db);return db;}catch(e){await db.$disconnect();throw e;}
}
export const oldSessionFields=['id','profileId','tokenHash','csrfTokenHash','deviceId','deviceLabel','ipHash','userAgentHash','issuedAt','expiresAt','lastSeenAt','rotationFamilyId','rotatedFromId','revokedAt','revokeReason','profileSessionVersion','reuseDetectedAt','createdAt'];
export function projectOldSession(row){assert.deepEqual(Object.keys(row).sort(),[...oldSessionFields,'clientKind'].sort(),'NATIVE_UNKNOWN_SESSION_FIELD');assert.equal(row.clientKind,'WEB','NATIVE_OLD_AUDIENCE_CHANGED');return Object.fromEntries(oldSessionFields.map(k=>[k,row[k]]));}
export async function oldSessionRows(db){return plain(await db.authSession.findMany({select:Object.fromEntries(oldSessionFields.map(k=>[k,true])),orderBy:{id:'asc'}}));}
export async function accessCatalogue(db){return plain({table:await db.$queryRaw`select c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text,c.relowner::text from pg_class c where c.oid='public.auth_sessions'::regclass`,policies:await db.$queryRaw`select policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname='public' and tablename='auth_sessions' order by policyname`});}
export async function assertAudienceCatalogue(db){
 const columns=await db.$queryRaw`select column_name,udt_name,is_nullable,column_default from information_schema.columns where table_schema='public' and table_name='auth_sessions' and column_name='client_kind'`;
 assert.deepEqual(plain(columns),[{column_name:'client_kind',udt_name:'AuthSessionClientKind',is_nullable:'NO',column_default: `'WEB'::"AuthSessionClientKind"`}]);
 const labels=await db.$queryRaw`select e.enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typname='AuthSessionClientKind' order by e.enumsortorder`;assert.deepEqual(labels,[{enumlabel:'WEB'},{enumlabel:'NATIVE'}]);return {columns,labels};
}
