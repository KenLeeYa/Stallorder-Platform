import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {githubReadArguments} from './delivery-admission.mjs';
import {EDGE_SLUGS} from './delivery-edge-recovery.mjs';
import {loadPairedInterruptedJournal} from './delivery-edge-paired-load.mjs';
import {loadRecoveryHistory} from './delivery-edge-recovery-history.mjs';
import {loadRecoveryProducer} from './delivery-edge-recovery-transport.mjs';
import {planInterruptedEdgeRecovery,executeInterruptedEdgeRecovery} from './delivery-edge-recovery-plan.mjs';
import {inspectInterruptedPairedRecovery} from './delivery-edge-rehearsal.mjs';
import {readIsolatedEdgeRecord} from './delivery-isolated-edge-read.mjs';
import {restoreIsolatedEdgeBinary} from './delivery-edge-restore.mjs';
import {validatePairedInstallation,pairedUsageDatabaseUrl,verifyPairedUsagePrincipal} from './delivery-edge-rehearsal-entry.mjs';
import {recoverIsolatedUsageFixtures} from './delivery-edge-usage.mjs';
import {validateUsageFixturePair} from './delivery-edge-usage-fixture.mjs';
import {PREVIEW_BINDING,verifyExistingPreview} from './delivery-preview-binding.mjs';

const repository='KenLeeYa/Stallorder-Platform',workflow='.github/workflows/production-delivery-edge-restore.yml';
const originalWorkflow='.github/workflows/production-delivery-edge-rehearsal.yml';
const root=fileURLToPath(new URL('../../',import.meta.url));
const hash=value=>createHash('sha256').update(value).digest('hex');
const digest=value=>hash(JSON.stringify(value));
const sourceHash=path=>hash(readFileSync(resolve(root,path)));
function integer(value){assert.match(value??'',/^[1-9][0-9]*$/);const n=Number(value);assert.ok(Number.isSafeInteger(n));return n;}
export function validateRecoveryInstallation(value) {
  for(const key of ['workflowId','originalWorkflowId'])assert.ok(Number.isSafeInteger(value?.[key])&&value[key]>0);
  assert.notEqual(value.workflowId,value.originalWorkflowId);
  assert.deepEqual(value,{schema:'stallorder-paired-edge-recovery-installation/v1',repository,repositoryId:1298874780,
    workflow,workflowId:value.workflowId,originalWorkflowId:value.originalWorkflowId,isolatedProject:PREVIEW_BINDING.project,
    firstRunNumber:1,maxRunAttempt:1,writerConcurrency:'stallorder-preview-pr389-writer'});
  return structuredClone(value);
}
export function validateRecoveryContext(env) {
  for(const [key,value] of Object.entries({GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:repository,GITHUB_REPOSITORY_OWNER:'KenLeeYa',
    GITHUB_ACTOR:'KenLeeYa',GITHUB_TRIGGERING_ACTOR:'KenLeeYa',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',
    GITHUB_RUN_ATTEMPT:'1',RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'Linux',
    GITHUB_WORKFLOW_REF:repository+'/'+workflow+'@refs/heads/main'}))assert.equal(env[key],value);
  assert.match(env.GITHUB_SHA??'',/^[a-f0-9]{40}$/);assert.match(env.RUNNER_NAME??'',/^GitHub Actions \d+$/);
  assert.ok(['restore-intent','restore','verify'].includes(env.EDGE_RECOVERY_PHASE));assert.equal(env.GITHUB_JOB,env.EDGE_RECOVERY_PHASE);
  return {controlCommit:env.GITHUB_SHA,runId:String(integer(env.GITHUB_RUN_ID)),runAttempt:1};
}
// Stages never retry an uncertain PATCH. A separate completed intent precedes
// restoration, and a later stage verifies its completed producer before exact
// owned DB fixture cleanup. Shared request/rate effects remain unknown.
export async function runRecoveryStage({phase,snapshot,snapshotSha256,journal,read,apply,emit,loadHistory,loadProducer,cleanupFixtures,clock=Date.now}) {
  assert.ok(['restore-intent','restore','verify'].includes(phase));
  const history=async()=>{const result=await loadHistory();assert.equal(result.phase,phase);return result;};
  const common={snapshot,snapshotSha256,journal,read,clock};
  if(phase==='restore-intent') {
    const plan=await planInterruptedEdgeRecovery({...common,history:await history()});
    await emit({event:'paired-edge-recovery-intent',plan,planSha256:digest(plan)});return plan;
  }
  const intent=await loadProducer('intent');assert.equal(intent.originVerified,true);assert.equal(intent.mode,'intent');
  assert.equal(intent.planSha256,digest(intent.plan));
  if(phase==='restore') {
    const receipt=await executeInterruptedEdgeRecovery({...common,history:await history(),plan:intent.plan,apply,emit});
    await emit({event:'paired-edge-recovery-complete',receipt});return receipt;
  }
  const completed=await loadProducer('completion',intent.plan);
  assert.equal(completed.originVerified,true);assert.equal(completed.mode,'completion');
  assert.equal(completed.planSha256,intent.planSha256);assert.deepEqual(completed.plan,intent.plan);
  const fresh=await history();assert.equal(fresh.originVerified,true);assert.equal(fresh.historyVerified,true);
  const records=[];for(const slug of EDGE_SLUGS)records.push(await read({project:snapshot.project,slug}));
  const result=await inspectInterruptedPairedRecovery({snapshot,read:async({slug})=>records.find(r=>r.slug===slug)});
  for(const slug of EDGE_SLUGS) {
    if(intent.plan.untouched.includes(slug))assert.deepEqual(records.find(r=>r.slug===slug),snapshot.functions.find(r=>r.slug===slug));
    else assert.ok(result.restored.includes(slug));
  }
  assert.equal(typeof cleanupFixtures,'function');
  validateUsageFixturePair(snapshot.usageFixtures,snapshot.runId);
  const ownedFixtureCleanup=[];
  for(const owned of snapshot.usageFixtures) {
    const checkpoint=await history();assert.equal(checkpoint.originVerified,true);assert.equal(checkpoint.historyVerified,true);
    const result=await cleanupFixtures(structuredClone(owned));
    for(const [key,value] of Object.entries({schema:'stallorder-isolated-edge-owned-recovery/v1',project:snapshot.project,
      runId:snapshot.runId,ownedOrganizationId:owned.organizationId,ownedStallId:owned.stallId,ownedOrderId:owned.orderId,
      ownedRowsRemainingAtReadback:0,sharedRowsDeleted:0,requestsSettled:null,globalAttemptsReconciled:null,
      sharedRateEffectsSettled:null,cleanupVerified:false,productQualified:false,releaseAuthorized:false}))assert.equal(result[key],value);
    ownedFixtureCleanup.push(result);
    await emit({event:'paired-edge-owned-fixture-recovery',receipt:result});
  }
  const receipt={schema:'stallorder-paired-recovery-readback/v1',controlCommit:snapshot.controlCommit,
    originalRunId:snapshot.runId,recoveryRunId:intent.plan.recoveryRunId,snapshotSha256,planSha256:intent.planSha256,
    functions:EDGE_SLUGS,edgeStateRestored:true,ownedFixtureCleanup,cleanupVerified:false,productQualified:false,releaseAuthorized:false};
  await emit({event:'paired-edge-recovery-readback',receipt});return receipt;
}
function github(path) {
  return execFileSync('gh',githubReadArguments(path),{encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024,stdio:['ignore','pipe','pipe']});
}
async function main() {
  const context=validateRecoveryContext(process.env),phase=process.env.EDGE_RECOVERY_PHASE;
  // Provider-created IDs are installed separately; an invocation never learns
  // and adopts its own identity. Missing installation files fail closed.
  const installation=validateRecoveryInstallation(JSON.parse(readFileSync(resolve(root,'scripts/ci/delivery-edge-recovery-installation.json'),'utf8')));
  const original=validatePairedInstallation(JSON.parse(readFileSync(resolve(root,'scripts/ci/delivery-edge-rehearsal-installation.json'),'utf8')));
  assert.equal(installation.originalWorkflowId,original.workflowId);
  const originalRunId=integer(process.env.EDGE_ORIGINAL_RUN_ID),jobId=integer(process.env.EDGE_SNAPSHOT_JOB_ID);
  assert.notEqual(originalRunId,Number(context.runId));
  const archiveSha256=process.env.EDGE_ORIGINAL_ARCHIVE_SHA256;assert.match(archiveSha256??'',/^[a-f0-9]{64}$/);
  const token=process.env.SUPABASE_ACCESS_TOKEN;assert.match(token??'',/^sbp_[a-f0-9]{40}$/);
  const branches=JSON.parse(execFileSync('supabase',['branches','list','--project-ref',PREVIEW_BINDING.parent,'--output','json','--log-level','error'],
    {cwd:root,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024,stdio:['ignore','pipe','pipe']}));
  verifyExistingPreview({parent:PREVIEW_BINDING.parent,branches});
  const current=JSON.parse(github(`actions/runs/${context.runId}`));assert.equal(current.workflow_id,installation.workflowId);
  const paired=await loadPairedInterruptedJournal({token,expectedWorkflowId:original.workflowId,contract:{
    controlCommit:context.controlCommit,runId:originalRunId,runAttempt:1,workflowId:original.workflowId,jobId,archiveSha256,
    workflowSha256:sourceHash(originalWorkflow),entrySha256:sourceHash('scripts/ci/delivery-edge-rehearsal-entry.mjs'),
    intentSha256:sourceHash('scripts/ci/delivery-edge-intent.mjs')}});
  const binding={originalWorkflowId:original.workflowId,recoveryWorkflowId:installation.workflowId,originalRunId,
    currentRunId:Number(context.runId),controlCommit:context.controlCommit,snapshotSha256:paired.evidence.snapshotSha256,phase};
  const pins=paths=>Object.fromEntries(paths.map(p=>[p,sourceHash(p)]));
  const historyPins=pins([originalWorkflow,workflow,'scripts/ci/delivery-edge-rehearsal-entry.mjs',
    'scripts/ci/delivery-edge-recovery-entry.mjs','scripts/ci/delivery-edge-recovery-history.mjs',
    'scripts/ci/delivery-edge-usage.mjs','scripts/ci/delivery-edge-usage-recovery.mjs',
    'scripts/ci/delivery-edge-usage-fixture.mjs','scripts/ci/delivery-edge-usage-references.mjs']);
  const producerPins=pins([workflow,'scripts/ci/delivery-edge-recovery-entry.mjs','scripts/ci/delivery-edge-recovery-transport.mjs',
    'scripts/ci/delivery-edge-recovery-plan.mjs','scripts/ci/delivery-edge-recovery-history.mjs']);
  let db;
  try {
    if(phase==='verify') {
      const config=JSON.parse(execFileSync('supabase',['branches','get',PREVIEW_BINDING.name,'--project-ref',PREVIEW_BINDING.parent,
        '--output','json','--log-level','error'],{cwd:root,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024,stdio:['ignore','pipe','pipe']}));
      const database=pairedUsageDatabaseUrl(config);
      const {PrismaClient}=createRequire(resolve(root,'../product/package.json'))('@prisma/client');
      db=new PrismaClient({datasourceUrl:database});await verifyPairedUsagePrincipal(db);
    }
    await runRecoveryStage({phase,snapshot:paired.snapshot,snapshotSha256:paired.evidence.snapshotSha256,journal:paired.operationJournal,
    read:args=>readIsolatedEdgeRecord({...args,token}),apply:args=>restoreIsolatedEdgeBinary({...args,token}),
    emit:event=>console.log(JSON.stringify(event)),loadHistory:()=>loadRecoveryHistory({binding,sourceDigests:historyPins}),
    loadProducer:(mode,plan)=>loadRecoveryProducer({binding,mode,plan,sourceDigests:producerPins}),
    cleanupFixtures:owned=>recoverIsolatedUsageFixtures({db,runId:paired.snapshot.runId,owned})});
  } finally {if(db)await db.$disconnect();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {await main();} catch(error) {
    if(error.receipt)console.error(JSON.stringify({event:'paired-edge-recovery-incomplete',...error.receipt}));
    console.error(JSON.stringify({event:'paired-edge-recovery-entry-failed',releaseAuthorized:false}));process.exitCode=1;
  }
}
