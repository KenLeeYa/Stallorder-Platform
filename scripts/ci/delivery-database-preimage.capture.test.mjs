import test from 'node:test';
import assert from 'node:assert/strict';
import {captureNativePreimage,nativePreimageCaptureFailure} from './delivery-database-preimage.capture.mjs';
import {readNativePreimageEvents} from './delivery-database-preimage.archive.mjs';
const ref='eyuctbnlvnbnivwasvqr',token='sbp_'+'a'.repeat(40),at='2026-11-14T04:00:00.000Z';
const env=()=>({GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'KenLeeYa/Stallorder-Platform',GITHUB_REPOSITORY_OWNER:'KenLeeYa',GITHUB_ACTOR:'KenLeeYa',GITHUB_TRIGGERING_ACTOR:'KenLeeYa',RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'Linux',GITHUB_REF:'refs/heads/main',GITHUB_WORKFLOW_REF:'KenLeeYa/Stallorder-Platform/.github/workflows/production-delivery-evidence.yml@refs/heads/main',GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'12345',GITHUB_RUN_ATTEMPT:'1',GITHUB_EVENT_NAME:'workflow_dispatch',DELIVERY_EXECUTOR_SCOPE:'PRIMARY_READ_ONLY_EXECUTOR'});
const project=()=>({id:ref,status:'ACTIVE_HEALTHY',region:'ap-northeast-1',database:{host:'db.'+ref+'.supabase.co'}});
const poolers=()=>[{database_type:'PRIMARY',connection_string:'postgres://postgres.'+ref+':provider-placeholder@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres'}];
const versions=Array.from({length:146},(_,i)=>String(20200101000000+i));
const fixture=()=>({env:env(),token,password:'synthetic%40secret',versions,clock:()=>at,
 fetchImpl:async url=>new Response(JSON.stringify(url.endsWith('/pooler')?poolers():project())),
 collect:()=>({requestStartedAt:at,requestFinishedAt:at,preimageSha256:'c'.repeat(64),raw:{schema:'stallorder-delivery-native-preimage/v1',observedAt:at,snapshot:{private:'PRIVATE-SOURCE-MARKER'}}})});
test('protected native producer reads fixed endpoints twice and emits only encrypted complete state',async()=>{
 const f=fixture();let reads=0,queries=0;
 const out=await captureNativePreimage({...f,fetchImpl:async(url,init)=>{
  reads++;assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.ok(init.signal);return f.fetchImpl(url);
 },collect:args=>{queries++;assert.equal(decodeURIComponent(new URL(args.connection).password),f.password);assert.deepEqual(args.versions,versions);return f.collect();}});
 assert.equal(reads,4);assert.equal(queries,1);assert.ok(!JSON.stringify(out).includes('PRIVATE-SOURCE-MARKER'));
 assert.ok(!JSON.stringify(out).includes(f.password));
 const a=readNativePreimageEvents(out,token);assert.equal(a.raw.snapshot.private,'PRIVATE-SOURCE-MARKER');
 assert.equal(a.controlCommit,f.env.GITHUB_SHA);assert.equal(a.releaseAuthorized,false);
 assert.ok(Object.keys(a.sourceDigests).length>=8);
});
for(const kind of ['context','password','provider','readback','collector'])test('native producer rejects '+kind+' without secret errors or retries',async()=>{
 const f=fixture();let queries=0,reads=0;
 if(kind==='context')f.env.GITHUB_ACTOR='other';if(kind==='password')f.password='';
 const baseFetch=f.fetchImpl;f.fetchImpl=async(url,init)=>{reads++;if(kind==='provider'||kind==='readback'&&reads>2)throw new Error('PRIVATE-SOURCE-MARKER');return baseFetch(url,init);};
 const baseCollect=f.collect;f.collect=args=>{queries++;if(kind==='collector')throw new Error('PRIVATE-SOURCE-MARKER');return baseCollect(args);};
 await assert.rejects(()=>captureNativePreimage(f),error=>{assert.ok(/^DELIVERY_NATIVE_CAPTURE_[A-Z_]+$/.test(nativePreimageCaptureFailure(error)));assert.ok(!String(error).includes('PRIVATE-SOURCE-MARKER'));assert.equal(error.cause,undefined);return true;});
 assert.equal(queries,['readback','collector'].includes(kind)?1:0);
});
