import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runAuthDiagnostic,probeNativeAuthentication} from './delivery-auth-diagnostic.mjs';
const ref='eyuctbnlvnbnivwasvqr',host='aws-1-ap-northeast-1.pooler.supabase.com';
const stamp='2026-11-14T05:30:00.000Z';
const env=()=>({GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'KenLeeYa/Stallorder-Platform',GITHUB_REPOSITORY_OWNER:'KenLeeYa',
 GITHUB_ACTOR:'KenLeeYa',GITHUB_TRIGGERING_ACTOR:'KenLeeYa',GITHUB_REF:'refs/heads/main',GITHUB_SHA:'a'.repeat(40),
 GITHUB_WORKFLOW_REF:'KenLeeYa/Stallorder-Platform/.github/workflows/production-delivery-auth-diagnostic.yml@refs/heads/main',
 GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ID:'1234',GITHUB_RUN_ATTEMPT:'1',GITHUB_JOB:'diagnose',
 RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'Linux',RUNNER_NAME:'GitHub Actions 5'});
function fixture(){return {env:env(),token:'sbp_'+'1'.repeat(40),password:'synthetic-placeholder-%@:/雪',clock:()=>stamp,
 fetchImpl:async url=>new Response(JSON.stringify(url.endsWith('/pooler')?[{database_type:'PRIMARY',
  connection_string:`postgresql://postgres.${ref}:provider-placeholder@${host}:6543/postgres`}]:
  {id:ref,status:'ACTIVE_HEALTHY',region:'ap-northeast-1',database:{host:`db.${ref}.supabase.co`}})),
 probe:()=>({status:'authenticated-read-only'})};}
test('diagnosis uses raw password once per fixed endpoint and does not grant capture or release',async()=>{
 const f=fixture(),calls=[];const out=await runAuthDiagnostic({...f,probe:x=>{calls.push(x);return f.probe();}});
 assert.deepEqual(calls.map(c=>[c.mode,c.hostname,c.port,c.username]),[
  ['direct',`db.${ref}.supabase.co`,'5432','postgres'],['transaction',host,'6543',`postgres.${ref}`]]);
 assert.ok(calls.every(c=>c.password===f.password));assert.equal(out.probes.length,2);
 assert.equal(out.releaseAuthorized,false);assert.equal(out.mutationAuthorized,false);assert.equal(out.executorQualified,false);
 assert.ok(!JSON.stringify(out).includes(f.password));
});
test('direct network failure allows exactly one independent transaction probe',async()=>{
 const f=fixture(),calls=[];const out=await runAuthDiagnostic({...f,probe:x=>{calls.push(x.mode);return {
  status:x.mode==='direct'?'DELIVERY_EXECUTOR_CONNECTION_FAILED':'authenticated-read-only'};}});
 assert.deepEqual(calls,['direct','transaction']);assert.equal(out.probes[0].status,'DELIVERY_EXECUTOR_CONNECTION_FAILED');
});
for(const status of ['DELIVERY_EXECUTOR_AUTH_REJECTED','DELIVERY_EXECUTOR_PERMISSION_REJECTED','DELIVERY_EXECUTOR_QUERY_FAILED',
 'DELIVERY_EXECUTOR_STARTUP_REJECTED'])test('direct '+status+' stops without any other auth attempt',async()=>{
 const f=fixture();let calls=0;const out=await runAuthDiagnostic({...f,probe:()=>{calls++;return {status};}});
 assert.equal(calls,1);assert.deepEqual(out.probes.map(p=>p.status),[status]);
});
for(const [name,edit] of [
 ['other actor',f=>{f.env.GITHUB_ACTOR='other';}],['PR source',f=>{f.env.GITHUB_REF='refs/pull/2/merge';}],
 ['other workflow',f=>{f.env.GITHUB_WORKFLOW_REF='other';}],['rerun',f=>{f.env.GITHUB_RUN_ATTEMPT='2';}],
 ['self-hosted',f=>{f.env.RUNNER_ENVIRONMENT='self-hosted';}],['invalid password',f=>{f.password='secret\n';}],
 ['invalid token',f=>{f.token='invalid';}],
])test('diagnosis rejects '+name+' before provider/auth calls',async()=>{
 const f=fixture();edit(f);let calls=0;await assert.rejects(runAuthDiagnostic({...f,fetchImpl:()=>{calls++;throw Error('PRIVATE');},
  probe:()=>{calls++;throw Error('PRIVATE');}}),/^Error: DELIVERY_AUTH_DIAGNOSTIC_[A-Z_]+$/);assert.equal(calls,0);
});
test('provider readback drift fails after bounded probes without exposing payloads',async()=>{
 const f=fixture();let reads=0,probes=0;await assert.rejects(runAuthDiagnostic({...f,fetchImpl:async(url,...args)=>{
  if(++reads>2)throw Error('PRIVATE-CREDENTIAL-MARKER');return f.fetchImpl(url,...args);
 },probe:()=>{probes++;return f.probe();}}),e=>e.message==='DELIVERY_AUTH_DIAGNOSTIC_READBACK'&&!('cause'in e));
 assert.equal(probes,2);assert.equal(reads,4);
});
test('untrusted probe fields are rejected and never returned',async()=>{
 const f=fixture();await assert.rejects(runAuthDiagnostic({...f,probe:()=>({status:'authenticated-read-only',private:f.password})}),
  e=>e.message==='DELIVERY_AUTH_DIAGNOSTIC_PROBE'&&!String(e).includes(f.password)&&!('actual'in e));
});
test('native probe uses one fixed read-only transaction, env-only password and no inherited PG options',()=>{
 const password='synthetic-placeholder-%@:/雪';let calls=0;
 const out=probeNativeAuthentication({mode:'direct',hostname:`db.${ref}.supabase.co`,port:'5432',username:'postgres',password,
  processEnv:{PATH:'/usr/bin',PGPASSWORD:'wrong',PGSERVICE:'wrong',PGOPTIONS:'wrong',SUPABASE_ACCESS_TOKEN:'PRIVATE'},
  execute:(file,args,options)=>{calls++;assert.equal(file,'psql');assert.ok(!args.includes(password));
   assert.equal(options.env.PGPASSWORD,password);assert.equal(options.env.PGHOST,`db.${ref}.supabase.co`);
   assert.equal(options.env.PGSERVICE,undefined);assert.equal(options.env.SUPABASE_ACCESS_TOKEN,undefined);
   assert.equal(options.env.PGOPTIONS,undefined);assert.equal(options.env.PGSSLMODE,'require');
   assert.equal(options.timeout,20000);assert.equal(options.maxBuffer,32768);assert.deepEqual(options.stdio,['pipe','pipe','pipe']);
   assert.match(options.input,/^BEGIN READ ONLY;/);assert.match(options.input,/ROLLBACK;\n$/);
   assert.ok(!options.input.includes(password));return JSON.stringify({currentUser:'postgres',sessionUser:'postgres',database:'postgres',readOnly:'on'});
  }});assert.equal(calls,1);assert.deepEqual(out,{status:'authenticated-read-only'});
});
for(const message of ['password authentication failed for user postgres PRIVATE','network is unreachable PRIVATE',
 'unsupported startup parameter PRIVATE','permission denied PRIVATE','PRIVATE'])test('native diagnostics redact '+message.split(' ')[0],()=>{
 const out=probeNativeAuthentication({mode:'transaction',hostname:host,port:'6543',username:`postgres.${ref}`,password:'synthetic-placeholder',
  execute:()=>{throw Object.assign(Error('PRIVATE'),{stderr:message});}});
 assert.match(out.status,/^DELIVERY_EXECUTOR_/);assert.ok(!JSON.stringify(out).includes('PRIVATE'));
});
for(const [name,value] of [['wrong principal',{currentUser:'other',sessionUser:'postgres',database:'postgres',readOnly:'on'}],
 ['not read-only',{currentUser:'postgres',sessionUser:'postgres',database:'postgres',readOnly:'off'}],
 ['malformed response','PRIVATE']])test('native diagnostic rejects '+name,()=>{
 const out=probeNativeAuthentication({mode:'direct',hostname:`db.${ref}.supabase.co`,port:'5432',username:'postgres',
  password:'synthetic-placeholder',execute:()=>typeof value==='string'?value:JSON.stringify(value)});
 assert.deepEqual(out,{status:'DELIVERY_EXECUTOR_QUERY_FAILED'});
});
for(const edit of [x=>{x.hostname='unrelated.example';},x=>{x.port='6543';},x=>{x.username='other';}])
 test('native probe refuses an unbound target before psql',()=>{let calls=0;const x={mode:'direct',hostname:`db.${ref}.supabase.co`,
  port:'5432',username:'postgres',password:'synthetic-placeholder',execute:()=>{calls++;}};edit(x);
  assert.deepEqual(probeNativeAuthentication(x),{status:'DELIVERY_EXECUTOR_QUERY_FAILED'});assert.equal(calls,0);
 });
test('protected workflow serializes with releases, pins owner/main/staging and cannot write providers',()=>{
 const text=readFileSync(new URL('../../.github/workflows/production-delivery-auth-diagnostic.yml',import.meta.url),'utf8');
 for(const fragment of ['group: production-release-writer','cancel-in-progress: false','environment: production',
  "github.ref == 'refs/heads/main'",'github.run_attempt == 1',"origin/main^{tree}","origin/staging^{tree}",
  'SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}'])assert.ok(text.includes(fragment),fragment);
 assert.ok(!/contents: write|actions: write|secrets: write|upload-artifact|workflow_call|VERCEL_TOKEN/.test(text));
});
