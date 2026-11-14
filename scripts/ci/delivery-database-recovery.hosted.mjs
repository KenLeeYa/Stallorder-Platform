import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, readFileSync, readdirSync, unlinkSync, copyFileSync } from 'node:fs';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { SNAPSHOT_SQL, recoverySql, validateSnapshots, applySql, classifyApplyOutcome } from './delivery-database-recovery.mjs';
import { NATIVE_PREIMAGE_SQL, verifyNativePreimage } from './delivery-database-preimage.mjs';
import {sealNativePreimage,formatNativePreimageCapture,readNativePreimageEvents} from './delivery-database-preimage.archive.mjs';
import {encodeNativePostimageTemplate,materializeNativePostimage} from './delivery-database-postimage.mjs';

const control = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const product = resolve(control, '../product'), recovery = resolve(control, '../recovery');
const migration = '20261029090000_public_delivery_ordering_hours.sql';
const manifest = JSON.parse(readFileSync(resolve(control, 'scripts/ci/delivery-source/manifest.json')));
const hash = value => createHash('sha256').update(value).digest('hex');
const emit = (event, detail = {}) => console.log(JSON.stringify({ at:new Date().toISOString(), event, ...detail }));
assert.equal(process.env.GITHUB_ACTIONS,'true'); assert.equal(process.env.GITHUB_REPOSITORY,'KenLeeYa/Stallorder-Platform');
assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted'); assert.equal(process.env.RUNNER_OS,'Linux');
assert.equal(process.env.DELIVERY_RECOVERY_OWNED,'synthetic-loopback-only');
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:product,encoding:'utf8'}).trim(),manifest.commit);
assert.equal(execFileSync('git',['status','--porcelain'],{cwd:product,encoding:'utf8'}).trim(),'');
const versionFiles = readdirSync(resolve(product,'supabase/migrations')).filter(name=>/^\d{14}_.+\.sql$/.test(name)).sort();
assert.equal(versionFiles.length,147); assert.equal(versionFiles.at(-1),migration);

if(process.argv[2]==='prepare') {
  assert.equal(existsSync(recovery),false,'recovery directory must be fresh');
  assert.equal(execFileSync('docker',['ps','-aq'],{encoding:'utf8'}).trim(),'','runner already owns other Docker resources');
  cpSync(resolve(product,'supabase'),resolve(recovery,'supabase'),{recursive:true,errorOnExist:true,force:false});
  unlinkSync(resolve(recovery,'supabase/migrations',migration));
  emit('prepared',{productCommit:manifest.commit, productTree:manifest.tree, baselineMigrations:146,
    migrationSha256:hash(readFileSync(resolve(product,'supabase/migrations',migration))), releaseAuthorized:false});
} else {
  assert.equal(process.argv[2],'rehearse');
  const env={...process.env}; for(const key of Object.keys(env)) if(key.toUpperCase().startsWith('PG')) delete env[key];
  Object.assign(env,{PGHOST:'127.0.0.1',PGPORT:'54322',PGUSER:'postgres',PGDATABASE:'postgres',PGPASSWORD:'postgres',
    PGSSLMODE:'disable',PGCONNECT_TIMEOUT:'10',PGOPTIONS:'-c search_path=pg_catalog -c statement_timeout=30000'});
  function sql(input, expectedError) {
    const r=spawnSync('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],
      {cwd:recovery,env,input,encoding:'utf8',timeout:45000,maxBuffer:8*1024*1024});
    if(expectedError) {
      assert.ok(r.status!==null && r.status!==0 && r.stderr.includes(expectedError),'expected SQL failure not observed');
      return;
    }
    assert.equal(r.status,0,`owned SQL failed (${String(r.stderr).slice(0,200)})`);
    return r.stdout.trim();
  }
  const snapshot=()=>JSON.parse(sql(SNAPSHOT_SQL+';'));
  async function disconnectApply(input,phase) {
    assert.match(process.env.GITHUB_RUN_ID??'',/^[1-9][0-9]*$/);
    assert.ok(['before-commit','after-commit'].includes(phase));
    const appName=`delivery-native-${process.env.GITHUB_RUN_ID}-${phase}`;
    const pause='SELECT pg_sleep(30);\n';
    const interrupted=input.replace(/COMMIT;\n$/,phase==='before-commit'?pause+'COMMIT;\n':'COMMIT;\n'+pause);
    const child=spawn('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],
      {cwd:recovery,env:{...env,PGAPPNAME:appName},stdio:['pipe','ignore','ignore']});
    let exited=false,writeFailed=false;
    const exit=new Promise(resolveExit=>{
      child.once('error',()=>{exited=true;resolveExit({spawnError:true});});
      child.once('exit',(code,signal)=>{exited=true;resolveExit({code,signal});});
    });
    child.stdin.once('error',()=>{writeFailed=true;if(!exited)child.kill('SIGKILL');});
    const deadline=setTimeout(()=>child.kill('SIGKILL'),20000);
    try {
      child.stdin.end(interrupted);
      const filter=`application_name='${appName}' AND usename=current_user AND datname=current_database() AND wait_event='PgSleep'`;
      let waiting=false;
      for(let attempt=0;attempt<20&&!exited;attempt++) {
        if(sql(`SELECT count(*) FROM pg_stat_activity WHERE ${filter};`)==='1'){waiting=true;break;}
        await new Promise(resolveWait=>setTimeout(resolveWait,250));
      }
      assert.equal(waiting,true,'owned native transaction did not reach exact pause');
      assert.equal(sql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE ${filter};`),'t');
      const result=await exit;
      assert.ok(!result.spawnError&&!writeFailed&&Number.isInteger(result.code)&&result.code!==0&&!result.signal,
        'native connection loss was not observed');
    } finally {
      clearTimeout(deadline);
      if(!exited){child.kill('SIGKILL');await exit;}
    }
  }
  const oidShape=JSON.parse(sql("SELECT jsonb_build_object('native',to_jsonb('pg_catalog.pg_proc'::regclass::oid),'numeric',to_jsonb(('pg_catalog.pg_proc'::regclass::oid)::bigint));"));
  assert.equal(typeof oidShape.numeric,'number'); assert.ok(Number.isSafeInteger(oidShape.numeric));
  emit('native-oid-json-shape',{nativeType:typeof oidShape.native,numericType:typeof oidShape.numeric});
  const before=snapshot();
  assert.deepEqual(before.migrations.map(m=>m.version),versionFiles.slice(0,146).map(name=>name.slice(0,14)));
  const expectedDefinitions=[
    'f58e2713a8c02df28ed4d7e31e5c0bd91f4fd07ce5a54c6aca0c4ecdeef5591e',
    '129efcf4061f1b7787bce04b1917d02fd4f39ccafcc7a5a621690c7bea0654a2',
    '31a8930e32d52d6868752b2f705783fe19d5ebf78e80b1728c7446894abe76dc',
    'eb5db772f8eb25618a32fef9daa96990457adbe01eafbe88d8ca8f56cc2d06fa',
  ];
  assert.deepEqual(before.functions.slice(0,4).map(f=>hash(f.definition)),expectedDefinitions);
  const executorContractBytes=readFileSync(resolve(control,'scripts/ci/delivery-executor-contract.json'));
  assert.equal(hash(executorContractBytes),'5ef779af53151cabad80a83903fa0b600df45cc13b9444487f53a2eac9bb6142');
  const executorPlan=JSON.parse(executorContractBytes);
  const fullPreimage=()=>{
    const startedAt=new Date().toISOString();
    const value=JSON.parse(sql('BEGIN READ ONLY;\n'+NATIVE_PREIMAGE_SQL+'ROLLBACK;'));
    const finishedAt=new Date().toISOString();
    return {...verifyNativePreimage({value,plan:executorPlan,versions:versionFiles.slice(0,146).map(n=>n.slice(0,14)),
      interval:{startedAt,finishedAt},now:Date.now()}),raw:value};
  };
  const completeBefore=fullPreimage();assert.ok(isDeepStrictEqual(completeBefore.snapshot,before),'native preimage does not match baseline');
  emit('native-full-preimage-verified',{preimageSha256:completeBefore.preimageSha256,
    sqlSha256:hash(NATIVE_PREIMAGE_SQL),functionDefinitions:4,migrationRecords:146,readOnly:true,releaseAuthorized:false});
  // This owned loopback state exercises archival transport only. Its synthetic
  // token/endpoint are not Primary authentication or a protected capture receipt.
  const syntheticArchive={schema:'stallorder-delivery-native-preimage-archive/v1',projectId:executorPlan.database.projectId,
    controlCommit:process.env.GITHUB_SHA,runId:process.env.GITHUB_RUN_ID,runAttempt:1,
    productCommit:manifest.commit,productTree:manifest.tree,requestStartedAt:completeBefore.requestStartedAt,
    finishedAt:new Date().toISOString(),endpoint:{projectId:executorPlan.database.projectId,
      hostname:'aws-0-ap-northeast-1.pooler.supabase.com',port:'5432',username:'postgres.'+executorPlan.database.projectId,database:'postgres'},
    sourceDigests:{'scripts/ci/delivery-database-preimage.mjs':hash(readFileSync(resolve(control,'scripts/ci/delivery-database-preimage.mjs')))},
    raw:completeBefore.raw,preimageSha256:completeBefore.preimageSha256,
    interval:{startedAt:completeBefore.requestStartedAt,finishedAt:completeBefore.requestFinishedAt},releaseAuthorized:false};
  const syntheticToken='sbp_'+'a'.repeat(40);
  const encryptedEvents=formatNativePreimageCapture(sealNativePreimage(syntheticArchive,syntheticToken),syntheticArchive);
  const reopened=readNativePreimageEvents(encryptedEvents,syntheticToken);
  const reverified=verifyNativePreimage({value:reopened.raw,plan:executorPlan,versions:versionFiles.slice(0,146).map(n=>n.slice(0,14)),interval:reopened.interval,now:Date.now()});
  assert.ok(isDeepStrictEqual(reopened,syntheticArchive)&&isDeepStrictEqual(reverified.snapshot,before),'owned native archive roundtrip differs');
  emit('native-full-preimage-encryption-verified',{archiveSha256:encryptedEvents[0].sha256,
    chunks:encryptedEvents[0].chunks,migrationRecords:146,functionDefinitions:4,protectedCaptureVerified:false,releaseAuthorized:false});
  const migrationBytes=readFileSync(resolve(product,'supabase/migrations',migration),'utf8');
  sql('BEGIN;\n'+migrationBytes+'\nSELECT 1/0;\nCOMMIT;','22012');
  assert.deepEqual(snapshot(),before);
  emit('interrupted-transaction-restored',{migrations:146,helperAbsent:true});
  copyFileSync(resolve(product,'supabase/migrations',migration),resolve(recovery,'supabase/migrations',migration));
  function apply() {
    const r=spawnSync('supabase',['migration','up','--local'],{cwd:recovery,encoding:'utf8',timeout:120000,maxBuffer:2*1024*1024});
    assert.equal(r.status,0,'actual Supabase migration up failed');
    const after=snapshot(); validateSnapshots(before,after); return after;
  }
  let after=apply();
  const qualifiedAfter=structuredClone(after);
  const postimageSource=encodeNativePostimageTemplate({before,after,migration:migrationBytes});
  const rebuiltPostimage=materializeNativePostimage({before,bytes:postimageSource.bytes,sha256:postimageSource.sha256});
  rebuiltPostimage.snapshot.functions[4].oid=after.functions[4].oid;
  assert.ok(isDeepStrictEqual(rebuiltPostimage.snapshot,after),'qualified postimage source differs from native migration result');
  // Only definitions/new history derived from the public frozen source are
  // exported. No baseline history, customer data, real OIDs or credentials.
  const encodedSource=postimageSource.bytes.toString('base64'),sourceChunks=Math.ceil(encodedSource.length/10000);
  emit('native-postimage-source',{productCommit:manifest.commit,productTree:manifest.tree,
    sha256:postimageSource.sha256,bytes:postimageSource.bytes.length,chunks:sourceChunks,sourceOnly:true,releaseAuthorized:false});
  for(let index=0;index<sourceChunks;index++)emit('native-postimage-source-chunk',{
    sha256:postimageSource.sha256,index,data:encodedSource.slice(index*10000,(index+1)*10000)});
  emit('native-postimage-source-complete',{sha256:postimageSource.sha256,chunks:sourceChunks,sourceOnly:true,releaseAuthorized:false});
  sql(recoverySql(before,after)); assert.deepEqual(snapshot(),before);
  const disconnectSql=applySql(before,after,migrationBytes);
  await disconnectApply(disconnectSql,'before-commit');
  assert.deepEqual(classifyApplyOutcome(before,after,snapshot()),{state:'not-applied',retryAllowed:false});
  emit('native-disconnect-before-commit',{state:'not-applied',retryAllowed:false,baselineRestored:true});
  await disconnectApply(disconnectSql,'after-commit');
  const committed=snapshot();
  assert.deepEqual(classifyApplyOutcome(before,after,committed),{state:'applied',retryAllowed:false});
  emit('native-disconnect-after-commit',{state:'applied',retryAllowed:false,migrationCount:147});
  sql(recoverySql(before,committed)); assert.deepEqual(snapshot(),before);
  const staleBefore=structuredClone(before), staleAfter=structuredClone(after);
  staleBefore.migrations[0].name='synthetic-stale-preimage';
  staleAfter.migrations[0].name=staleBefore.migrations[0].name;
  sql(applySql(staleBefore,staleAfter,migrationBytes),'P0001');
  assert.deepEqual(snapshot(),before);
  emit('native-apply-stale-preimage-denied',{unchanged:true});
  const wrongAfter=structuredClone(after);
  wrongAfter.functions[0].definition+='\n-- deliberately wrong expected output';
  sql(applySql(before,wrongAfter,migrationBytes),'P0001');
  assert.deepEqual(snapshot(),before);
  emit('native-apply-postimage-drift-rolled-back',{migrations:146,helperAbsent:true});
  const nativeSql=applySql(before,after,migrationBytes);
  sql(nativeSql.replace(/COMMIT;\n$/,'SELECT 1/0;\nCOMMIT;\n'),'22012');
  assert.deepEqual(snapshot(),before);
  emit('native-apply-sql-error-rolled-back',{migrations:146,helperAbsent:true});
  sql(nativeSql); after=snapshot(); validateSnapshots(before,after);
  assert.throws(fullPreimage,{message:'DELIVERY_NATIVE_PREIMAGE_REJECTED'});
  emit('native-full-preimage-rejects-applied-state',{migrationCount:147,releaseAuthorized:false});
  const normalized=structuredClone(after);
  normalized.functions[4].oid=qualifiedAfter.functions[4].oid;
  assert.deepEqual(normalized,qualifiedAfter);
  sql(nativeSql,'P0001'); assert.deepEqual(snapshot(),after);
  emit('native-apply-and-repeat-refusal',{migrationCount:147,postgresSession:true,oneTransaction:true});
  const drift=structuredClone(after); drift.migrations[0].name='synthetic-stale-postimage';
  const driftBefore=structuredClone(before); driftBefore.migrations[0].name=drift.migrations[0].name;
  sql(recoverySql(driftBefore,drift),'P0001'); assert.deepEqual(snapshot(),after);
  emit('stale-postimage-denied',{unchanged:true});
  sql("CREATE VIEW public.delivery_recovery_dependency AS SELECT public.delivery_ordering_unavailable_code('00000000-0000-0000-0000-000000000000'::uuid,now()) AS code;");
  try {
    sql(recoverySql(before,after),'2BP01'); assert.deepEqual(snapshot(),after);
    emit('unexpected-dependency-denied',{transactionRolledBack:true});
  } finally { sql('DROP VIEW public.delivery_recovery_dependency;'); }
  const orderId='ad970000-0000-4000-8000-000000000001';
  const writeOrder=`SELECT public.create_public_order_with_fulfillment_time_targeted(
    '${orderId}', 'demo-aming-chicken-qr-2026-rotate-me',
    repeat('7',64),repeat('8',64),repeat('9',64),repeat('a',64),repeat('b',64),
    'ad971000-0000-4000-8000-000000000001',repeat('c',64),
    'Synthetic recovery customer','0900000000','Synthetic recovery address','',
    jsonb_build_array(jsonb_build_object('product_id','44444444-4444-4444-8444-444444444441',
      'quantity',1,'note','','modifier_option_ids','[]'::jsonb,'bundle_choice_ids','[]'::jsonb)),
    repeat('d',64),repeat('e',64),'delivery-recovery-order',true,null,null);`;
  try {
    assert.equal(sql(`SELECT count(*) FROM public.orders WHERE id='${orderId}';`),'0');
    sql(`UPDATE public.qr_codes SET state='ACTIVE',expires_at=null,dining_table_id=null,location_id=null,
      market_event_id=null,stall_schedule_id=null,fulfillment_type_context=null WHERE id='33333333-3333-4333-8333-333333333333';
      UPDATE public.stalls SET is_active=true,ordering_enabled=true,business_status='OPEN',ordering_state='OPEN',is_sold_out=false,
        timezone='Asia/Taipei' WHERE id='22222222-2222-4222-8222-222222222222';
      UPDATE public.stall_ordering_settings SET delivery_module_enabled=true,unconfirmed_order_timeout_seconds=600
        WHERE stall_id='22222222-2222-4222-8222-222222222222';
      UPDATE public.stall_capacity_settings SET pause_source='NONE',auto_pause_enabled=false,manual_wait_minutes=null
        WHERE stall_id='22222222-2222-4222-8222-222222222222';
      UPDATE public.stall_business_hours SET opens_at='00:00',closes_at='00:00',last_order_at=null,is_closed=false
        WHERE stall_id='22222222-2222-4222-8222-222222222222';`);
    const session=JSON.parse(sql(`SELECT public.issue_idempotent_order_session_with_schedule_targeted(
      'demo-aming-chicken-qr-2026-rotate-me',repeat('7',64),repeat('9',64),repeat('8',64),repeat('a',64),repeat('b',64),
      'delivery-recovery-session','DELIVERY');`)); assert.equal(session.ok,true);
    assert.equal(JSON.parse(sql(writeOrder)).ok,true);
    const orderSql=`SELECT to_jsonb(o) FROM public.orders o WHERE id='${orderId}';`;
    const order=JSON.parse(sql(orderSql)); assert.equal(order.fulfillment_type,'DELIVERY');
    sql(recoverySql(before,after)); assert.deepEqual(snapshot(),before);
    assert.deepEqual(JSON.parse(sql(orderSql)),order);
    const replay=JSON.parse(sql(writeOrder)); assert.equal(replay.ok,true); assert.equal(replay.idempotent_replay,true);
    assert.equal(sql(`SELECT count(*) FROM public.orders WHERE id='${orderId}';`),'1');
    const orderAfterReplay=JSON.parse(sql(orderSql));
    assert.deepEqual({...orderAfterReplay,updated_at:order.updated_at},order);
    assert.ok(Date.parse(orderAfterReplay.updated_at)>=Date.parse(order.updated_at));
    emit('restored-baseline',{migrationCount:146,functionsRestored:4,helperAbsent:true,createdOrderPreserved:true,idempotentReplay:true});
    const second=apply(); sql(recoverySql(before,second)); assert.deepEqual(snapshot(),before);
    assert.deepEqual(JSON.parse(sql(orderSql)),orderAfterReplay);
    emit('reapply-and-restore',{migrationCount:146,createdOrderPreserved:true});
  } finally {
    sql(`DELETE FROM public.orders WHERE id='${orderId}';
      DELETE FROM public.order_sessions WHERE token_hash=repeat('7',64) AND stall_id='22222222-2222-4222-8222-222222222222';`);
    assert.equal(sql(`SELECT count(*) FROM public.orders WHERE id='${orderId}';`),'0');
    assert.equal(sql("SELECT count(*) FROM public.order_sessions WHERE token_hash=repeat('7',64);"),'0');
    emit('owned-cleanup',{remainingOrders:0,remainingSessions:0});
  }
  emit('summary',{passed:true,productCommit:manifest.commit,productTree:manifest.tree,
    serverVersion:sql('SHOW server_version;'),originalDefinitionSha256:expectedDefinitions,
    baselineSha256:hash(JSON.stringify(before)),postApplySha256:hash(JSON.stringify(after)),
    productionRecoveryVerified:false,edgeRecoveryVerified:false,releaseAuthorized:false});
}
