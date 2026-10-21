// Test-only transport seam. No production module imports until provenance and local guards pass.
import assert from 'node:assert/strict';
import {createECDH,randomBytes,randomUUID,createHash} from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import type {PrismaClient} from '@prisma/client';
import {readResponsiveBuildProvenance} from '../../responsive-build-provenance.mjs';
import {openGuardedDatabase,verifyLiveFixture} from '../../../docs/awesome-optimization/qa/live-fixture-guard.mjs';

export async function proveStaffPushRejection(db:PrismaClient,profileId:string,stallId:string,sessionId:string,createOrder:()=>Promise<string>) {
  assert.deepEqual((globalThis as unknown as Record<symbol,unknown>)[Symbol.for('b4a.serverOnlyMarker')],{shimSha256:'89636e6baca4e821a069e0af23a497b3d43b68965625054c190689a7f8cce828',sourceSha256:process.env.AWESOME_QA_EXPECTED_SOURCE_SHA256},'B4A_GUARDED_LOADER_REQUIRED');
  const source=readResponsiveBuildProvenance({expectedSourceSha256:process.env.AWESOME_QA_EXPECTED_SOURCE_SHA256});
  const gate=await openGuardedDatabase();await verifyLiveFixture(gate);await gate.$disconnect();
  const profile=await db.profile.findUniqueOrThrow({where:{id:profileId}});assert.ok(profile.email?.startsWith('awesome-b4a-'));
  const session=await db.authSession.findUniqueOrThrow({where:{id:sessionId}});assert.equal(session.profileId,profileId);assert.equal(session.revokedAt,null);
  const originalSubscriptions=await db.staffPushSubscription.findMany({orderBy:{id:'asc'}});
  const originalDeliveries=await db.staffPushDelivery.findMany({orderBy:{id:'asc'}});
  // Ruling36: exact facts retained by the first failed module-load attempt, never adopted by prefix.
  const priorBytes=readFileSync('.superpowers/sdd/2026-10-01-awesome-optimization/batch-4a/first-worker-facts.json');
  assert.equal(createHash('sha256').update(priorBytes).digest('hex'),'15305da13528c0c96ac8a5a83fd215c654014e99e8a8772308c14f20baad55db');
  const prior=JSON.parse(priorBytes.toString()) as {deliveries:typeof originalDeliveries;subscriptions:typeof originalSubscriptions};
  const priorIds=['98fb2b7c-e0b6-4402-ae9b-f39e1c60101c','ecdd007c-c8c2-4ba8-a02d-06f83ad435a3'];
  assert.deepEqual(prior.deliveries.map(v=>v.id),priorIds);
  const priorBefore=originalDeliveries.filter(v=>priorIds.includes(v.id));assert.equal(priorBefore.length,2);
  for(const row of priorBefore){const initial=prior.deliveries.find(v=>v.id===row.id)!;assert.deepEqual(JSON.parse(JSON.stringify(row)),row.status==='CANCELLED'?{...initial,status:'CANCELLED',errorCode:'DELIVERY_EXPIRED'}:initial);}
  assert.deepEqual(JSON.parse(JSON.stringify(originalSubscriptions.filter(v=>prior.subscriptions.some(p=>p.id===v.id)))),prior.subscriptions);
  const {encryptSubscription,pushHash}=await import('../../../src/server/notifications/staff-push-crypto');
  const ec=createECDH('prime256v1');ec.generateKeys();
  const synthetic={WEB_PUSH_ENABLED:'true',WEB_PUSH_VAPID_PUBLIC_KEY:ec.getPublicKey().toString('base64url'),WEB_PUSH_VAPID_PRIVATE_KEY:ec.getPrivateKey().toString('base64url'),WEB_PUSH_ENCRYPTION_KEY:randomBytes(32).toString('base64'),WEB_PUSH_VAPID_SUBJECT:'mailto:synthetic@stallorder.test'};
  const priorEnvironment=Object.fromEntries(Object.keys(synthetic).map(k=>[k,process.env[k]]));
  const ownedIds:string[]=[],hits:{deliveryId:string;status:number}[]=[],challenge=randomUUID();
  const server=http.createServer((req,res)=>{
    if(req.method!=='POST'||req.url!=='/b4a-reject'||req.headers['x-b4a-challenge']!==challenge){res.writeHead(403).end();return;}
    let body='';req.on('data',chunk=>{body+=chunk;if(Buffer.byteLength(body)>4096)req.destroy();});
    req.on('end',()=>{try{const payload=JSON.parse(body);assert.ok(ownedIds.includes(payload.deliveryId));assert.equal(payload.type,'STAFF_NEW_ORDER');hits.push({deliveryId:payload.deliveryId,status:418});res.writeHead(418,{'content-type':'text/plain'}).end('SIMULATED_REJECTION');}catch{res.writeHead(400).end();}});
  });
  const webPush=(await import('web-push')).default;
  const originalSend=webPush.sendNotification,originalHttps=https.request,originalHttp=http.request,originalConnect=net.Socket.prototype.connect;
  let facadeInstalled=false,port=0;
  try{
    for(let n=0;n<2;n++){
      const id=randomUUID(),endpoint=`https://fcm.googleapis.com/fcm/send/awesome-b4a-${id}`;
      assert.equal(await db.staffPushSubscription.count({where:{id}}),0);
      await db.staffPushSubscription.create({data:{id,stallId,profileId,sessionFamilyId:session.rotationFamilyId,sessionVersion:session.profileSessionVersion,endpointHash:pushHash(endpoint),vapidKeyHash:pushHash(synthetic.WEB_PUSH_VAPID_PUBLIC_KEY),encryptedSubscription:encryptSubscription({endpoint,keys:{auth:randomBytes(16).toString('base64url'),p256dh:ec.getPublicKey().toString('base64url')}},synthetic.WEB_PUSH_ENCRYPTION_KEY)}});
    }
    const orderId=await createOrder();
    const facts=await db.staffPushDelivery.findMany({where:{orderId},orderBy:{id:'asc'}});assert.equal(facts.length,2);assert.ok(facts.every(v=>v.status==='PENDING'&&v.attempts===0));ownedIds.push(...facts.map(v=>v.id));
    const now=new Date();
    const eligible=await db.staffPushDelivery.findMany({where:{OR:[{status:{in:['PENDING','PROCESSING']},expiresAt:{lte:now}},{status:'PROCESSING',claimedAt:{lt:new Date(now.getTime()-120000)}},{status:'PENDING',attempts:{gte:4}},{status:'PENDING',availableAt:{lte:now},expiresAt:{gt:now},attempts:{lt:4}}]},select:{id:true},orderBy:{id:'asc'}});
    assert.ok(eligible.every(v=>ownedIds.includes(v.id)||priorIds.includes(v.id)),'UNOWNED_GLOBAL_WORKER_CANDIDATE_STOP');assert.ok(ownedIds.every(id=>eligible.some(v=>v.id===id)));
    assert.ok(priorBefore.every(v=>v.expiresAt<=now),'PRIOR_OWNED_FACTS_NOT_YET_EXPIRED_STOP');
    const cron=await db.$queryRaw<{count:bigint}[]>`select count(*) from cron.job where active and command ilike '%staff-push%'`;assert.equal(Number(cron[0].count),0);
    const processes=JSON.parse(execFileSync('powershell',['-NoProfile','-Command',"@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'staff-push' } | Select-Object ProcessId,CommandLine) | ConvertTo-Json -Compress"],{encoding:'utf8',windowsHide:true})||'[]');
    assert.equal(Array.isArray(processes)?processes.length:1,0,'OTHER_STAFF_PUSH_EXECUTOR_STOP');
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert.ok(address&&typeof address==='object');port=address.port;
    const deny=()=>{throw Error('B4A_EXTERNAL_NETWORK_DENIED');};https.request=deny as typeof https.request;
    http.request=deny as typeof http.request;
    net.Socket.prototype.connect=function(this:net.Socket,...args:unknown[]){
      const first=Array.isArray(args[0])?args[0][0]:args[0];
      const options=typeof first==='object'&&first!==null?first as {host?:string;port?:number|string;path?:string}:{port:first,host:args[1]};
      if(!['127.0.0.1','localhost'].includes(String(options.host))||![port,56822].includes(Number(options.port))||('path' in options&&options.path))throw Error('B4A_EXTERNAL_NETWORK_DENIED');
      return Reflect.apply(originalConnect,this,args);
    } as typeof net.Socket.prototype.connect;
    webPush.sendNotification=(async(subscription,payload)=>{
      assert.equal(facadeInstalled,true);assert.ok(subscription.endpoint.startsWith('https://fcm.googleapis.com/fcm/send/awesome-b4a-'));
      const parsed=JSON.parse(String(payload));assert.ok(ownedIds.includes(parsed.deliveryId));
      const status=await new Promise<number>((resolve,reject)=>{
        const req=originalHttp({hostname:'127.0.0.1',port,path:'/b4a-reject',method:'POST',headers:{'x-b4a-challenge':challenge,'content-type':'application/json'},timeout:3000},res=>{res.resume();resolve(res.statusCode??0);});req.on('error',reject);req.on('timeout',()=>req.destroy(Error('MOCK_TIMEOUT')));req.end(payload);
      });assert.equal(status,418);throw Object.assign(Error('SIMULATED_REJECTION'),{statusCode:418});
    }) as typeof webPush.sendNotification;
    facadeInstalled=true;Object.assign(process.env,synthetic);
    assert.throws(()=>https.request('https://example.invalid'),/B4A_EXTERNAL_NETWORK_DENIED/);assert.throws(()=>http.request('http://example.invalid'),/B4A_EXTERNAL_NETWORK_DENIED/);
    assert.throws(()=>new net.Socket().connect(443,'example.invalid'),/B4A_EXTERNAL_NETWORK_DENIED/);
    const {processStaffPushJobs}=await import('../../../src/server/notifications/staff-push-service');
    const result=await processStaffPushJobs(now);assert.equal(result.configured,true);assert.equal(result.results.length,2);assert.equal(hits.length,2);
    const after=await db.staffPushDelivery.findMany({where:{id:{in:ownedIds}},orderBy:{id:'asc'}});
    assert.ok(after.every(v=>v.status==='FAILED'&&v.errorCode==='PUSH_HTTP_418'&&v.attempts===1&&v.sentAt===null&&v.displayedAt===null));
    const nonownedBefore=originalDeliveries.filter(v=>!priorIds.includes(v.id));
    assert.deepEqual(await db.staffPushDelivery.findMany({where:{id:{in:nonownedBefore.map(v=>v.id)}},orderBy:{id:'asc'}}),nonownedBefore);
    const priorAfter=await db.staffPushDelivery.findMany({where:{id:{in:priorIds}},orderBy:{id:'asc'}});
    assert.deepEqual(priorAfter,priorBefore.map(v=>({...v,status:'CANCELLED',errorCode:'DELIVERY_EXPIRED'})));
    assert.deepEqual(await db.staffPushSubscription.findMany({where:{id:{in:originalSubscriptions.map(v=>v.id)}},orderBy:{id:'asc'}}),originalSubscriptions);
    return {outcome:'SIMULATED_REJECTION',orderId,sourceSha256:source.sourceAfter.sourceSha256,now:now.toISOString(),eligible,deliveryIds:ownedIds,hits,results:result.results,preexistingDeliveryCount:originalDeliveries.length,preexistingSubscriptionCount:originalSubscriptions.length,nonownedFactsPreserved:true,priorOwnedExpiry:{before:priorBefore,after:priorAfter,by:'original worker expiry update; no reset or timestamp rewrite'},networkNegatives:true,physical:'NOT_RUN',genuineProvider:'NOT_RUN',acceptedMock:'NOT_RUN',socket:{host:'127.0.0.1',port,finallyClosed:true},factsDigest:createHash('sha256').update(JSON.stringify(after)).digest('hex')};
  }finally{
    facadeInstalled=false;webPush.sendNotification=originalSend;https.request=originalHttps;http.request=originalHttp;net.Socket.prototype.connect=originalConnect;
    for(const [key,value]of Object.entries(priorEnvironment)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));
    const {prisma}=await import('../../../src/lib/prisma');await prisma.$disconnect();
  }
}
