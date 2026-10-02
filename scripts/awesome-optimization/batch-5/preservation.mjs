import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyLiveFixture} from '../../../docs/awesome-optimization/qa/live-fixture-guard.mjs';
import {projectLegacyApplications} from '../../../docs/awesome-optimization/qa/native-session-schema-overlay-v1.mjs';
import {plain,oldSessionFields,sha} from './database-guard.mjs';
const base='.superpowers/sdd/2026-10-01-awesome-optimization';
export async function preserveNativeInputs(db){
 const fixed=(await verifyLiveFixture(db)).receipt;
 const old=JSON.parse(readFileSync(base+'/batch-4c/fix-1/repair-final-readback-before.json','utf8'));
 const current=plain({jobs:await db.$queryRaw`select * from public.notification_jobs order by id`,integrations:await db.$queryRaw`select * from public.notification_integrations order by id`,links:await db.$queryRaw`select * from public.customer_contact_links order by id`});
 assert.deepEqual(current,old.current);assert.deepEqual([current.jobs.length,current.integrations.length,current.links.length],[105,17,83]);
 for(const [key,model]of [['orders','order'],['contacts','customerContactLink']])assert.deepEqual(plain(await db[model].findMany({where:{id:{in:old[key].map(r=>r.id)}},orderBy:{id:'asc'}})),old[key]);
 const events=plain(await db.lineWebhookEvent.findMany({orderBy:{id:'asc'}}));assert.deepEqual(events,old.events);
 const sessions=plain(await db.authSession.findMany({where:{id:{in:old.sessions.map(r=>r.id)}},select:Object.fromEntries(oldSessionFields.map(k=>[k,true])),orderBy:{id:'asc'}}));assert.deepEqual(sessions,old.sessions);
 const rates=plain(await db.$queryRaw`select * from public.rate_limit_buckets order by key`);assert.deepEqual(rates,old.rates);
 const vault=plain(await db.$queryRaw`select id::text,name,description,created_at from vault.secrets where id=${old.vault[0].id}::uuid order by id`);assert.deepEqual(vault,old.vault);
 const oldFixture=JSON.parse(readFileSync(base+'/batch-4c/fix-1/old-gate-red-fixture.json','utf8'));
 const absent=await db.$queryRaw`select id from vault.secrets where name=${'stallorder_b4c_fix1_rpc_'+oldFixture.cases.find(c=>c.kind==='RPC').contact}`;assert.equal(absent.length,0);
 const reports=JSON.parse(readFileSync(base+'/batch-4b/fix-1/final-report-rows.json','utf8'));assert.equal(reports.length,112);assert.deepEqual(plain(await db.reportDelivery.findMany({where:{id:{in:reports.map(r=>r.id)}},orderBy:{id:'asc'}})),reports);
 const staff=JSON.parse(readFileSync(base+'/batch-4a/fix-1/staff-final.json','utf8'));for(const [key,model]of [['deliveries','staffPushDelivery'],['subscriptions','staffPushSubscription']]){assert.equal(staff[key].length,18);assert.deepEqual(plain(await db[model].findMany({where:{id:{in:staff[key].map(r=>r.id)}},orderBy:{id:'asc'}})),staff[key]);}
 const approvals=JSON.parse(readFileSync(base+'/batch-2/repair-1/approval-postimages.json','utf8'));
 for(const entry of approvals.cases){const expected=entry.data,app=await db.merchantApplication.findUniqueOrThrow({where:{id:expected.application.id}});const actual={application:projectLegacyApplications([app])[0]};
  for(const [key,model]of Object.entries({organization:'organization',subscriptions:'subscription',stalls:'stall',qrs:'qrCode',memberships:'organizationMembership',notifications:'merchantApplicationNotification'})){const ref=expected[key],array=Array.isArray(ref),rows=array?ref:[ref];const found=await db[model].findMany({where:{id:{in:rows.map(r=>r.id)}},select:Object.fromEntries(Object.keys(rows[0]).map(k=>[k,true]))});actual[key]=array?rows.map(r=>found.find(x=>x.id===r.id)):found[0];}assert.deepEqual(plain(actual),expected);
 }
 return {fixed,legacyDigest:sha(JSON.stringify(current)),events:20,sessions:3,rates:rates.length,vaultMetadataUnchanged:true,repairVaultAbsent:true,reports:112,staffDeliveries:18,staffSubscriptions:18,approvals:approvals.cases.length};
}
