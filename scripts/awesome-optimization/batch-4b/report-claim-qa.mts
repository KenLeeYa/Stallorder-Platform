import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
import {createRequire} from 'node:module';
import {registerHooks} from './node-hooks';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {captureFrozenResponsiveSource} from '../../responsive-build-provenance.mjs';
import {openGuardedDatabase,verifyLiveFixture} from '../../../docs/awesome-optimization/qa/live-fixture-guard.mjs';
const d='.superpowers/sdd/2026-10-01-awesome-optimization/batch-4b',label=process.argv[2];
assert.match(label??'',/^[a-z0-9-]+$/);assert.ok(process.env.B4B_ROOT_RUNTIME_SOURCE);
assert.equal(captureFrozenResponsiveSource().sourceIdentity.sourceSha256,process.env.B4B_ROOT_RUNTIME_SOURCE);
loadEnvFile('.env.local');const db=await openGuardedDatabase();await verifyLiveFixture(db);
const facadeUrl=new URL('./claim-prisma-facade.cts',import.meta.url).href;let executionFacadeResolutions=0;
registerHooks({resolve(specifier,context,next){if(specifier==='server-only')return{url:new URL('../../../src/test/server-only.ts',import.meta.url).href,shortCircuit:true};const result=next(specifier,context);if(result.url.replaceAll('\\','/').endsWith('/src/lib/prisma.ts')&&context.parentURL?.replaceAll('\\','/').endsWith('/src/server/reports/report-execution.ts')){executionFacadeResolutions++;return{url:facadeUrl,shortCircuit:true};}return result;}});
const facade=createRequire(import.meta.url)('./claim-prisma-facade.cts') as typeof import('./claim-prisma-facade.cts');
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('NO_NETWORK_IN_SQL_QA');};
const results:unknown[]=[],organizations=new Set<string>(),fixtures:unknown[]=[];
try{
 const execution=await import('../../../src/server/reports/report-execution');assert.ok(executionFacadeResolutions>0,'DECLARED_EXECUTION_FACADE_NOT_BOUND');
 async function scope(){const id=randomUUID(),name='awesome-b4b-claim-'+id;writeFileSync(`${d}/${label}-reserved-${id}.json`,JSON.stringify({id,name})+'\n',{flag:'wx'});
  const organization=await db.organization.create({data:{id,slug:name,name:'SIMULATED claim',businessName:'SIMULATED claim',email:name+'@example.test',phone:'0000000000'}});organizations.add(id);
  const plan=await db.planVersion.findFirstOrThrow({where:{plan:{code:'TRIAL'}},orderBy:{version:'desc'}});
  const subscription=await db.subscription.create({data:{organizationId:id,planId:plan.planId,planVersionId:plan.id,status:'TRIALING',billingPeriodStart:new Date(),billingPeriodEnd:new Date(Date.now()+30*86400000),trialStartedAt:new Date(),trialEndsAt:new Date(Date.now()+30*86400000)}});
  const stall=await db.stall.create({data:{organizationId:id,name:'SIMULATED claim',slug:name,code:'Q'+id.slice(0,7),address:'SIMULATED',location:'SIMULATED',businessStatus:'CLOSED',orderingEnabled:false}});
  const schedule=await db.reportSchedule.create({data:{organizationId:id,name:'SIMULATED claim',reportType:'DAILY_SALES',recipients:['synthetic@example.test'],stallIds:[stall.id],nextRunAt:new Date(Date.now()+86400000),createdById:'55555555-5555-4555-8555-555555555551',updatedById:'55555555-5555-4555-8555-555555555551'}});
  const fixture={organization,subscription,stall,schedule};fixtures.push(fixture);writeFileSync(`${d}/${label}-scope-${id}.json`,JSON.stringify(fixture,null,2)+'\n',{flag:'wx'});return fixture;
 }
 async function delivery(f:Awaited<ReturnType<typeof scope>>){const id=randomUUID();const row=await db.reportDelivery.create({data:{id,organizationId:f.organization.id,reportScheduleId:f.schedule.id,reportType:'DAILY_SALES',scheduledFor:new Date(),periodStart:new Date(),periodEnd:new Date(),recipients:['synthetic@example.test'],subject:'SIMULATED SQL claim',attemptCount:0,effectState:'NOT_STARTED',nextAttemptAt:new Date(),intentJson:{version:1,stallIds:[f.stall.id],scheduleFingerprint:'a'.repeat(64),binding:'b'.repeat(64),key:`stallorder-report-${id}`,mode:'SIMULATED'},originRequestId:randomUUID()}});writeFileSync(`${d}/${label}-delivery-${id}.json`,JSON.stringify(row,null,2)+'\n',{flag:'wx'});return row;}
 async function until(predicate:()=>Promise<boolean>,ms=8000){const end=Date.now()+ms;while(!await predicate()){if(Date.now()>end)throw Error('BOUNDED_SQL_WAIT_EXPIRED');await new Promise(r=>setTimeout(r,25));}}
 function deferred(){let resolve!:()=>void;return{promise:new Promise<void>(r=>{resolve=r;}),resolve:()=>resolve()};}
 async function boundedReady(ready:Promise<void>,outcome:Promise<unknown>){let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([ready,outcome.then(()=>{throw Error('TRANSACTION_ENDED_BEFORE_READY');}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('TRANSACTION_READY_TIMEOUT')),10000);})]);}finally{if(timer)clearTimeout(timer);}}
 async function race(node:boolean){
  const f=await scope(),first=await delivery(f);await new Promise(r=>setTimeout(r,2));const second=await delivery(f),locked=deferred(),commit=deferred();
  let writerPid=0;const writer=db.$transaction(async tx=>{await tx.$executeRawUnsafe('set local role service_role');await tx.$executeRawUnsafe("set local lock_timeout='10s'");await tx.$executeRawUnsafe('lock table public.report_deliveries in share mode');writerPid=(await tx.$queryRaw<Array<{pid:number}>>`select pg_backend_pid() as pid`)[0].pid;locked.resolve();await commit.promise;
   await tx.$executeRaw`update public.report_deliveries set lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '90 seconds',next_attempt_at=null,attempt_count=attempt_count+1,execution_version=execution_version+1,started_at=clock_timestamp(),updated_at=clock_timestamp() where id=${second.id}::uuid`;
  },{timeout:20000});
  const writerOutcome=writer.then(()=>({ok:true}),error=>({error}));await boundedReady(locked.promise,writerOutcome);
  const claimant=(node?execution.claimReportDeliveries(1,first.id):db.$transaction(async tx=>{await tx.$executeRawUnsafe('set local role service_role');return tx.$queryRaw`select id from app_private.claim_report_deliveries(1,${first.id}::uuid)`;},{timeout:20000})).then(value=>({value}),error=>({error}));
  let waits:unknown[]=[];try{await until(async()=>{waits=await db.$queryRaw`select l.pid,l.mode,l.granted,a.query from pg_locks l join pg_stat_activity a on a.pid=l.pid where l.relation='public.report_deliveries'::regclass and not l.granted and l.mode='RowExclusiveLock' and a.query like '%claim_report_deliveries%'`;return waits.length===1;});}finally{commit.resolve();}
  const written=await writerOutcome;assert.ok('ok'in written,JSON.stringify(written));const outcome=await claimant;
  writeFileSync(`${d}/${label}-${node?'node':'sql'}-race-raw.json`,JSON.stringify({outcome,written,waits,writerPid,firstId:first.id,secondId:second.id},null,2)+'\n',{flag:'wx'});
  if(node){assert.ok('value'in outcome);assert.deepEqual(outcome.value,[]);}else{assert.ok('error'in outcome);assert.equal(outcome.error.code,'P2010');assert.equal(outcome.error.meta.code,'P4B01');assert.equal(outcome.error.meta.message,'ERROR: REPORT_ONE_ORG_CONFLICT');}
  const unchanged=await db.reportDelivery.findUniqueOrThrow({where:{id:first.id}}),winner=await db.reportDelivery.findUniqueOrThrow({where:{id:second.id}});
  assert.equal(unchanged.attemptCount,0);assert.equal(unchanged.executionVersion,1);assert.equal(unchanged.leaseToken,null);assert.equal(winner.attemptCount,1);assert.equal(winner.executionVersion,2);assert.ok(winner.leaseToken);
  const receipt={name:node?'actual-node-exact-marker-safe-readback':'actual-function-exact-marker-whole-claim-rollback',status:'PASS',classification:'DIRECT_SQL_WRITER_VS_ACTUAL_CLAIM_FUNCTION',writerPid,waits,first:unchanged,second:winner,outcome};results.push(receipt);writeFileSync(`${d}/${label}-${node?'node':'sql'}-race.json`,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});return f;
 }
 const duplicateScope=await race(false);await race(true);
 for(const kind of ['unknown-23505','other-22012']){
  let actual:unknown;try{if(kind==='unknown-23505')await db.$executeRaw`insert into public.organizations select * from public.organizations where id=${duplicateScope.organization.id}::uuid`;else await db.$queryRaw`select 1/0`;}catch(error){actual=error;}
  assert.ok(actual&&typeof actual==='object'&&'code'in actual&&'meta'in actual&&actual.meta&&typeof actual.meta==='object'&&'code'in actual.meta&&'message'in actual.meta);assert.equal(actual.code,'P2010');assert.equal(actual.meta.code,kind==='unknown-23505'?'23505':'22012');assert.notEqual(actual.meta.message,'REPORT_ONE_ORG_CONFLICT');
  facade.armFailure(actual);assert.equal(facade.prisma.$transaction,facade.injectionState().transaction);assert.equal(facade.injectionState().calls,0);
  const ownedId=(results[0] as {first:{id:string}}).first.id;
  try{await assert.rejects(execution.claimReportDeliveries(1,ownedId),error=>error===actual);assert.equal(facade.injectionState().calls,1);}finally{facade.disarmFailure();}
  results.push({name:kind+'-not-swallowed',status:'PASS',classification:'ACTUAL_POSTGRES_ERROR_IN_DECLARED_TEST_PRISMA_FACADE',code:actual.code,meta:actual.meta});
 }
 // Bounded global claim: every eligible row must be traced to an owned fixture before invocation.
 const batch=[];for(let i=0;i<21;i++)batch.push(await delivery(await scope()));
 const ownershipFiles=readdirSync(d).filter(name=>/^(red-owned-fixtures|db-contract-fixture(?:-[46])?|db-contract-scope-[46]|worker-[1234]-scope-[0-9a-f-]+)\.json$/.test(name));
 for(const name of ownershipFiles){const value=JSON.parse(readFileSync(`${d}/${name}`,'utf8'));const id=value.organization?.id??value.organizationId;if(id)organizations.add(id);}
 async function globalPreflight(cycle:number){const now=new Date();const eligible=await db.$queryRaw<Array<{id:string;organization_id:string}>>`select d.id,d.organization_id from public.report_deliveries d where d.status='PROCESSING' and d.intent_json is not null and d.effect_state in ('NOT_STARTED','REJECTED') and d.lease_token is null and d.attempt_count<5 and d.next_attempt_at<=${now} and not exists(select 1 from public.report_deliveries a where a.organization_id=d.organization_id and a.status='PROCESSING' and a.lease_token is not null)`;assert.ok(eligible.every(row=>organizations.has(row.organization_id)));writeFileSync(`${d}/${label}-global-eligible-${cycle}.json`,JSON.stringify({now,eligible,ownershipFiles,organizations:[...organizations]},null,2)+'\n',{flag:'wx'});return eligible;}
 const eligible=await globalPreflight(1);
 const orderedOrgs=await db.$queryRaw<Array<{id:string}>>`select o.id from public.organizations o where o.id::text in (select jsonb_array_elements_text(${JSON.stringify([...new Set(eligible.map(row=>row.organization_id))])}::jsonb)) order by (select min(d.created_at) from public.report_deliveries d where d.organization_id=o.id and d.status='PROCESSING'),o.id`;
 const batchLocked=deferred(),batchCommit=deferred();let claimed:Array<{id:string;organization_id:string}>=[];
 const firstBatch=db.$transaction(async tx=>{await tx.$executeRawUnsafe('set local role service_role');claimed=await tx.$queryRaw`select id,organization_id from app_private.claim_report_deliveries(20,null)`;batchLocked.resolve();await batchCommit.promise;},{timeout:20000});
 const firstBatchOutcome=firstBatch.then(()=>({ok:true}),error=>({error}));await boundedReady(batchLocked.promise,firstBatchOutcome);
 let remainingOrg:string|undefined;try{assert.equal(claimed.length,20);assert.equal(new Set(claimed.map(r=>r.organization_id)).size,20);assert.deepEqual(claimed.map(row=>row.organization_id),orderedOrgs.slice(0,20).map(row=>row.id));remainingOrg=orderedOrgs[20]?.id;assert.ok(remainingOrg);
  await db.$transaction(async tx=>{await tx.$queryRaw`select id from public.organizations where id=${remainingOrg}::uuid for update nowait`;});
 }finally{batchCommit.resolve();}assert.ok('ok'in await firstBatchOutcome);
 await globalPreflight(2);const secondBatch=await execution.claimReportDeliveries(20);assert.ok(secondBatch.length<=20);
 const all=await db.reportDelivery.findMany({where:{id:{in:batch.map(row=>row.id)}}});assert.ok(all.every(row=>row.leaseToken&&row.attemptCount===1));
 const duplicates=await db.$queryRaw`select organization_id,count(*)::integer as count from public.report_deliveries where status='PROCESSING' and lease_token is not null group by organization_id having count(*)>1`;assert.deepEqual(duplicates,[]);
 results.push({name:'bounded20-unlocked-21st-organization-and-two-cycle-fairness',status:'PASS',claimed,remainingOrg,secondBatch,newOwned21:all.map(r=>({id:r.id,organizationId:r.organizationId,attempt:r.attemptCount,version:r.executionVersion}))});
 console.log(JSON.stringify({status:'PASS',checks:results.length,networkCalls:0,classification:'LOCAL_SQL_AND_DECLARED_ERROR_FACADE'}));
}finally{facade.disarmFailure();globalThis.fetch=originalFetch;writeFileSync(`${d}/${label}-claim-result.json`,JSON.stringify({at:new Date().toISOString(),results,fixtures,executionFacadeResolutions},null,2)+'\n',{flag:'wx'});await db.$disconnect();await(await import('../../../src/lib/prisma')).prisma.$disconnect();}
