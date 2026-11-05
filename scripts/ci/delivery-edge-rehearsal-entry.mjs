import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {githubReadArguments} from './delivery-admission.mjs';
import {EDGE_SLUGS} from './delivery-edge-recovery.mjs';
import {loadProtectedEdgeCapture} from './delivery-edge-capture-load.mjs';
import {sealPairedSnapshot, openPairedSnapshot, formatPairedSnapshot} from './delivery-edge-paired-snapshot.mjs';
import {loadPairedAdmittedSnapshot} from './delivery-edge-paired-load.mjs';
import {loadFirstPairedRun} from './delivery-edge-first-run.mjs';
import {buildPairedIntent, loadPairedIntent, loadPairedPhaseCompletion, loadPairedUsageCompletion} from './delivery-edge-intent.mjs';
import {readIsolatedEdgeRecord} from './delivery-isolated-edge-read.mjs';
import {restoreIsolatedEdgeBinary} from './delivery-edge-restore.mjs';
import {executeDurableEdgePhase, inspectInterruptedPairedRecovery} from './delivery-edge-rehearsal.mjs';
import {verifyIsolatedEdgeUsage} from './delivery-edge-usage.mjs';
import {formatPairedUsageEvidence, formatIncompleteUsageEvidence} from './delivery-edge-usage-evidence.mjs';
import {createUsageFixture} from './delivery-edge-usage-fixture.mjs';
import {PREVIEW_BINDING, verifyExistingPreview, verifyPreviewConfiguration} from './delivery-preview-binding.mjs';
import {verifyPreviewDeployment} from './delivery-preview-deployment.mjs';

const repository = 'KenLeeYa/Stallorder-Platform';
const workflow = '.github/workflows/production-delivery-edge-rehearsal.yml';
const root = fileURLToPath(new URL('../../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceHash = path => hash(readFileSync(resolve(root, path)));
const productCommit = '0d2b27144fcf589bb887e669c09e82158e3de7a2';
const phases = ['snapshot', 'replay-intent', 'replay', 'usage-archive', 'restore-intent', 'restore', 'usage-candidate', 'verify'];
export function validatePairedInstallation(value) {
  assert.ok(Number.isSafeInteger(value?.workflowId) && value.workflowId > 0);
  assert.deepEqual(value, {schema: 'stallorder-paired-edge-installation/v1', repository, repositoryId: 1298874780,
    workflow, workflowId: value.workflowId, isolatedProject: PREVIEW_BINDING.project,
    productCommit, firstRunNumber: 1, maxRunAttempt: 1});
  return structuredClone(value);
}
export function pairedUsageDatabaseUrl(config) {
  verifyPreviewConfiguration(config);
  const database = new URL(config.POSTGRES_URL);
  database.port = '5432';
  database.searchParams.delete('pgbouncer');
  if (!database.searchParams.has('sslmode')) database.searchParams.set('sslmode', 'require');
  return database.href;
}
export async function verifyPairedUsagePrincipal(db, clock = Date.now) {
  const startedAt = clock();
  const rows = await db.$queryRawUnsafe(`SELECT current_user::text AS "currentUser",
    session_user::text AS "sessionUser", current_database()::text AS database,
    r.rolsuper AS superuser, r.rolbypassrls AS "bypassRls",
    has_database_privilege(current_user, current_database(), 'CONNECT') AS "databaseConnect",
    has_schema_privilege(current_user, 'public', 'USAGE') AS "publicUsage",
    has_schema_privilege(current_user, 'app_private', 'USAGE') AS "privateUsage",
    statement_timestamp() AS "observedAt"
    FROM pg_catalog.pg_roles r WHERE r.rolname = current_user`);
  const finishedAt = clock();
  assert.equal(rows.length, 1);
  const row = rows[0];
  for (const [key, value] of Object.entries({currentUser: 'postgres', sessionUser: 'postgres',
    database: 'postgres', superuser: false, bypassRls: true, databaseConnect: true,
    publicUsage: true, privateUsage: true})) assert.equal(row[key], value, 'EDGE_USAGE_PRINCIPAL');
  const observedAt = new Date(row.observedAt).toISOString(), observed = Date.parse(observedAt);
  assert.ok(Number.isFinite(startedAt) && Number.isFinite(finishedAt) && finishedAt >= startedAt &&
    finishedAt - startedAt <= 30000 && observed >= startedAt - 30000 && observed <= finishedAt + 1000,
  'EDGE_USAGE_PRINCIPAL_TIME');
  return {currentUser: row.currentUser, sessionUser: row.sessionUser, database: row.database,
    superuser: row.superuser, bypassRls: row.bypassRls, databaseConnect: row.databaseConnect,
    publicUsage: row.publicUsage, privateUsage: row.privateUsage, observedAt};
}
// Complete read-only prerequisites before admitting the snapshot and again for
// each real usage stage. Creating fixtures remains the separate usage operation.
export async function preparePairedUsage({loadOrigin, loadConfiguration, createDatabase, clock = Date.now}) {
  let db;
  try {
    const origin=await loadOrigin(),config=await loadConfiguration();
    const database=pairedUsageDatabaseUrl(config);
    db=await createDatabase(database);
    const principal=await verifyPairedUsagePrincipal(db,clock);
    return {origin,config,db,principal};
  } catch {
    if(db)try {await db.$disconnect();} catch { /* Admission remains failed. */ }
    throw new Error('EDGE_USAGE_PREFLIGHT_FAILED');
  }
}
function integer(value) {assert.match(value ?? '', /^[1-9][0-9]*$/); const n = Number(value); assert.ok(Number.isSafeInteger(n)); return n;}
export function validateEdgeRehearsalContext(env) {
  for (const [key, value] of Object.entries({GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: repository,
    GITHUB_REPOSITORY_OWNER: 'KenLeeYa', GITHUB_ACTOR: 'KenLeeYa', GITHUB_TRIGGERING_ACTOR: 'KenLeeYa',
    GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch', RUNNER_ENVIRONMENT: 'github-hosted',
    RUNNER_OS: 'Linux', GITHUB_WORKFLOW_REF: repository + '/' + workflow + '@refs/heads/main'})) assert.equal(env[key], value);
  assert.match(env.GITHUB_SHA ?? '', /^[a-f0-9]{40}$/);
  assert.equal(env.GITHUB_RUN_ATTEMPT, '1');
  assert.match(env.RUNNER_NAME ?? '', /^GitHub Actions \d+$/);
  assert.ok(phases.includes(env.EDGE_REHEARSAL_PHASE));
  assert.equal(env.GITHUB_JOB, env.EDGE_REHEARSAL_PHASE);
  return {controlCommit: env.GITHUB_SHA, runId: String(integer(env.GITHUB_RUN_ID)), runAttempt: integer(env.GITHUB_RUN_ATTEMPT)};
}
// Fixed internal stages. Callbacks permit offline failure injection, while the
// native entry below supplies the authenticated loaders and fixed adapters.
// Failed or uncertain operations never trigger a retry or an implicit restore.
export async function runPairedStage({phase, snapshot, snapshotSha256, archive,
  read, apply, emit, loadIntent, loadPhase, loadUsage, usage}) {
  snapshot = structuredClone(snapshot); archive = structuredClone(archive);
  assert.ok(phases.includes(phase) && phase !== 'snapshot');
  const plan = mutation => buildPairedIntent({snapshot, snapshotSha256, phase: mutation});
  plan('replay');
  const completed = async (load, previous, key) => {
    const result = await load(previous);
    assert.equal(result.originVerified, true); assert.equal(result[key], true);
    return result;
  };
  const postimages = async restored => {
    const result = await inspectInterruptedPairedRecovery({snapshot, read});
    assert.equal(result.unresolved.length, 0);
    assert.equal(result[restored ? 'restored' : 'candidates'].length, 5);
    assert.equal(result[restored ? 'candidates' : 'restored'].length, 0);
    return result;
  };
  if (phase.endsWith('-intent')) {
    const mutation = phase === 'replay-intent' ? 'replay' : 'restore';
    if (mutation === 'restore') {
      await completed(loadPhase, 'replay', 'phaseComplete');
      await completed(loadUsage, 'usage-archive', 'usageComplete');
      await postimages(false);
    } else {
      for (const before of snapshot.functions) assert.deepEqual(await read({project: snapshot.project, slug: before.slug}), before);
    }
    const intent = plan(mutation);
    await emit({event: 'paired-edge-mutation-intent', plan: intent, planSha256: hash(JSON.stringify(intent))});
    return intent;
  }
  if (['replay', 'restore'].includes(phase)) {
    const intent = plan(phase), admitted = await completed(loadIntent, phase, 'lineageVerified');
    assert.equal(admitted.planSha256, hash(JSON.stringify(intent)));
    const receipt = await executeDurableEdgePhase({snapshot, snapshotSha256, archive, phase, intent, read, apply, emit});
    await emit({event: 'paired-edge-phase-complete', receipt}); return receipt;
  }
  if (phase.startsWith('usage-')) {
    const restored = phase === 'usage-candidate';
    await completed(loadPhase, restored ? 'restore' : 'replay', 'phaseComplete');
    await postimages(restored);
    let receipt;
    try {
      receipt = await usage(structuredClone(snapshot.usageFixtures[restored ? 1 : 0]));
      const events = formatPairedUsageEvidence({snapshot, snapshotSha256, phase, receipt});
      await postimages(restored);
      for (const event of events) await emit(event);
      return receipt;
    } catch (error) {
      const incomplete = error.receipt ?? receipt;
      if (incomplete) for (const event of formatIncompleteUsageEvidence({snapshot, snapshotSha256, phase, receipt: incomplete})) await emit(event);
      throw new Error('EDGE_STAGE_USAGE_INCOMPLETE');
    }
  }
  const replay = await completed(loadPhase, 'replay', 'phaseComplete');
  const restored = await completed(loadPhase, 'restore', 'phaseComplete');
  const archivedUsage = await completed(loadUsage, 'usage-archive', 'usageComplete');
  const candidateUsage = await completed(loadUsage, 'usage-candidate', 'usageComplete');
  await postimages(true);
  const usageSummary = value => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'receipt'));
  const receipt = {schema: 'stallorder-paired-edge-rehearsal/v2', project: snapshot.project,
    controlCommit: snapshot.controlCommit, runId: snapshot.runId, runAttempt: 1, snapshotSha256,
    replay, restored, archivedUsage: usageSummary(archivedUsage), candidateUsage: usageSummary(candidateUsage), cleanupVerified: true,
    productionRecoveryVerified: false, releaseAuthorized: false};
  await emit({event: 'paired-edge-rehearsal-complete', receipt}); return receipt;
}
export async function capturePairedPreimages({context, admitted, read, preflight, clock = () => new Date().toISOString()}) {
  assert.equal(admitted.evidence.releaseAuthorized, false);
  assert.equal(admitted.evidence.controlCommit, context.controlCommit);
  assert.equal(admitted.evidence.project, PREVIEW_BINDING.parent);
  assert.match(admitted.evidence.archiveSha256 ?? '', /^[a-f0-9]{64}$/);
  assert.equal(typeof preflight,'function');await preflight();
  const startedAt = clock(), functions = [];
  assert.equal(admitted.archive.functions.length,5);
  const replayTargets=EDGE_SLUGS.map(slug=>{
    const records=admitted.archive.functions.filter(record=>record.slug===slug);assert.equal(records.length,1);
    const record=records[0];return {slug,wireSha256:record.wireSha256,
      entrypoint_path:record.metadata.entrypoint_path,import_map_path:record.metadata.import_map_path,
      import_map:record.metadata.import_map??null};
  });
  const usageFixtures=[createUsageFixture(context.runId),createUsageFixture(context.runId)];
  for (const slug of EDGE_SLUGS) functions.push(await read({project: PREVIEW_BINDING.project, slug}));
  return {schema: 'stallorder-paired-edge-preimage/v2', project: PREVIEW_BINDING.project, ...context,
    archiveSha256: admitted.evidence.archiveSha256, startedAt, finishedAt: clock(), functions,
    replayTargets,usageFixtures,releaseAuthorized: false};
}
function github(path) {
  return execFileSync('gh', githubReadArguments(path), {encoding: 'utf8', timeout: 60000,
    maxBuffer: 192 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
}
function json(path) {const bytes = github(path); assert.ok(Buffer.byteLength(bytes) <= 2 * 1024 * 1024); return JSON.parse(bytes);}
function supabase(args) {
  const bytes = execFileSync('supabase', args, {cwd: root, encoding: 'utf8', timeout: 30000,
    maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']}); return JSON.parse(bytes);
}
function assertBranch() {
  verifyExistingPreview({parent: PREVIEW_BINDING.parent, branches: supabase(['branches', 'list',
    '--project-ref', PREVIEW_BINDING.parent, '--output', 'json', '--log-level', 'error'])});
}
async function primaryCapture(context, token) {
  const runId = integer(process.env.EDGE_CAPTURE_RUN_ID), jobId = integer(process.env.EDGE_CAPTURE_JOB_ID);
  const run = json(`actions/runs/${runId}`);
  assert.equal(run.head_sha, context.controlCommit);
  return loadProtectedEdgeCapture({token, contract: {controlCommit: context.controlCommit, runId, jobId,
    runAttempt: run.run_attempt, workflowId: run.workflow_id,
    workflowSha256: sourceHash('.github/workflows/production-delivery-evidence.yml'),
    captureSha256: sourceHash('scripts/ci/delivery-edge-recovery.capture.mjs'),
    recoverySha256: sourceHash('scripts/ci/delivery-edge-recovery.mjs')}});
}
async function previewOrigin() {
  const runId = integer(process.env.EDGE_PREVIEW_RUN_ID), deploymentId = process.env.EDGE_PREVIEW_DEPLOYMENT_ID;
  assert.match(deploymentId ?? '', /^dpl_[A-Za-z0-9]+$/);
  const run = json(`actions/runs/${runId}`);
  assert.equal(run.path, '.github/workflows/ephemeral-preview.yml'); assert.equal(run.status, 'completed');
  assert.equal(run.conclusion, 'success'); assert.equal(run.actor.login, 'KenLeeYa'); assert.equal(run.triggering_actor.login, 'KenLeeYa');
  for (const repo of [run.repository, run.head_repository]) {
    assert.equal(repo.full_name, repository); assert.equal(repo.id, 1298874780); assert.equal(repo.private, false); assert.equal(repo.fork, false);
  }
  const previewTree = execFileSync('git', ['rev-parse', `${run.head_sha}^{tree}`], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  const currentTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  assert.equal(previewTree, currentTree);
  const token = process.env.VERCEL_TOKEN?.trim(); assert.ok(token && !/[\x00-\x20\x7f]/.test(token));
  const response = await fetch(`https://api.vercel.com/v13/deployments/${deploymentId}?teamId=team_MMfsiG94K9Zy3e6w7Ccc9xY4`,
    {headers: {Authorization: 'Bearer ' + token}, redirect: 'error', signal: AbortSignal.timeout(15000)});
  assert.equal(response.status, 200);
  const bytes = await response.text(); assert.ok(Buffer.byteLength(bytes) <= 2 * 1024 * 1024); const d = JSON.parse(bytes);
  return verifyPreviewDeployment({project: 'prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP', team: 'team_MMfsiG94K9Zy3e6w7Ccc9xY4',
    commit: productCommit, runId: String(runId), id: deploymentId, url: 'https://' + d.url.replace(/^https:\/\//, '')}, d);
}
async function main() {
  const context = validateEdgeRehearsalContext(process.env);
  // This file is deliberately absent until a separate protected installation
  // pins the provider-created workflow ID. Never derive it from this run.
  const installation = validatePairedInstallation(JSON.parse(readFileSync(
    resolve(root, 'scripts/ci/delivery-edge-rehearsal-installation.json'), 'utf8')));
  const expectedWorkflowId = installation.workflowId, token = process.env.SUPABASE_ACCESS_TOKEN;
  assert.match(token ?? '', /^sbp_[a-f0-9]{40}$/);
  const phase = process.env.EDGE_REHEARSAL_PHASE;
  const currentRun = json(`actions/runs/${context.runId}`);
  assert.equal(currentRun.workflow_id, expectedWorkflowId);
  const admitted = await primaryCapture(context, token);
  assertBranch();
  const read = args => readIsolatedEdgeRecord({...args, token});
  const prepareUsage = () => preparePairedUsage({loadOrigin:previewOrigin,
    loadConfiguration:()=>supabase(['branches','get',PREVIEW_BINDING.name,'--project-ref',PREVIEW_BINDING.parent,
      '--output','json','--log-level','error']),
    createDatabase:database=>{
      const {PrismaClient}=createRequire(resolve(root,'../product/package.json'))('@prisma/client');
      return new PrismaClient({datasourceUrl:database});
    }});
  if (phase === 'snapshot') {
    const firstRun = await loadFirstPairedRun({expectedWorkflowId, run: currentRun});
    console.log(JSON.stringify({event: 'paired-edge-first-run-admission', receipt: firstRun}));
    const value = await capturePairedPreimages({context, admitted, read,preflight:async()=>{
      const usage=await prepareUsage();
      try {console.log(JSON.stringify({event:'paired-edge-principal',...usage.principal,releaseAuthorized:false}));}
      finally {await usage.db.$disconnect();}
    }});
    const sealed = sealPairedSnapshot(value, token);
    assert.deepEqual(openPairedSnapshot(sealed, token, value), value);
    for (const event of formatPairedSnapshot(sealed, value)) console.log(JSON.stringify(event));
    return;
  }
  const jobs = json(`actions/runs/${context.runId}/attempts/1/jobs?per_page=100`);
  assert.ok(Array.isArray(jobs.jobs) && jobs.total_count === jobs.jobs.length);
  const snapshots = jobs.jobs.filter(job => job.name === 'snapshot'); assert.equal(snapshots.length, 1);
  const paired = await loadPairedAdmittedSnapshot({token, expectedWorkflowId, contract: {controlCommit: context.controlCommit,
    runId: Number(context.runId), runAttempt: context.runAttempt, workflowId: expectedWorkflowId,
    jobId: snapshots[0].id, archiveSha256: admitted.evidence.archiveSha256,
    workflowSha256: sourceHash(workflow), entrySha256: sourceHash('scripts/ci/delivery-edge-rehearsal-entry.mjs')}});
  const sourceDigests = Object.fromEntries([workflow, 'scripts/ci/delivery-edge-rehearsal-entry.mjs',
    'scripts/ci/delivery-edge-intent.mjs'].map(path => [path, sourceHash(path)]));
  const usageDigests = {...sourceDigests, ...Object.fromEntries(['delivery-edge-usage-evidence', 'delivery-edge-usage',
    'delivery-edge-usage-fixture', 'delivery-edge-rate-expiry', 'delivery-edge-usage-references']
    .map(name => 'scripts/ci/' + name + '.mjs').map(path => [path, sourceHash(path)]))};
  const common = {snapshot: paired.snapshot, snapshotSha256: paired.evidence.snapshotSha256, expectedWorkflowId};
  let db, origin, config;
  try {
    if (phase.startsWith('usage-')) {
      const prepared=await prepareUsage();
      ({db,origin,config}=prepared);
      console.log(JSON.stringify({event: 'paired-edge-principal', ...prepared.principal, releaseAuthorized: false}));
    }
    await runPairedStage({...common, phase, archive: admitted.archive, read,
      apply: args => restoreIsolatedEdgeBinary({...args, token}),
      emit: event => console.log(JSON.stringify(event)),
      loadIntent: phase => loadPairedIntent({...common, phase, sourceDigests}),
      loadPhase: phase => loadPairedPhaseCompletion({...common, phase, sourceDigests}),
      loadUsage: phase => loadPairedUsageCompletion({...common, phase, sourceDigests: usageDigests}),
      usage: owned => verifyIsolatedEdgeUsage({db, origin, anonKey: config.SUPABASE_ANON_KEY, runId: context.runId, owned})});
    assertBranch();
  } catch (error) {
    if (error.receipt) console.log(JSON.stringify({event: 'paired-edge-rehearsal-incomplete', ...error.receipt}));
    throw new Error('EDGE_REHEARSAL_INCOMPLETE');
  } finally {if (db) await db.$disconnect();}
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {await main();} catch {console.error(JSON.stringify({event: 'paired-edge-entry-failed', releaseAuthorized: false})); process.exitCode = 1;}
}
