import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EDGE_SLUGS} from './delivery-edge-recovery.mjs';
import {validatePairedSnapshot} from './delivery-edge-paired-snapshot.mjs';
import {validateEdgeRehearsalContext, validatePairedInstallation, capturePairedPreimages, pairedUsageDatabaseUrl, verifyPairedUsagePrincipal} from './delivery-edge-rehearsal-entry.mjs';
import * as entry from './delivery-edge-rehearsal-entry.mjs';

test('installation uses an independent provider workflow pin and cannot self-pin from a current run',()=>{
 const value={schema:'stallorder-paired-edge-installation/v1',repository:'KenLeeYa/Stallorder-Platform',repositoryId:1298874780,
  workflow:'.github/workflows/production-delivery-edge-rehearsal.yml',workflowId:90,
  isolatedProject:'teunnvfakbfzmodajqjz',productCommit:'0d2b27144fcf589bb887e669c09e82158e3de7a2',firstRunNumber:1,maxRunAttempt:1};
 assert.equal(validatePairedInstallation(value).workflowId,90);
 for(const change of [{workflowId:null},{workflowId:0},{workflowId:'90'},{repositoryId:1},
  {workflow:'.github/workflows/other.yml'},{isolatedProject:'eyuctbnlvnbnivwasvqr'},
  {firstRunNumber:2},{maxRunAttempt:2},{productCommit:'a'.repeat(40)},{currentRun:{workflow_id:90}}]) {
  assert.throws(()=>validatePairedInstallation({...value,...change}));
 }
});

function env() {return {GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'KenLeeYa/Stallorder-Platform',
  GITHUB_REPOSITORY_OWNER: 'KenLeeYa', GITHUB_ACTOR: 'KenLeeYa', GITHUB_TRIGGERING_ACTOR: 'KenLeeYa',
  GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch', RUNNER_ENVIRONMENT: 'github-hosted',
  RUNNER_OS: 'Linux', RUNNER_NAME:'GitHub Actions 1', GITHUB_JOB:'snapshot', EDGE_REHEARSAL_PHASE:'snapshot',
  GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '100', GITHUB_RUN_ATTEMPT: '1',
  GITHUB_WORKFLOW_REF: 'KenLeeYa/Stallorder-Platform/.github/workflows/production-delivery-edge-rehearsal.yml@refs/heads/main'};}
test('entry only admits fixed protected owner main workflow on hosted Linux', () => {
  assert.equal(validateEdgeRehearsalContext(env()).controlCommit, 'a'.repeat(40));
  for (const change of [{GITHUB_REF: 'refs/heads/staging'}, {GITHUB_ACTOR: 'other'},
    {GITHUB_TRIGGERING_ACTOR: 'other'}, {GITHUB_EVENT_NAME: 'pull_request'},
    {GITHUB_WORKFLOW_REF: 'other'}, {GITHUB_SHA: 'main'}, {RUNNER_ENVIRONMENT: 'self-hosted'},
    {GITHUB_RUN_ATTEMPT:'2'},{RUNNER_NAME:'local'},{GITHUB_JOB:'replay'},
    {EDGE_REHEARSAL_PHASE:'rehearse',GITHUB_JOB:'rehearse'}]) {
    assert.throws(() => validateEdgeRehearsalContext({...env(), ...change}));
  }
});
test('paired session connection preserves stricter TLS validation',()=>{
  const config={POSTGRES_URL:'postgresql://postgres.teunnvfakbfzmodajqjz:example-preview-placeholder@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=verify-full&pgbouncer=true',
    SUPABASE_URL:'https://teunnvfakbfzmodajqjz.supabase.co',SUPABASE_ANON_KEY:'synthetic-anon-key'};
  const result=new URL(pairedUsageDatabaseUrl(config));
  assert.equal(result.searchParams.get('sslmode'),'verify-full');assert.equal(result.port,'5432');
  assert.equal(result.searchParams.has('pgbouncer'),false);
});
test('the same paired fixture connection must prove its actual role and schema privileges',async()=>{
  const at=new Date().toISOString();
  const row={currentUser:'postgres',sessionUser:'postgres',database:'postgres',superuser:false,bypassRls:true,
    databaseConnect:true,publicUsage:true,privateUsage:true,observedAt:at};
  assert.equal((await verifyPairedUsagePrincipal({$queryRawUnsafe:async()=>[row]},()=>Date.parse(at))).bypassRls,true);
  for(const change of [{currentUser:'other'},{sessionUser:'supabase_admin'},{superuser:true},{bypassRls:false},
    {database:'other'},{databaseConnect:false},{publicUsage:false},{privateUsage:false},{observedAt:'2020-01-01T00:00:00.000Z'}]) {
    await assert.rejects(()=>verifyPairedUsagePrincipal({$queryRawUnsafe:async()=>[{...row,...change}]},()=>Date.parse(at)));
  }
});
test('snapshot refuses an unverified archive before touching the isolated project', async () => {
  let reads = 0;
  await assert.rejects(capturePairedPreimages({context: validateEdgeRehearsalContext(env()),
    admitted: {evidence: {archiveSha256: 'b'.repeat(64), releaseAuthorized: true}},
    read: async () => {reads++;}}));
  assert.equal(reads, 0);
});
test('snapshot durably binds both usage passes and every immutable replay target',async()=>{
  const context=validateEdgeRehearsalContext(env()),reads=[];
  function records(prefix) {return EDGE_SLUGS.map((slug,i)=>{
    const bytes=Buffer.from('EZBR-'+prefix+'-'+slug),digest=createHash('sha256').update(bytes).digest('hex');
    return {slug,wireSha256:digest,wireBase64:bytes.toString('base64'),metadata:{
      id:'12345678-1234-1234-1234-'+String(i+1).padStart(12,'0'),slug,status:'ACTIVE',version:10,
      verify_jwt:false,sha256:digest,entrypoint_path:'file:///index.ts',import_map_path:'file:///deno.json'}};
  });}
  const primary=records('primary'),paired=records('paired');
  const admitted={evidence:{releaseAuthorized:false,controlCommit:context.controlCommit,
    project:'eyuctbnlvnbnivwasvqr',archiveSha256:'b'.repeat(64)},archive:{functions:primary}};
  let preflightPassed=false;
  const snapshot=await capturePairedPreimages({context,admitted,preflight:async()=>{preflightPassed=true;},clock:()=> '2026-11-05T09:00:00.000Z',
    read:async args=>{assert.equal(preflightPassed,true);reads.push(args);return paired.find(r=>r.slug===args.slug);}});
  validatePairedSnapshot(snapshot);
  assert.deepEqual(reads,EDGE_SLUGS.map(slug=>({project:'teunnvfakbfzmodajqjz',slug})));
  assert.deepEqual(snapshot.functions,paired);
  assert.deepEqual(snapshot.replayTargets,primary.map(r=>({slug:r.slug,wireSha256:r.wireSha256,
    entrypoint_path:r.metadata.entrypoint_path,import_map_path:r.metadata.import_map_path,import_map:null})));
  assert.equal(snapshot.usageFixtures.length,2);
  assert.notEqual(snapshot.usageFixtures[0].organizationId,snapshot.usageFixtures[1].organizationId);
  assert.equal(snapshot.releaseAuthorized,false);
});

test('missing or rejected usage preflight prevents an admitted snapshot from touching Edge',async()=>{
  for(const preflight of [undefined,async()=>{throw new Error('synthetic missing Preview or runtime');}]) {
    let reads=0;
    const context=validateEdgeRehearsalContext(env());
    const admitted={evidence:{releaseAuthorized:false,controlCommit:context.controlCommit,
      project:'eyuctbnlvnbnivwasvqr',archiveSha256:'b'.repeat(64)},archive:{functions:EDGE_SLUGS.map(slug=>({slug,
        wireSha256:'c'.repeat(64),metadata:{entrypoint_path:'file:///index.ts',import_map_path:'file:///deno.json'}}))}};
    await assert.rejects(capturePairedPreimages({context,admitted,preflight,read:async()=>{reads++;}}));
    assert.equal(reads,0);
  }
});
function usagePreflightFixture() {
  const at=new Date().toISOString(),calls=[];
  const config={POSTGRES_URL:'postgresql://postgres.teunnvfakbfzmodajqjz:example-preview-placeholder@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=verify-full&pgbouncer=true',
    SUPABASE_URL:'https://teunnvfakbfzmodajqjz.supabase.co',SUPABASE_ANON_KEY:'synthetic-anon-key'};
  const row={currentUser:'postgres',sessionUser:'postgres',database:'postgres',superuser:false,bypassRls:true,
    databaseConnect:true,publicUsage:true,privateUsage:true,observedAt:at};
  const db={$queryRawUnsafe:async sql=>{assert.match(sql,/^SELECT /);calls.push('principal');return [row];},
    $disconnect:async()=>{calls.push('disconnect');}};
  return {calls,db,config,row,clock:()=>Date.parse(at),loadOrigin:async()=>{calls.push('origin');return 'https://synthetic-preview.invalid';},
    loadConfiguration:async()=>{calls.push('config');return config;},
    createDatabase:url=>{assert.equal(new URL(url).port,'5432');calls.push('runtime');return db;}};
}
test('usage preflight verifies origin, isolated configuration and actual principal without fixture writes',async()=>{
  assert.equal(typeof entry.preparePairedUsage,'function');
  const x=usagePreflightFixture(),out=await entry.preparePairedUsage(x);
  assert.equal(out.db,x.db);assert.equal(out.principal.currentUser,'postgres');
  assert.deepEqual(x.calls,['origin','config','runtime','principal']);
});
for(const point of ['origin','config','runtime','principal'])test('usage preflight fails closed at '+point,async()=>{
  assert.equal(typeof entry.preparePairedUsage,'function');
  const x=usagePreflightFixture(),fail=()=>{throw new Error('synthetic private credential');};
  if(point==='origin')x.loadOrigin=fail;
  if(point==='config')x.config.SUPABASE_URL='https://eyuctbnlvnbnivwasvqr.supabase.co';
  if(point==='runtime')x.createDatabase=fail;
  if(point==='principal')x.row.currentUser='other';
  await assert.rejects(entry.preparePairedUsage(x),/^Error: EDGE_USAGE_PREFLIGHT_FAILED$/);
  assert.equal(x.calls.includes('disconnect'),point==='principal');
  if(['origin','config'].includes(point))assert.equal(x.calls.includes('runtime'),false);
});
