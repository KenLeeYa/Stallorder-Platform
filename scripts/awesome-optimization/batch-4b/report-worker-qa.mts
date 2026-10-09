import {readFileSync,writeFileSync,existsSync,readdirSync,createWriteStream} from 'node:fs';
import {loadEnvFile} from 'node:process';
import {createRequire} from 'node:module';
import {registerHooks} from './node-hooks';
import {fork,type ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {captureFrozenResponsiveSource} from '../../responsive-build-provenance.mjs';
import {openGuardedDatabase,verifyLiveFixture} from '../../../docs/awesome-optimization/qa/live-fixture-guard.mjs';
const d='.superpowers/sdd/2026-10-01-awesome-optimization/batch-4b',label=process.argv[2];
assert.match(label??'',/^[a-z0-9-]+$/);assert.ok(process.env.B4B_ROOT_RUNTIME_SOURCE);
assert.equal(captureFrozenResponsiveSource().sourceIdentity.sourceSha256,process.env.B4B_ROOT_RUNTIME_SOURCE);
loadEnvFile('.env.local');const db=await openGuardedDatabase();await verifyLiveFixture(db);
const moduleUrl=new URL('./mock-report-email.mts',import.meta.url).href;
registerHooks({resolve(specifier,context,next){if(specifier==='server-only')return{url:new URL('../../../src/test/server-only.ts',import.meta.url).href,shortCircuit:true};const result=next(specifier,context);return result.url.replaceAll('\\','/').endsWith('/src/server/reports/report-email.ts')?{url:moduleUrl,shortCircuit:true}:result;}});
const mock=createRequire(import.meta.url)('./mock-report-email.mts') as typeof import('./mock-report-email.mts');
const organizations=new Set<string>();const server=await mock.startReportMock(db,organizations),originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);assert.equal(url.origin,server.origin);return originalFetch(input,init);};
const results:unknown[]=[],fixtures:unknown[]=[];const children:ChildProcess[]=[],pending:Promise<unknown>[]=[];
const bundle=process.argv[3]??"core";assert.ok(["core","resilience"].includes(bundle));
try{
const worker=await import('../../../src/lib/report-delivery'),execution=await import('../../../src/server/reports/report-execution'),operations=await import('../../../src/server/reports/report-operations');
async function scope(){
 const id=randomUUID(),name='awesome-b4b-runtime-'+id;writeFileSync(`${d}/${label}-reserved-${id}.json`,JSON.stringify({id,name})+'\n',{flag:'wx'});
 const organization=await db.organization.create({data:{id,slug:name,name:'SIMULATED report',businessName:'SIMULATED report',email:name+'@example.test',phone:'0000000000'}});organizations.add(id);
 const plan=await db.planVersion.findFirstOrThrow({where:{plan:{code:'TRIAL'}},orderBy:{version:'desc'}});
 const subscription=await db.subscription.create({data:{organizationId:id,planId:plan.planId,planVersionId:plan.id,status:'TRIALING',billingPeriodStart:new Date(),billingPeriodEnd:new Date(Date.now()+30*86400000),trialStartedAt:new Date(),trialEndsAt:new Date(Date.now()+30*86400000)}});
 const stall=await db.stall.create({data:{organizationId:id,name:'SIMULATED report',slug:name,code:'T'+id.slice(0,7),address:'SIMULATED',location:'SIMULATED',businessStatus:'CLOSED',orderingEnabled:false}});
 const schedule=await db.reportSchedule.create({data:{organizationId:id,name:'SIMULATED report',reportType:'DAILY_SALES',recipients:['synthetic@example.test'],stallIds:[stall.id],nextRunAt:new Date(Date.now()+86400000),createdById:'55555555-5555-4555-8555-555555555551',updatedById:'55555555-5555-4555-8555-555555555551'}});
 const fixture={organization,subscription,stall,schedule};fixtures.push(fixture);writeFileSync(`${d}/${label}-scope-${id}.json`,JSON.stringify(fixture,null,2)+'\n',{flag:'wx'});return fixture;
}
async function delivery(fixture:Awaited<ReturnType<typeof scope>>,mode:Parameters<typeof mock.configureReport>[1]){
 const id=randomUUID();const row=await db.reportDelivery.create({data:{id,organizationId:fixture.organization.id,reportScheduleId:fixture.schedule.id,reportType:'DAILY_SALES',scheduledFor:new Date(),periodStart:new Date(),periodEnd:new Date(),recipients:['synthetic@example.test'],subject:'SIMULATED runtime',attemptCount:0,effectState:'NOT_STARTED',nextAttemptAt:new Date(),intentJson:execution.createReportIntent(fixture.schedule,id),originRequestId:randomUUID()}});mock.configureReport(id,mode);writeFileSync(`${d}/${label}-delivery-${id}.json`,JSON.stringify(row,null,2)+'\n',{flag:'wx'});return row;
}
const profile=await db.profile.findUniqueOrThrow({where:{id:"55555555-5555-4555-8555-555555555554"}});
const deviceId=randomUUID();
const session=await db.authSession.create({data:{profileId:profile.id,deviceId,profileSessionVersion:profile.sessionVersion,tokenHash:randomUUID(),csrfTokenHash:randomUUID(),expiresAt:new Date(Date.now()+3600000)}});
writeFileSync(`${d}/${label}-session.json`,JSON.stringify({id:session.id,profileId:profile.id,expiresAt:session.expiresAt})+"\n",{flag:"wx"});
const access=(organizationId:string)=>({organizationId,sessionId:session.id,deviceId,actorId:'55555555-5555-4555-8555-555555555554',canManage:true,isPlatformAdmin:true,requestId:randomUUID(),canUseAllStalls:true,authorizedStallIds:[]});
 if(bundle==="core"){
 const f=await scope(),row=await delivery(f,'ACCEPT');
 const outcomes=await Promise.allSettled([worker.processReportDelivery(row.id),worker.processReportDelivery(row.id)]);
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);const final=await db.reportDelivery.findUniqueOrThrow({where:{id:row.id}});assert.equal(final.status,'SIMULATED');assert.equal(final.attemptCount,1);assert.equal(mock.events.filter(e=>e.phase==='accepted'&&e.key.endsWith(row.id)).length,1);assert.ok(final.snapshotHash&&final.firstRequestAt);results.push({name:'two-executors-one-provider-acceptance',status:'PASS',id:row.id,outcomes});
 await assert.rejects(operations.retryReportDelivery(access(f.organization.id),row.id,{expectedVersion:final.executionVersion,reason:'RETRY_CONFIRMED_FAILURE'}),/REPORT_RETRY_UNSAFE/);results.push({name:'accepted-manual-retry-denied',status:'PASS'});
 const unknown=await delivery(f,'LOSS');await worker.processReportDelivery(unknown.id);const lost=await db.reportDelivery.findUniqueOrThrow({where:{id:unknown.id}});assert.equal(lost.effectState,'UNKNOWN');assert.equal(lost.status,'FAILURE');await assert.rejects(worker.processReportDelivery(unknown.id),/REPORT_DELIVERY_NOT_PROCESSABLE/);await assert.rejects(operations.retryReportDelivery(access(f.organization.id),unknown.id,{expectedVersion:lost.executionVersion,reason:'RETRY_CONFIRMED_FAILURE'}),/REPORT_RETRY_UNSAFE/);
 const reconciled=await operations.reconcileReportDelivery(access(f.organization.id),unknown.id,{expectedVersion:lost.executionVersion});assert.equal(reconciled.status,'SIMULATED');assert.equal(mock.events.filter(e=>e.phase==='accepted'&&e.key.endsWith(unknown.id)).length,1);results.push({name:'accepted-response-loss-no-resend-trusted-reconcile',status:'PASS',id:unknown.id});
 const poison=await delivery(f,'REJECT');await worker.processReportDelivery(poison.id);const firstPoison=await db.reportDelivery.findUniqueOrThrow({where:{id:poison.id}});
 for(let attempt=1;attempt<5;attempt++){const before=await db.reportDelivery.findUniqueOrThrow({where:{id:poison.id}});assert.equal(before.attemptCount,attempt);const command={expectedVersion:before.executionVersion,reason:'RETRY_CONFIRMED_FAILURE'};const doubles=await Promise.allSettled([operations.retryReportDelivery(access(f.organization.id),poison.id,command),operations.retryReportDelivery(access(f.organization.id),poison.id,command)]);assert.equal(doubles.filter(r=>r.status==='fulfilled').length,1);await worker.processReportDelivery(poison.id);}
 const terminal=await db.reportDelivery.findUniqueOrThrow({where:{id:poison.id}});assert.equal(terminal.attemptCount,5);assert.equal(terminal.errorCode,'WORKER_ATTEMPTS_EXHAUSTED');assert.equal(terminal.snapshotHash,firstPoison.snapshotHash);assert.deepEqual(terminal.snapshotJson,firstPoison.snapshotJson);assert.deepEqual(terminal.intentJson,firstPoison.intentJson);await assert.rejects(operations.retryReportDelivery(access(f.organization.id),poison.id,{expectedVersion:terminal.executionVersion,reason:'RETRY_CONFIRMED_FAILURE'}),/REPORT_RETRY_UNSAFE/);results.push({name:'lifetime-five-manual-double-invoke-terminal',status:'PASS',id:poison.id});
}else{
 async function until(predicate:()=>Promise<boolean>,timeoutMs=10000){const end=Date.now()+timeoutMs;while(!await predicate()){if(Date.now()>end)throw Error('BOUNDED_QA_WAIT_EXPIRED');await new Promise(r=>setTimeout(r,25));}}
 const beforeScope=await scope(),afterScope=await scope(),heldScope=await scope();
 const before=await delivery(beforeScope,'ACCEPT'),after=await delivery(afterScope,'ACCEPT'),held=await delivery(heldScope,'PAUSE_BEFORE_TRANSPORT');
 async function crash(mode:string,row:typeof before){
  const child=fork(new URL('./crash-executor.mts',import.meta.url),[mode,row.id,row.organizationId],{execArgv:['--import','tsx'],silent:true,env:process.env});children.push(child);
  const out=createWriteStream(`${d}/${label}-${mode}-child.stdout.log`,{flags:'wx'}),err=createWriteStream(`${d}/${label}-${mode}-child.stderr.log`,{flags:'wx'});child.stdout!.pipe(out);child.stderr!.pipe(err);
  const ready=await new Promise<Record<string,unknown>>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('CHILD_CHECKPOINT_TIMEOUT')),20000);child.once('message',m=>{clearTimeout(timer);resolve(m as Record<string,unknown>);});child.once('exit',code=>{clearTimeout(timer);reject(Error('CHILD_EARLY_EXIT_'+code));});});assert.equal(ready.pid,child.pid);
  const atCheckpoint=await db.reportDelivery.findUniqueOrThrow({where:{id:row.id}});assert.equal(atCheckpoint.effectState,mode==='before-effect'?'NOT_STARTED':'IN_FLIGHT');
  const stopped=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));child.kill();const exit=await stopped;
  writeFileSync(`${d}/${label}-${mode}-crash.json`,JSON.stringify({ready,atCheckpoint,exit,processTerminated:true,at:new Date().toISOString()},null,2)+'\n',{flag:'wx'});return atCheckpoint;
 }
 const pre=await crash('before-effect',before),post=await crash('after-effect',after);
 const heldPending=worker.processReportDelivery(held.id).then(value=>({value}),error=>({error:String(error)}));pending.push(heldPending);
 await until(async()=>mock.events.some(e=>e.key.endsWith(held.id)&&e.phase==='paused-before-transport'));
 const paused=await db.reportDelivery.findUniqueOrThrow({where:{id:held.id}});assert.equal(paused.effectState,'IN_FLIGHT');assert.equal(mock.events.filter(e=>e.key.endsWith(held.id)&&e.phase==='request').length,0);
 const oldClaim=(row:typeof pre)=>({id:row.id,token:row.leaseToken!,version:row.executionVersion});
 assert.deepEqual(await execution.claimReportDeliveries(1,before.id),[]);
 const expiry=Math.max(pre.leaseExpiresAt!.getTime(),post.leaseExpiresAt!.getTime(),paused.leaseExpiresAt!.getTime());
 const waitStart=new Date();while(Date.now()<=expiry+100){await new Promise(r=>setTimeout(r,Math.min(1000,expiry+101-Date.now())));assert.ok(Date.now()-waitStart.getTime()<100000);}
 const ownershipFiles=readdirSync(d).filter(name=>/^(red-owned-fixtures|db-contract-fixture(?:-[46])?|db-contract-scope-[46]|worker-[123]-scope-[0-9a-f-]+)\.json$/.test(name));
 const ownedOrganizations=new Set(organizations);for(const name of ownershipFiles){const value=JSON.parse(readFileSync(`${d}/${name}`,'utf8'));const id=value.organization?.id??value.organizationId;if(id)ownedOrganizations.add(id);}
 const nowRows=await db.$queryRaw<Array<{id:string;organization_id:string;database_now:Date}>>`select id,organization_id,clock_timestamp() as database_now from public.report_deliveries where (status='PROCESSING' and lease_expires_at<=clock_timestamp()) or (status in ('PROCESSING','FAILURE') and intent_json is null and effect_state is null) order by created_at,id`;
 assert.ok(nowRows.length<=20);assert.ok(nowRows.every(row=>ownedOrganizations.has(row.organization_id)));assert.ok([before.id,after.id,held.id].every(id=>nowRows.some(row=>row.id===id)));
 writeFileSync(`${d}/${label}-recovery-eligible.json`,JSON.stringify({ownershipFiles,ownedOrganizations:[...ownedOrganizations],nowRows,waitStart,waitEnd:new Date()},null,2)+'\n',{flag:'wx'});
 await execution.recoverReportDeliveries();
 const recovered=await db.reportDelivery.findMany({where:{id:{in:[before.id,after.id,held.id]}}});
 assert.equal(recovered.find(r=>r.id===before.id)!.effectState,'NOT_STARTED');for(const id of [after.id,held.id])assert.equal(recovered.find(r=>r.id===id)!.effectState,'UNKNOWN');
 await assert.rejects(execution.authorizeReportEffect(oldClaim(pre),'a'.repeat(64)),/REPORT_LEASE_STALE/);await assert.rejects(worker.completeReportEffect(oldClaim(post),{kind:'SIMULATED',messageId:'stale'}),/REPORT_LEASE_STALE/);
 await worker.processReportDelivery(before.id);const fresh=await db.reportDelivery.findUniqueOrThrow({where:{id:before.id}});assert.equal(fresh.attemptCount,2);assert.equal(fresh.status,'SIMULATED');assert.equal(mock.events.filter(e=>e.phase==='accepted'&&e.key.endsWith(before.id)).length,1);
 await assert.rejects(worker.processReportDelivery(after.id),/REPORT_DELIVERY_NOT_PROCESSABLE/);await assert.rejects(operations.retryReportDelivery(access(after.organizationId),after.id,{expectedVersion:recovered.find(r=>r.id===after.id)!.executionVersion,reason:'RETRY_CONFIRMED_FAILURE'}),/REPORT_RETRY_UNSAFE/);
 mock.closeGrant(held.id);const h=await db.reportDelivery.findUniqueOrThrow({where:{id:held.id}});const reconciled=await operations.reconcileReportDelivery(access(held.organizationId),held.id,{expectedVersion:h.executionVersion});assert.equal(reconciled.effectState,'REJECTED');mock.releasePaused(held.id);const stale=await heldPending;assert.match(String('error'in stale?stale.error:''),/REPORT_LEASE_STALE/);assert.equal(mock.events.filter(e=>e.phase==='accepted'&&e.key.endsWith(held.id)).length,0);
 results.push({name:'actual-killed-process-pre-post-grant-expiry-stale-fences',status:'PASS',before:before.id,after:after.id,recovered,waitStart,waitEnd:new Date()});results.push({name:'held-old-grant-closed-before-reconciliation-no-late-acceptance',status:'PASS',id:held.id});
 const acceptedHold=await delivery(await scope(),'HOLD_ACCEPTED');const heldResponse=worker.processReportDelivery(acceptedHold.id);pending.push(heldResponse);
 await until(async()=>mock.events.some(e=>e.key.endsWith(acceptedHold.id)&&e.phase==='accepted'));assert.equal((await db.reportDelivery.findUniqueOrThrow({where:{id:acceptedHold.id}})).effectState,'IN_FLIGHT');mock.dropHeldResponse(acceptedHold.id);await heldResponse;
 const unknown=await db.reportDelivery.findUniqueOrThrow({where:{id:acceptedHold.id}});assert.equal(unknown.effectState,'UNKNOWN');await assert.rejects(worker.processReportDelivery(unknown.id),/REPORT_DELIVERY_NOT_PROCESSABLE/);
 const actorId=randomUUID();await db.profile.create({data:{id:actorId,email:`awesome-b4b-revoke-${actorId}@example.test`,displayName:'SIMULATED revocation',platformRole:'PLATFORM_ADMIN'}});
 const auth=await import('../../../src/lib/auth'),device=randomUUID(),ownSession=await auth.createSession(actorId,{deviceId:device});
 const ownAccess={...access(unknown.organizationId),actorId,sessionId:ownSession.id,deviceId:device};mock.holdLookup(unknown.id);
 const reconciliation=operations.reconcileReportDelivery(ownAccess,unknown.id,{expectedVersion:unknown.executionVersion}).then(value=>({value}),error=>({error:String(error)}));pending.push(reconciliation);
 await until(async()=>mock.events.some(e=>e.key.endsWith(unknown.id)&&e.phase==='lookup-held'));
 await auth.revokeRequestSession(new Request('http://127.0.0.1:3026/api/auth/logout',{headers:{cookie:`stallorder_session=${ownSession.token}; stallorder_auth_device=${device}`}}));mock.releaseLookup(unknown.id);const denied=await reconciliation;assert.match(String('error'in denied?denied.error:''),/REPORT_SESSION_REVOKED/);
 const unchanged=await db.reportDelivery.findUniqueOrThrow({where:{id:unknown.id}});assert.equal(unchanged.executionVersion,unknown.executionVersion);assert.equal(unchanged.effectState,'UNKNOWN');assert.equal(mock.events.filter(e=>e.phase==='accepted'&&e.key.endsWith(unknown.id)).length,1);
 results.push({name:'held-accepted-response-loss-and-real-session-revocation-during-lookup',status:'PASS',id:unknown.id,actorId,sessionId:ownSession.id});

}
 console.log(JSON.stringify({bundle,status:'PASS',checks:results.length,simulated:true}));
}finally{writeFileSync(`${d}/${label}-worker-result.json`,JSON.stringify({at:new Date().toISOString(),bundle,results,fixtures,events:mock.events,facadeRealm:"COMMONJS_SHARED_CACHE",simulated:true},null,2)+'\n',{flag:'wx'});globalThis.fetch=originalFetch;for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill();await server.close();await Promise.allSettled(pending);writeFileSync(`${d}/${label}-mock-closed.json`,JSON.stringify({closed:true,origin:server.origin,at:new Date().toISOString()})+"\n",{flag:"wx"});await db.$disconnect();await (await import('../../../src/lib/prisma')).prisma.$disconnect();}
