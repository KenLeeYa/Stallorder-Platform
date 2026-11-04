import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDatabaseCaptureContext,validatePrimaryEndpoint,captureDatabaseExecutor} from './delivery-database-executor.capture.mjs';
const ref='eyuctbnlvnbnivwasvqr';
const env=()=>({GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'KenLeeYa/Stallorder-Platform',GITHUB_REPOSITORY_OWNER:'KenLeeYa',GITHUB_ACTOR:'KenLeeYa',GITHUB_TRIGGERING_ACTOR:'KenLeeYa',RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'Linux',GITHUB_REF:'refs/heads/main',GITHUB_WORKFLOW_REF:'KenLeeYa/Stallorder-Platform/.github/workflows/production-delivery-evidence.yml@refs/heads/main',GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'12345',GITHUB_RUN_ATTEMPT:'1',GITHUB_EVENT_NAME:'workflow_dispatch',DELIVERY_EXECUTOR_SCOPE:'PRIMARY_READ_ONLY_EXECUTOR'});
const project=()=>({id:ref,status:'ACTIVE_HEALTHY',region:'ap-northeast-1',database:{host:'db.'+ref+'.supabase.co'}});
const poolers=()=>[{database_type:'PRIMARY',connection_string:'postgres://postgres.'+ref+':provider-placeholder@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres'}];
test('context binds exact owner-dispatched protected main',()=>{assert.equal(validateDatabaseCaptureContext(env()).runAttempt,1);});
for(const [key,value] of Object.entries({GITHUB_ACTOR:'other',GITHUB_TRIGGERING_ACTOR:'other',GITHUB_REF:'refs/heads/staging',GITHUB_EVENT_NAME:'push',GITHUB_WORKFLOW_REF:'other',RUNNER_ENVIRONMENT:'self-hosted',DELIVERY_EXECUTOR_SCOPE:'all',GITHUB_RUN_ATTEMPT:'0'}))test('rejects capture context '+key,()=>assert.throws(()=>validateDatabaseCaptureContext({...env(),[key]:value})));
test('provider endpoint is an explicit session target with no provider password or query',()=>{
 const out=validatePrimaryEndpoint(project(),poolers());assert.deepEqual(out,{projectId:ref,hostname:'aws-1-ap-northeast-1.pooler.supabase.com',port:'5432',username:'postgres.'+ref,database:'postgres'});
 assert.ok(!JSON.stringify(out).includes('provider-placeholder'));
});
for(const [label,change] of [
 ['wrong project',(p)=>p.id='other'],['wrong database host',(p)=>p.database.host='db.other.supabase.co'],
 ['unhealthy',(p)=>p.status='COMING_UP'],['wrong region',(p)=>p.region='ap-southeast-1'],
 ['missing PRIMARY',(_p,x)=>x[0].database_type='READ_REPLICA'],['duplicate PRIMARY',(_p,x)=>x.push({...x[0]})],
 ['foreign user',(_p,x)=>x[0].connection_string=x[0].connection_string.replace(ref,'teunnvfakbfzmodajqjz')],
 ['foreign host',(_p,x)=>x[0].connection_string=x[0].connection_string.replace('supabase.com','attacker.invalid')],
 ['host query override',(_p,x)=>x[0].connection_string+='?host=evil.invalid'],
 ['unknown database',(_p,x)=>x[0].connection_string=x[0].connection_string.replace('/postgres','/other')],
])test('rejects provider '+label,()=>{const p=project(),x=poolers();change(p,x);assert.throws(()=>validatePrimaryEndpoint(p,x));});
test('capture uses only bounded fixed GETs, verifies readback, and keeps passwords out of receipt',async()=>{
 const calls=[];let queries=0;
 const fetchImpl=async(url,init)=>{calls.push(url);assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.ok(init.signal);return new Response(JSON.stringify(url.endsWith('/pooler')?poolers():project()));};
 const out=await captureDatabaseExecutor({env:env(),token:'sbp_'+'a'.repeat(40),password:'synthetic-db-password',fetchImpl,collect:({connection,plan,endpoint})=>{queries++;assert.ok(connection.includes('synthetic-db-password'));assert.ok(!connection.includes('jit'));assert.equal(plan.database.executor.authentication,'database-password');return{executor:{observedAt:new Date().toISOString(),name:'postgres'},endpoint,requestStartedAt:new Date().toISOString(),requestFinishedAt:new Date().toISOString(),releaseAuthorized:false};}});
 assert.equal(calls.length,4);assert.equal(queries,1);assert.equal(out.releaseAuthorized,false);assert.equal(out.productCommit,'b9a98a0bff0490c04b2295e4bcfb2b7781774c91');assert.ok(!JSON.stringify(out).includes('synthetic-db-password'));
});
test('provider drift after the query invalidates the whole capture',async()=>{
 let calls=0;const fetchImpl=async(url)=>{calls++;const p=project();if(calls>2)p.status='COMING_UP';return new Response(JSON.stringify(url.endsWith('/pooler')?poolers():p));};
 await assert.rejects(()=>captureDatabaseExecutor({env:env(),token:'sbp_'+'a'.repeat(40),password:'synthetic',fetchImpl,collect:()=>({executor:{observedAt:new Date().toISOString()}})}));
});
test('oversized response fails before psql',async()=>{
 let queries=0;await assert.rejects(()=>captureDatabaseExecutor({env:env(),token:'sbp_'+'a'.repeat(40),password:'synthetic',fetchImpl:async()=>new Response('x'.repeat(131073)),collect:()=>{queries++;}}));assert.equal(queries,0);
});

import {readFileSync} from 'node:fs';
import {collectExecutor} from './delivery-database-executor.mjs';
for (const password of ['synthetic%40secret','synthetic%secret','synthetic@:/?#secret']) test('raw database password survives URL and libpq transport '+password,async()=>{
 const fetchImpl=async(url)=>new Response(JSON.stringify(url.endsWith('/pooler')?poolers():project()));
 let calls=0;
 await captureDatabaseExecutor({env:env(),token:'sbp_'+'a'.repeat(40),password,fetchImpl,collect:args=>collectExecutor({...args,invoke:(_binary,_args,options)=>{
  calls++;assert.equal(options.env.PGPASSWORD,password);
  const plan=JSON.parse(readFileSync(new URL('./delivery-executor-contract.json',import.meta.url)));
  return JSON.stringify({schema:'stallorder-delivery-executor/v1',proofType:'migration-connection-query',observedAt:new Date().toISOString(),currentUser:'postgres',sessionUser:'postgres',database:'postgres',serverVersionNum:170006,superuser:false,bypassRls:true,transactionReadOnly:true,backendPid:12,createPublic:true,helperExists:false,functions:plan.database.functions.map(fn=>({...fn,executorExecute:true}))});
 }})});assert.equal(calls,1);
});

for (const [label, times] of [
 ['finished before provider readback',[0,10,15,20,30,5]],
 ['collector starts before capture',[0,-1,15,20,30,40]],
 ['query before collector starts',[0,20,15,25,30,40]],
 ['query after collector finished',[0,10,25,20,30,40]],
 ['collector finished after readback started',[0,10,15,35,30,40]],
 ['capture exceeds ninety seconds',[0,10,15,20,30,90001]],
])test('capture rejects non-monotonic or stale receipt: '+label,async()=>{
 const iso=n=>new Date(Date.UTC(2026,10,4)+n).toISOString();const [start,collectorStart,query,collectorEnd,readback,end]=times;
 const clock=[iso(start),iso(readback),iso(end)];const fetchImpl=async(url)=>new Response(JSON.stringify(url.endsWith('/pooler')?poolers():project()));
 await assert.rejects(()=>captureDatabaseExecutor({env:env(),token:'sbp_'+'a'.repeat(40),password:'synthetic',fetchImpl,now:()=>clock.shift(),collect:()=>({executor:{observedAt:iso(query)},requestStartedAt:iso(collectorStart),requestFinishedAt:iso(collectorEnd)})}));
});
